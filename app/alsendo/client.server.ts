import type { AlsendoOrderRequest } from "./request";

// Thin client for https://www.alsendo.lt/api/v1. The token is the Worker secret
// ALSENDO_API_TOKEN. There is no sandbox; shipments are only billed once the
// courier scans them, so unused ones can simply be cancelled.

const BASE = "https://www.alsendo.lt/api/v1";

interface Envelope<T> {
  status: string;
  code: number;
  errors?: string[];
  messages?: string[];
  result: T;
}

export class AlsendoError extends Error {}

export function alsendoConfigured() {
  return Boolean(process.env.ALSENDO_API_TOKEN);
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.ALSENDO_API_TOKEN;
  if (!token) throw new AlsendoError("ALSENDO_API_TOKEN is not set");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    // Non-JSON error page.
  }
  if (!res.ok || !body || body.status !== "ok") {
    const detail = body?.errors?.length ? body.errors.join("; ") : `HTTP ${res.status}`;
    throw new AlsendoError(`Alsendo: ${detail}`);
  }
  return body.result;
}

export function createOrder(request: AlsendoOrderRequest) {
  return call<{ shipment_id: string; cart_id: string; created_at: string; reference: string | null }>("/orders", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function cancelOrder(shipmentId: string) {
  return call<{ shipment_id: string; status: string }>(`/orders/${encodeURIComponent(shipmentId)}/cancel`);
}

/** Labels as base64 PDFs: `small_label` is A6, `base64pdf` A4. Also carries the tracking numbers. */
export function getLabel(shipmentId: string) {
  return call<{ tracking_numbers?: string[]; base64pdf?: string; small_label?: string }>(
    `/orders/${encodeURIComponent(shipmentId)}/label`,
  );
}
