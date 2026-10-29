import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteShopSettings } from "../lockers/repo.server";

// Mandatory privacy webhooks. The app stores no customer data; locker details
// live on the shop's own orders. shop/redact removes the shop's settings.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  if (topic === "SHOP_REDACT") await deleteShopSettings(shop);
  return new Response();
};
