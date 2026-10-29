import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

export const CARRIER_SERVICE_NAME = "Parcel lockers";

export function callbackUrl() {
  return new URL("/carrier/rates", process.env.SHOPIFY_APP_URL).toString();
}

type Admin = AdminApiContext;

/** Creates or updates this app's carrier service and returns its id and the shop currency. */
export async function ensureCarrierService(admin: Admin, existingId: string | null, active: boolean) {
  const res = await admin.graphql(
    `#graphql
    query ShopAndCarrier {
      shop { currencyCode }
      carrierServices(first: 50) { nodes { id name callbackUrl } }
    }`,
  );
  const { data } = await res.json();
  const url = callbackUrl();
  const found =
    data?.carrierServices.nodes.find((c: { id: string }) => c.id === existingId) ??
    data?.carrierServices.nodes.find((c: { callbackUrl: string | null }) => c.callbackUrl === url);

  const input = { name: CARRIER_SERVICE_NAME, callbackUrl: url, active, supportsServiceDiscovery: true };
  const mutation = found
    ? await admin.graphql(
        `#graphql
        mutation UpdateCarrier($input: DeliveryCarrierServiceUpdateInput!) {
          carrierServiceUpdate(input: $input) {
            carrierService { id }
            userErrors { field message }
          }
        }`,
        { variables: { input: { ...input, id: found.id } } },
      )
    : await admin.graphql(
        `#graphql
        mutation CreateCarrier($input: DeliveryCarrierServiceCreateInput!) {
          carrierServiceCreate(input: $input) {
            carrierService { id }
            userErrors { field message }
          }
        }`,
        { variables: { input } },
      );
  const body = await mutation.json();
  const result = body.data?.carrierServiceUpdate ?? body.data?.carrierServiceCreate;
  if (result?.userErrors?.length) {
    throw new Error(result.userErrors.map((e: { message: string }) => e.message).join("; "));
  }
  return { carrierServiceId: result?.carrierService?.id as string, currency: data?.shop.currencyCode as string };
}
