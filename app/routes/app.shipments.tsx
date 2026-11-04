import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getShopSettings, networkCounts, saveShopSettings } from "../lockers/repo.server";
import { networkShort, type AlsendoSettings } from "../lockers/settings";
import { alsendoConfigured } from "../alsendo/client.server";
import { missingSenderFields, serviceCodeFor } from "../alsendo/request";
import { cancelShipment, createShipment, recentLockerOrders } from "../alsendo/shipments.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const { settings } = await getShopSettings(session.shop);
  const counts = await networkCounts(settings.countries);
  const networks = [...new Set([...counts.map((c) => c.network), ...Object.keys(settings.alsendo.services)])].sort();
  const store = session.shop.replace(/\.myshopify\.com$/, "");
  return {
    alsendo: settings.alsendo,
    networks: networks.map((network) => ({ network, short: networkShort(network) })),
    configured: alsendoConfigured(),
    missing: missingSenderFields(settings.alsendo),
    orders: await recentLockerOrders(admin, session.shop),
    adminUrl: `https://admin.shopify.com/store/${store}`,
  };
};

const num = (v: FormDataEntryValue | null, fallback: number) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const orderId = str(form.get("orderId"));

  try {
    if (intent === "create") {
      const shipment = await createShipment(admin, session.shop, orderId);
      if (shipment?.status !== "created") return { ok: false as const, intent, error: shipment?.error ?? "Shipment not created" };
      return { ok: true as const, intent, message: `Shipment ${shipment.shipmentId} created` };
    }
    if (intent === "cancel") {
      await cancelShipment(admin, session.shop, orderId);
      return { ok: true as const, intent, message: "Shipment cancelled" };
    }

    const previous = await getShopSettings(session.shop);
    const old = previous.settings.alsendo;
    const services: Record<string, string> = {};
    for (const network of form.getAll("network").map(String)) {
      const code = str(form.get(`service:${network}`)).toUpperCase();
      if (code) services[network] = code;
    }
    const alsendo: AlsendoSettings = {
      autoCreate: form.get("autoCreate") === "on",
      sender: {
        companyName: str(form.get("companyName")),
        contactName: str(form.get("contactName")),
        street: str(form.get("street")),
        city: str(form.get("city")),
        zip: str(form.get("zip")),
        phone: str(form.get("phone")),
        email: str(form.get("email")),
      },
      parcel: {
        x: num(form.get("x"), old.parcel.x),
        y: num(form.get("y"), old.parcel.y),
        z: num(form.get("z"), old.parcel.z),
        weight: num(form.get("weight"), old.parcel.weight),
      },
      services,
    };
    await saveShopSettings(session.shop, { ...previous, settings: { ...previous.settings, alsendo } });
    return { ok: true as const, intent: "settings", message: "Settings saved" };
  } catch (error) {
    return { ok: false as const, intent, error: error instanceof Error ? error.message : String(error) };
  }
};

type ActionResult = Awaited<ReturnType<typeof action>>;

const STATUS: Record<string, { tone: "success" | "critical" | "warning" | "neutral" | "info"; label: string }> = {
  created: { tone: "success", label: "Created" },
  failed: { tone: "critical", label: "Failed" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  creating: { tone: "info", label: "Creating…" },
};

export default function Shipments() {
  const { alsendo, networks, configured, missing, orders, adminUrl } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const saving = useNavigation().state === "submitting";
  const shopify = useAppBridge();

  useEffect(() => {
    if (result?.ok) shopify.toast.show(result.message);
    else if (result && !result.ok) shopify.toast.show(result.error, { isError: true });
  }, [result, shopify]);

  const ready = configured && missing.length === 0;
  const s = alsendo.sender;

  return (
    <s-page heading="Alsendo shipments">
      <s-stack direction="block" gap="base">
        {!configured ? (
          <s-banner tone="critical" heading="Alsendo API token missing">
            Set the Worker secret ALSENDO_API_TOKEN, then reload this page.
          </s-banner>
        ) : missing.length ? (
          <s-banner tone="warning" heading="Fill in the sender">
            Shipments need the pickup address: {missing.join(", ")}.
          </s-banner>
        ) : alsendo.autoCreate ? (
          <s-banner tone="success" heading="Automatic">
            A shipment is created as soon as an order has a parcel locker. Alsendo bills it only once the courier scans
            the parcel; cancel any you won’t send.
          </s-banner>
        ) : (
          <s-banner tone="info" heading="Manual">
            Create shipments from the list below, or turn on automatic creation.
          </s-banner>
        )}

        <s-section heading="Recent parcel locker orders">
          {orders.length === 0 ? (
            <s-paragraph>No parcel locker orders among the latest 75 orders.</s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Order</s-table-header>
                <s-table-header>Locker</s-table-header>
                <s-table-header>Shipment</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {orders.map((o) => (
                  <OrderRow key={o.id} order={o} adminUrl={adminUrl} ready={ready} hasService={Boolean(o.locker && serviceCodeFor(alsendo, o.locker.network))} />
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>

        <Form method="post" data-save-bar data-discard-confirmation>
          <input type="hidden" name="intent" value="settings" />
          <s-stack direction="block" gap="base">
            <s-section heading="Creation">
              <s-checkbox
                name="autoCreate"
                label="Create the Alsendo shipment automatically"
                details="As soon as the order has a parcel locker: at checkout, or when the buyer picks one after payment."
                defaultChecked={alsendo.autoCreate}
              />
            </s-section>

            <s-section heading="Sender (courier pickup)">
              <s-stack direction="block" gap="base">
                <s-text-field name="companyName" label="Company" defaultValue={s.companyName} />
                <s-text-field name="contactName" label="Contact name" required defaultValue={s.contactName} />
                <s-text-field name="street" label="Street and number" required defaultValue={s.street} />
                <s-stack direction="inline" gap="base">
                  <s-text-field name="city" label="City" required defaultValue={s.city} />
                  <s-text-field name="zip" label="Postcode" required details="Without LT-" defaultValue={s.zip} />
                </s-stack>
                <s-stack direction="inline" gap="base">
                  <s-text-field name="phone" label="Phone" required defaultValue={s.phone} />
                  <s-email-field name="email" label="Email" defaultValue={s.email} />
                </s-stack>
              </s-stack>
            </s-section>

            <s-section heading="Default parcel">
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="base">
                  <s-text-field name="x" label="Width (cm)" defaultValue={String(alsendo.parcel.x)} />
                  <s-text-field name="y" label="Length (cm)" defaultValue={String(alsendo.parcel.y)} />
                  <s-text-field name="z" label="Height (cm)" defaultValue={String(alsendo.parcel.z)} />
                  <s-text-field name="weight" label="Weight (kg)" defaultValue={String(alsendo.parcel.weight)} />
                </s-stack>
                <s-text color="subdued">The order’s own weight is used when its products have one.</s-text>
              </s-stack>
            </s-section>

            <s-section heading="Alsendo services">
              <s-stack direction="block" gap="base">
                {networks.map((n) => (
                  <s-stack key={n.network} direction="inline" gap="base" alignItems="center">
                    <input type="hidden" name="network" value={n.network} />
                    <s-text-field
                      name={`service:${n.network}`}
                      label={`${n.short} service code`}
                      defaultValue={alsendo.services[n.network] ?? ""}
                    />
                  </s-stack>
                ))}
                <s-text color="subdued">
                  Courier pickup to locker: DPD S240, Omniva S218, Venipak S217. Leave empty for types Alsendo can’t ship
                  (LP Express lockers aren’t available on this account).
                </s-text>
              </s-stack>
            </s-section>

            <s-stack direction="inline" justifyContent="end">
              <s-button type="submit" variant="primary" {...(saving ? { loading: true } : {})}>
                Save
              </s-button>
            </s-stack>
          </s-stack>
        </Form>
      </s-stack>
    </s-page>
  );
}

type OrderItem = ReturnType<typeof useLoaderData<typeof loader>>["orders"][number];

function OrderRow({ order, adminUrl, ready, hasService }: { order: OrderItem; adminUrl: string; ready: boolean; hasService: boolean }) {
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";
  const shipment = order.shipment;
  const status = shipment ? STATUS[shipment.status] : null;

  useEffect(() => {
    const r = fetcher.data;
    if (!r) return;
    if (r.ok) shopify.toast.show(r.message);
    else shopify.toast.show(r.error, { isError: true });
  }, [fetcher.data, shopify]);

  async function downloadLabel(size: "a6" | "a4") {
    // App Bridge adds the session token to same-origin fetches.
    const res = await fetch(`/app/shipments/label?order=${encodeURIComponent(order.id)}&size=${size}`);
    if (!res.ok) {
      shopify.toast.show("Label not available yet", { isError: true });
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${order.name.replace(/\W+/g, "")}-${shipment?.shipmentId ?? "label"}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  const submit = (intent: string) => fetcher.submit({ intent, orderId: order.id }, { method: "post" });
  const canCreate = ready && hasService && order.locker && !order.cancelled && (!shipment || shipment.status === "failed" || shipment.status === "cancelled");

  return (
    <s-table-row>
      <s-table-cell>
        <s-stack direction="block">
          <s-link href={`${adminUrl}/orders/${order.id.split("/").pop()}`} target="_top">
            {order.name}
          </s-link>
          <s-text color="subdued">
            {new Date(order.createdAt).toLocaleDateString("lt-LT", { timeZone: "Europe/Vilnius" })}
            {order.cancelled ? " · cancelled" : ""}
          </s-text>
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        {order.locker ? (
          <s-stack direction="block">
            <s-text>{networkShort(order.locker.network)}</s-text>
            <s-text color="subdued">
              {order.locker.name}, {order.locker.city}
            </s-text>
          </s-stack>
        ) : (
          <s-text color="subdued">{order.lockerLabel ?? "Not chosen yet"}</s-text>
        )}
      </s-table-cell>
      <s-table-cell>
        <s-stack direction="block" gap="small-300">
          {status ? <s-badge tone={status.tone}>{status.label}</s-badge> : order.locker && !hasService ? <s-text color="subdued">No Alsendo service</s-text> : <s-text color="subdued">—</s-text>}
          {shipment?.shipmentId && shipment.status === "created" ? <s-text>{shipment.shipmentId}</s-text> : null}
          {shipment?.trackingNumber && shipment.status === "created" ? <s-text color="subdued">{shipment.trackingNumber}</s-text> : null}
          {shipment?.status === "failed" && shipment.error ? <s-text tone="critical">{shipment.error}</s-text> : null}
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-stack direction="inline" gap="small-200">
          {canCreate ? (
            <s-button onClick={() => submit("create")} {...(busy ? { loading: true } : {})}>
              {shipment ? "Create again" : "Create"}
            </s-button>
          ) : null}
          {shipment?.status === "created" ? (
            <>
              <s-button onClick={() => downloadLabel("a6")}>Label</s-button>
              <s-button onClick={() => downloadLabel("a4")} variant="tertiary">
                A4
              </s-button>
              <s-button tone="critical" variant="tertiary" onClick={() => submit("cancel")} {...(busy ? { loading: true } : {})}>
                Cancel
              </s-button>
            </>
          ) : null}
        </s-stack>
      </s-table-cell>
    </s-table-row>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
