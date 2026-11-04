import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import db from "../db.server";
import { shipments } from "../db/schema";
import { ATTR_LOCKER_ID, choiceFromShippingCodes } from "../lockers/order-update";
import { findLocker, getShopSettings } from "../lockers/repo.server";
import { parseLockerId } from "../lockers/service-code";
import type { Settings } from "../lockers/settings";
import { alsendoConfigured, cancelOrder, createOrder, getLabel } from "./client.server";
import { buildOrderRequest, serviceCodeFor } from "./request";

type Admin = AdminApiContext;
export type Shipment = typeof shipments.$inferSelect;

export const ATTR_SHIPMENT = "Alsendo shipment";
export const ATTR_TRACKING = "Tracking number";
const SHIPMENT_ATTRIBUTES = new Set([ATTR_SHIPMENT, ATTR_TRACKING]);
/** A "creating" row older than this is treated as abandoned (Worker died mid-call). */
const STALE_CLAIM_MS = 5 * 60 * 1000;

const ORDER_QUERY = `#graphql
  query ShipmentOrder($id: ID!) {
    order(id: $id) {
      id
      name
      email
      phone
      cancelledAt
      totalWeight
      shippingAddress { name phone }
      customAttributes { key value }
    }
  }`;

interface ShipmentOrderData {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  cancelledAt: string | null;
  totalWeight: string | number | null;
  shippingAddress: { name: string | null; phone: string | null } | null;
  customAttributes: Array<{ key: string; value: string | null }>;
}

async function gql<T>(admin: Admin, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await admin.graphql(query, { variables });
  const body = (await res.json()) as { data?: T; errors?: unknown };
  if (!body.data) throw new Error(`Shopify: ${JSON.stringify(body.errors ?? "no data")}`);
  return body.data;
}

async function loadOrder(admin: Admin, orderId: string) {
  const { order } = await gql<{ order: ShipmentOrderData | null }>(admin, ORDER_QUERY, { id: orderId });
  if (!order) throw new Error("Užsakymas nerastas");
  return order;
}

/** Rewrites the order's shipment attributes, keeping every other attribute. */
async function writeOrderAttributes(admin: Admin, order: ShipmentOrderData, extra: Array<{ key: string; value: string }>) {
  const customAttributes = [
    ...order.customAttributes
      .filter((a) => !SHIPMENT_ATTRIBUTES.has(a.key))
      .map((a) => ({ key: a.key, value: a.value ?? "" })),
    ...extra,
  ];
  const data = await gql<{ orderUpdate: { userErrors: Array<{ message: string }> } }>(
    admin,
    `#graphql
    mutation SaveShipment($input: OrderInput!) {
      orderUpdate(input: $input) { order { id } userErrors { field message } }
    }`,
    { input: { id: order.id, customAttributes } },
  );
  const errors = data.orderUpdate.userErrors;
  if (errors.length) throw new Error(`orderUpdate: ${errors.map((e) => e.message).join("; ")}`);
}

export async function getShipments(shop: string, orderIds: string[]) {
  if (orderIds.length === 0) return [];
  return db.select().from(shipments).where(and(eq(shipments.shop, shop), inArray(shipments.orderId, orderIds))).all();
}

async function getShipment(shop: string, orderId: string) {
  return db.select().from(shipments).where(and(eq(shipments.shop, shop), eq(shipments.orderId, orderId))).get();
}

async function updateShipment(shop: string, orderId: string, values: Partial<Shipment>) {
  await db
    .update(shipments)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(and(eq(shipments.shop, shop), eq(shipments.orderId, orderId)))
    .run();
}

/**
 * Marks the order as being shipped by this call. Returns false when another call
 * holds it or a shipment already exists; failed and cancelled ones may be redone.
 */
async function claim(shop: string, orderId: string): Promise<boolean> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
  const row = {
    shop,
    orderId,
    status: "creating",
    error: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const claimed = await db
    .insert(shipments)
    .values(row)
    .onConflictDoUpdate({
      target: [shipments.shop, shipments.orderId],
      set: { status: "creating", error: null, shipmentId: null, trackingNumber: null, updatedAt: row.updatedAt },
      setWhere: sql`${shipments.status} in ('failed', 'cancelled') or (${shipments.status} = 'creating' and ${shipments.updatedAt} < ${staleBefore})`,
    })
    .returning({ orderId: shipments.orderId })
    .all();
  return claimed.length > 0;
}

function trackingOf(label: { tracking_numbers?: string[] }) {
  return label.tracking_numbers?.filter(Boolean).join(", ") || null;
}

/** Tracking numbers come with the label, a few seconds after the order is created. */
async function waitForTracking(shipmentId: string, attempts = 5, delayMs = 2500): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      const tracking = trackingOf(await getLabel(shipmentId));
      if (tracking) return tracking;
    } catch {
      // Not ready yet.
    }
  }
  return null;
}

/** Creates the Alsendo shipment for an order's chosen locker. Safe to call twice. */
export async function createShipment(admin: Admin, shop: string, orderId: string, settings?: Settings): Promise<Shipment | undefined> {
  if (!(await claim(shop, orderId))) return getShipment(shop, orderId);
  try {
    const shopSettings = settings ?? (await getShopSettings(shop)).settings;
    const order = await loadOrder(admin, orderId);
    await updateShipment(shop, orderId, { orderName: order.name });
    if (order.cancelledAt) throw new Error("Užsakymas atšauktas");

    const ref = parseLockerId(order.customAttributes.find((a) => a.key === ATTR_LOCKER_ID)?.value);
    if (!ref) throw new Error("Paštomatas dar nepasirinktas");
    const locker = await findLocker(ref.source, ref.externalId);
    if (!locker) throw new Error(`Paštomato ${ref.source}:${ref.externalId} nebėra sąraše`);

    const weight = Number(order.totalWeight);
    const built = buildOrderRequest(shopSettings.alsendo, locker, {
      name: order.name,
      email: order.email,
      phone: order.phone,
      receiverName: order.shippingAddress?.name ?? null,
      receiverPhone: order.shippingAddress?.phone ?? null,
      totalWeight: Number.isFinite(weight) ? weight : null,
    });
    await updateShipment(shop, orderId, { lockerId: `${ref.source}:${ref.externalId}`, serviceCode: built.ok ? built.body.service_code : null });
    if (!built.ok) throw new Error(built.error);

    const created = await createOrder(built.body);
    // Record the shipment before anything else can fail, so it is never created twice.
    await updateShipment(shop, orderId, { status: "created", shipmentId: created.shipment_id, error: null });
    const tracking = await waitForTracking(created.shipment_id);
    if (tracking) await updateShipment(shop, orderId, { trackingNumber: tracking });

    try {
      await writeOrderAttributes(admin, order, [
        { key: ATTR_SHIPMENT, value: created.shipment_id },
        ...(tracking ? [{ key: ATTR_TRACKING, value: tracking }] : []),
      ]);
    } catch (error) {
      console.error(`[alsendo] ${shop}: shipment ${created.shipment_id} not written to ${orderId}`, error);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const row = await getShipment(shop, orderId);
    // Never overwrite a shipment that exists on Alsendo's side.
    if (row?.status === "creating") await updateShipment(shop, orderId, { status: "failed", error: message });
    console.error(`[alsendo] ${shop}: shipment for ${orderId} failed: ${message}`);
  }
  return getShipment(shop, orderId);
}

/** Called once an order has a locker. Creates the shipment when auto-create is on and the network has a service. */
export async function autoCreateShipment(admin: Admin, shop: string, orderId: string, network: string, settings: Settings) {
  if (!settings.alsendo.autoCreate || !alsendoConfigured()) return;
  if (!serviceCodeFor(settings.alsendo, network)) return;
  await createShipment(admin, shop, orderId, settings);
}

export async function cancelShipment(admin: Admin, shop: string, orderId: string) {
  const row = await getShipment(shop, orderId);
  if (row?.status !== "created" || !row.shipmentId) throw new Error("Šis užsakymas neturi aktyvios siuntos");
  await cancelOrder(row.shipmentId);
  await updateShipment(shop, orderId, { status: "cancelled", error: null });
  try {
    await writeOrderAttributes(admin, await loadOrder(admin, orderId), []);
  } catch (error) {
    console.error(`[alsendo] ${shop}: could not clear shipment attributes on ${orderId}`, error);
  }
}

/**
 * orders/cancelled: cancels the order's active Alsendo shipment. A shipment still
 * being created (auto-create racing the cancel) is waited for briefly.
 */
export async function cancelShipmentForCancelledOrder(admin: Admin, shop: string, orderId: string) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await getShipment(shop, orderId);
    if (row?.status === "created") {
      await cancelShipment(admin, shop, orderId);
      console.log(`[alsendo] ${shop}: cancelled ${row.shipmentId} with order ${orderId}`);
      return;
    }
    if (row?.status !== "creating") return;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  console.error(`[alsendo] ${shop}: shipment for cancelled order ${orderId} still creating; cancel it by hand`);
}

/** The label as PDF bytes; fills in a missing tracking number on the way. */
export async function shipmentLabel(admin: Admin, shop: string, orderId: string, size: "a6" | "a4") {
  const row = await getShipment(shop, orderId);
  if (row?.status !== "created" || !row.shipmentId) return null;
  const label = await getLabel(row.shipmentId);
  const tracking = trackingOf(label);
  if (tracking && !row.trackingNumber) {
    await updateShipment(shop, orderId, { trackingNumber: tracking });
    try {
      await writeOrderAttributes(admin, await loadOrder(admin, orderId), [
        { key: ATTR_SHIPMENT, value: row.shipmentId },
        { key: ATTR_TRACKING, value: tracking },
      ]);
    } catch (error) {
      console.error(`[alsendo] ${shop}: tracking not written to ${orderId}`, error);
    }
  }
  const base64 = size === "a4" ? label.base64pdf : label.small_label || label.base64pdf;
  if (!base64) return null;
  return { pdf: Buffer.from(base64, "base64"), name: `${row.orderName ?? ""}-${row.shipmentId}.pdf`.replace(/[^\w.-]+/g, "") };
}

const RECENT_ORDERS = `#graphql
  query RecentLockerOrders {
    orders(first: 75, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        createdAt
        cancelledAt
        displayFulfillmentStatus
        shippingLine { code }
        customAttributes { key value }
      }
    }
  }`;

interface RecentOrder {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFulfillmentStatus: string;
  shippingLine: { code: string | null } | null;
  customAttributes: Array<{ key: string; value: string | null }>;
}

/** Recent orders shipped to a parcel locker, with their Alsendo shipment if any. */
export async function recentLockerOrders(admin: Admin, shop: string) {
  const data = await gql<{ orders: { nodes: RecentOrder[] } }>(admin, RECENT_ORDERS, {});
  const orders = data.orders.nodes.filter((o) => choiceFromShippingCodes([o.shippingLine?.code]));
  const rows = new Map((await getShipments(shop, orders.map((o) => o.id))).map((r) => [r.orderId, r]));
  return Promise.all(
    orders.map(async (o) => {
      const attr = (key: string) => o.customAttributes.find((a) => a.key === key)?.value ?? null;
      const ref = parseLockerId(attr(ATTR_LOCKER_ID));
      const locker = ref ? await findLocker(ref.source, ref.externalId) : undefined;
      return {
        id: o.id,
        name: o.name,
        createdAt: o.createdAt,
        cancelled: Boolean(o.cancelledAt),
        fulfillment: o.displayFulfillmentStatus,
        locker: locker ? { network: locker.network, name: locker.name, city: locker.city } : null,
        lockerLabel: attr("Parcel locker"),
        shipment: rows.get(o.id) ?? null,
      };
    }),
  );
}
