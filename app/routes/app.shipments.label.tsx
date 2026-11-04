import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { shipmentLabel } from "../alsendo/shipments.server";

// GET /app/shipments/label?order=<gid>&size=a6|a4 → the shipment's label PDF.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const size = url.searchParams.get("size") === "a4" ? "a4" : "a6";
  const label = await shipmentLabel(admin, session.shop, url.searchParams.get("order") ?? "", size);
  if (!label) return new Response("Lipdukas neprieinamas", { status: 404 });
  return new Response(label.pdf, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${label.name}"` },
  });
};
