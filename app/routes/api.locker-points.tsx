import type { LoaderFunctionArgs } from "react-router";
import { lockerPoints } from "../lockers/repo.server";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=3600",
};

// All lockers of the given networks, compact, for the cart picker's map.
// GET /api/locker-points?country=LT&network=dpd,omniva
// → { networks: ["dpd","omniva"], points: [["alsendo:123", 54.68, 25.28, 0], …] }
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const country = (url.searchParams.get("country") ?? "").toUpperCase();
  const networks = (url.searchParams.get("network") ?? "").split(",").filter(Boolean).slice(0, 20);
  if (!/^[A-Z]{2}$/.test(country) || !networks.length) {
    return new Response(JSON.stringify({ error: "country and network required" }), { status: 400, headers });
  }
  return new Response(JSON.stringify({ networks, points: await lockerPoints(country, networks) }), { headers });
};
