import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { cancelShipmentForCancelledOrder } from "../alsendo/shipments.server";

// Subset of the orders/cancelled webhook payload we use.
interface CancelledOrderPayload {
  admin_graphql_api_id: string;
  fulfillment_status?: string | null;
}

// A cancelled Shopify order cancels its Alsendo shipment, unless something was
// already fulfilled: then the parcel may be with the courier and is left alone.
export const action = async ({ request, context }: ActionFunctionArgs) => {
  const { shop, payload, admin } = await authenticate.webhook(request);
  const order = payload as CancelledOrderPayload;
  if (!admin) return new Response();
  if (order.fulfillment_status === "fulfilled" || order.fulfillment_status === "partial") {
    console.log(`[alsendo] ${shop}: ${order.admin_graphql_api_id} cancelled after fulfillment; shipment kept`);
    return new Response();
  }
  context.cloudflare.ctx.waitUntil(
    cancelShipmentForCancelledOrder(admin, shop, order.admin_graphql_api_id).catch((error) =>
      console.error(`[alsendo] ${shop}: could not cancel shipment for ${order.admin_graphql_api_id}`, error),
    ),
  );
  return new Response();
};
