import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { choiceFromShippingCodes, choiceFromShippingLine, mentionsLocker, snapshotFromWebhook, type OrderPayload } from "../lockers/order-update";
import { fetchShippingLine, markLockerPending, saveChosenLocker } from "../lockers/order-sync.server";
import { findLocker, getShopSettings, networksInCountry } from "../lockers/repo.server";
import { networkSettings, type Settings } from "../lockers/settings";
import { autoCreateShipment } from "../alsendo/shipments.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const { shop, payload, admin } = await authenticate.webhook(request);
  const order = payload as OrderPayload;
  if (!admin) return new Response();
  const lines = order.shipping_lines ?? [];
  const lockerTitled = lines.some((l) => mentionsLocker(l.title));
  let choice = choiceFromShippingCodes(lines.map((l) => l.code));
  if (!choice && !lockerTitled) return new Response();

  const { settings } = await getShopSettings(shop);
  const snapshot = snapshotFromWebhook(order);
  try {
    // A custom "Paštomatas" line typed into a draft order: the buyer picks the
    // locker on the thank-you page, if the country has any enabled locker type.
    if (!choice) {
      const country = order.shipping_address?.country_code ?? settings.countries[0];
      if (!(await lockersOffered(settings, country))) return new Response();
      choice = choiceFromShippingLine(await fetchShippingLine(admin, snapshot.id));
      if (!choice) return new Response();
    }
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
    // After the response, so Shopify's webhook timeout never waits on Alsendo.
    context.cloudflare.ctx.waitUntil(
      autoCreateShipment(admin, shop, snapshot.id, locker.network, settings).catch((error) =>
        console.error(`[alsendo] ${shop}: auto-create failed for ${snapshot.id}`, error),
      ),
    );
  } catch (error) {
    console.error(`[orders] ${shop}: could not record locker on ${snapshot.id}`, error);
  }
  return new Response();
};

async function lockersOffered(settings: Settings, country: string) {
  return (await networksInCountry(country)).some((n) => networkSettings(settings, n).enabled);
}
