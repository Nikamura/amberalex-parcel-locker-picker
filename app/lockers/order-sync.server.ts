import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { PENDING_TAG, buildOrderInput, buildPendingOrderInput, type OrderSnapshot } from "./order-update";
import type { Settings } from "./settings";
import type { Locker } from "./types";

type Admin = AdminApiContext;

async function run(admin: Admin, query: string, variables: Record<string, unknown>, field: string) {
  const res = await admin.graphql(query, { variables });
  const body = await res.json();
  const errors = body.data?.[field]?.userErrors ?? [];
  if (errors.length) throw new Error(`${field}: ${errors.map((e: { message: string }) => e.message).join("; ")}`);
}

const UPDATE = `#graphql
  mutation SaveLocker($input: OrderInput!) {
    orderUpdate(input: $input) { order { id } userErrors { field message } }
  }`;

export async function saveChosenLocker(admin: Admin, order: OrderSnapshot, locker: Locker, settings: Settings) {
  await run(admin, UPDATE, { input: buildOrderInput(order, locker, settings) }, "orderUpdate");
  await run(
    admin,
    `#graphql
    mutation Untag($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { field message } } }`,
    { id: order.id, tags: [PENDING_TAG] },
    "tagsRemove",
  );
}

export async function markLockerPending(admin: Admin, order: OrderSnapshot, network: string, settings: Settings) {
  await run(admin, UPDATE, { input: buildPendingOrderInput(order, network, settings) }, "orderUpdate");
  await run(
    admin,
    `#graphql
    mutation Tag($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`,
    { id: order.id, tags: [PENDING_TAG] },
    "tagsAdd",
  );
}
