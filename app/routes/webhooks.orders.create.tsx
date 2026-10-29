import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { choiceFromShippingCodes, snapshotFromWebhook, type OrderPayload } from "../lockers/order-update";
import { markLockerPending, saveChosenLocker } from "../lockers/order-sync.server";
import { findLocker, getShopSettings } from "../lockers/repo.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, admin } = await authenticate.webhook(request);
  const order = payload as OrderPayload;
  const choice = choiceFromShippingCodes((order.shipping_lines ?? []).map((l) => l.code));
  if (!choice || !admin) return new Response();

  const { settings } = await getShopSettings(shop);
  const snapshot = snapshotFromWebhook(order);
  try {
    if (choice.kind === "network") {
      await markLockerPending(admin, snapshot, choice.network, settings);
      return new Response();
    }
    const locker = await findLocker(choice.source, choice.externalId);
    if (!locker) {
      console.error(`[orders] ${shop}: locker ${choice.source}:${choice.externalId} not in catalogue`);
      return new Response();
    }
    await saveChosenLocker(admin, snapshot, locker, settings);
  } catch (error) {
    console.error(`[orders] ${shop}: could not record locker on ${snapshot.id}`, error);
  }
  return new Response();
};
