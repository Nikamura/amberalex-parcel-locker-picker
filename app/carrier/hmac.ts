import { createHmac, timingSafeEqual } from "node:crypto";

/** Verifies Shopify's X-Shopify-Hmac-Sha256 header over the raw request body. */
export function verifyShopifyHmac(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
