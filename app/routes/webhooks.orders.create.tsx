import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { buildOrderInput, lockerRefFromOrder, type OrderPayload } from "../lockers/order-update";
import { findLocker, getShopSettings } from "../lockers/repo.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, admin } = await authenticate.webhook(request);
  const order = payload as OrderPayload;
  const ref = lockerRefFromOrder(order);
  if (!ref || !admin) return new Response();

  const locker = findLocker(ref.source, ref.externalId);
  if (!locker) {
    console.error(`[orders] ${shop}: locker ${ref.source}:${ref.externalId} not in catalogue`);
    return new Response();
  }

  const { settings } = getShopSettings(shop);
  const res = await admin.graphql(
    `#graphql
    mutation SaveLocker($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { id }
        userErrors { field message }
      }
    }`,
    { variables: { input: buildOrderInput(order, locker, settings) } },
  );
  const body = await res.json();
  const errors = body.data?.orderUpdate?.userErrors ?? [];
  if (errors.length) console.error(`[orders] ${shop}: orderUpdate failed`, errors);
  return new Response();
};
