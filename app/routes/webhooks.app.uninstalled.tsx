import type { ActionFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { sessionTable } from "../db/schema";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  // Settings are kept until shop/redact so a reinstall restores them.
  await db.delete(sessionTable).where(eq(sessionTable.shop, shop)).run();
  return new Response();
};
