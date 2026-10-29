import { describe, expect, it } from "vitest";
import { verifyShopifyHmac } from "../app/carrier/hmac";
import { createHmac } from "node:crypto";
import { locateBuyer, nearestPerNetwork, normalizeZip } from "../app/lockers/nearest";
import { buildRates, type RateRequest } from "../app/lockers/rates";
import { decodeServiceCode, encodeServiceCode } from "../app/lockers/service-code";
import { defaultSettings, type Settings } from "../app/lockers/settings";
import { parseAlsendo } from "../app/lockers/sources/alsendo";
import { fixSwappedCoordinates } from "../app/lockers/coordinates";
import type { Locker } from "../app/lockers/types";

const locker = (o: Partial<Locker> & Pick<Locker, "externalId" | "network" | "zip" | "lat" | "lng">): Locker => ({
  source: "alsendo",
  countryCode: "LT",
  name: `Locker ${o.externalId}`,
  address: "Gatvė 1",
  city: "Vilnius",
  comment: null,
  ...o,
});

// Vilnius centre ~ (54.687, 25.28); Kaunas ~ (54.898, 23.903)
const lockers: Locker[] = [
  locker({ externalId: "1", network: "omniva", zip: "01100", lat: 54.687, lng: 25.28 }),
  locker({ externalId: "2", network: "omniva", zip: "01200", lat: 54.69, lng: 25.29 }),
  locker({ externalId: "3", network: "omniva", zip: "01300", lat: 54.71, lng: 25.3 }),
  locker({ externalId: "4", network: "dpd", zip: "01150", lat: 54.688, lng: 25.281 }),
  locker({ externalId: "5", network: "dpd", zip: "44100", lat: 54.898, lng: 23.903, city: "Kaunas" }),
];

const settings = (o: Partial<Settings> = {}): Settings => ({
  ...defaultSettings(),
  enabled: true,
  networks: {
    omniva: { enabled: true, label: "Omniva", price: 2.99 },
    dpd: { enabled: true, label: "DPD", price: 3.49 },
  },
  ...o,
});

const request = (o: Partial<RateRequest["rate"]["destination"]> = {}, total = 5000): RateRequest => ({
  rate: {
    destination: { country: "LT", postal_code: "LT-01101", city: "Vilnius", ...o },
    items: [{ price: total, quantity: 1, requires_shipping: true }],
    currency: "EUR",
  },
});

describe("service codes", () => {
  it("round-trips and rejects foreign codes", () => {
    const code = encodeServiceCode({ source: "alsendo", externalId: "53262" });
    expect(code).toBe("PLP1:alsendo:53262");
    expect(decodeServiceCode(code)).toEqual({ source: "alsendo", externalId: "53262" });
    expect(decodeServiceCode("Standard Shipping")).toBeNull();
    expect(decodeServiceCode(undefined)).toBeNull();
  });
});

describe("locating the buyer", () => {
  it("normalizes Lithuanian postcodes", () => {
    expect(normalizeZip("LT-01101")).toBe("01101");
    expect(normalizeZip(" 01101 ")).toBe("01101");
  });

  it("uses the longest matching postcode prefix", () => {
    const p = locateBuyer(lockers, { zip: "44123" });
    expect(p).toEqual({ lat: 54.898, lng: 23.903 });
  });

  it("falls back to the city name", () => {
    expect(locateBuyer(lockers, { zip: "99999", city: "kaunas" })).toEqual({ lat: 54.898, lng: 23.903 });
    expect(locateBuyer(lockers, { zip: "99999", city: "Nowhere" })).toBeNull();
  });

  it("returns the nearest lockers per network", () => {
    const ids = nearestPerNetwork(lockers, { lat: 54.687, lng: 25.28 }, 2).map((l) => l.externalId);
    expect(ids).toEqual(["1", "4", "2", "5"]);
  });
});

describe("buildRates", () => {
  it("returns locker rates in minor units", () => {
    const rates = buildRates(request(), settings(), lockers, "EUR");
    expect(rates.map((r) => r.service_code)).toEqual([
      "PLP1:alsendo:1",
      "PLP1:alsendo:4",
      "PLP1:alsendo:2",
      "PLP1:alsendo:5",
    ]);
    expect(rates[0]).toMatchObject({ service_name: "Omniva – Locker 1", total_price: "299", currency: "EUR" });
  });

  it("skips disabled networks, other countries and disabled shops", () => {
    const onlyOmniva = settings({
      networks: { omniva: { enabled: true, label: "Omniva", price: 2.99 } },
    });
    expect(buildRates(request(), onlyOmniva, lockers, "EUR").every((r) => r.service_name.startsWith("Omniva"))).toBe(true);
    expect(buildRates(request({ country: "LV" }), settings(), lockers, "EUR")).toEqual([]);
    expect(buildRates(request(), settings({ enabled: false }), lockers, "EUR")).toEqual([]);
  });

  it("only answers addresses with the test marker in test mode", () => {
    const test = settings({ testMarker: "PLPTEST" });
    expect(buildRates(request(), test, lockers, "EUR")).toEqual([]);
    expect(buildRates(request({ address1: "Gatvė 1 plptest" }), test, lockers, "EUR").length).toBeGreaterThan(0);
    expect(buildRates(request({ name: "Ona PLPTEST" }), test, lockers, "EUR").length).toBeGreaterThan(0);
  });

  it("makes lockers free above the threshold", () => {
    const rates = buildRates(request({}, 10_000), settings({ freeShippingOver: 100 }), lockers, "EUR");
    expect(rates.every((r) => r.total_price === "0")).toBe(true);
    const below = buildRates(request({}, 9_999), settings({ freeShippingOver: 100 }), lockers, "EUR");
    expect(below[0].total_price).toBe("299");
  });
});

describe("Alsendo parser", () => {
  it("maps machines and drops deleted or unplaced ones", () => {
    const parsed = parseAlsendo({
      result: {
        parcel_machines: [
          { id: 7, name: " A ", city: "Vilnius", country_code: "LT", address: "G. 1", zip: "01100", x_cord: "54.6", y_cord: "25.2", comment: "", deleted_at: null, identifier: "omniva", updated_at: "" },
          { id: 8, name: "B", city: "", country_code: "LT", address: null, zip: null, x_cord: null, y_cord: null, comment: null, deleted_at: null, identifier: "dpd", updated_at: "" },
          { id: 9, name: "C", city: "", country_code: "LT", address: null, zip: null, x_cord: "1", y_cord: "2", comment: null, deleted_at: "2026-01-01", identifier: "dpd", updated_at: "" },
        ],
      },
    });
    expect(parsed).toEqual([
      { source: "alsendo", externalId: "7", network: "omniva", countryCode: "LT", name: "A", address: "G. 1", city: "Vilnius", zip: "01100", lat: 54.6, lng: 25.2, comment: null },
    ]);
    expect(() => parseAlsendo({})).toThrow();
  });
});

describe("HMAC", () => {
  it("accepts Shopify signatures and rejects others", () => {
    const body = '{"rate":{}}';
    const sig = createHmac("sha256", "secret").update(body).digest("base64");
    expect(verifyShopifyHmac(body, sig, "secret")).toBe(true);
    expect(verifyShopifyHmac(body, sig, "other")).toBe(false);
    expect(verifyShopifyHmac(body, null, "secret")).toBe(false);
  });
});

describe("swapped coordinates", () => {
  it("swaps back a network whose lat/lng are reversed", () => {
    const fixed = fixSwappedCoordinates([
      locker({ externalId: "a", network: "omniva", zip: "1", lat: 54.7, lng: 25.3 }),
      locker({ externalId: "b", network: "dpd", zip: "1", lat: 55.7, lng: 24.3 }),
      locker({ externalId: "c", network: "venipak", zip: "1", lat: 54.9, lng: 23.9 }),
      locker({ externalId: "d", network: "lp_post", zip: "1", lat: 25.28, lng: 54.68 }),
    ]);
    expect(fixed.find((l) => l.externalId === "d")).toMatchObject({ lat: 54.68, lng: 25.28 });
    expect(fixed.find((l) => l.externalId === "a")).toMatchObject({ lat: 54.7, lng: 25.3 });
  });
});
