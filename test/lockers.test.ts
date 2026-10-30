import { describe, expect, it } from "vitest";
import { verifyShopifyHmac } from "../app/carrier/hmac";
import { createHmac } from "node:crypto";
import * as cat from "../app/lockers/catalogue";
import { normalizeZip } from "../app/lockers/nearest";
import { buildRates, type RateRequest } from "../app/lockers/rates";
import { searchText } from "../app/lockers/search";
import { detectBrand } from "../app/lockers/brands";
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
    expect(decodeServiceCode(code)).toEqual({ kind: "locker", source: "alsendo", externalId: "53262" });
    expect(decodeServiceCode("PLP1N:omniva")).toEqual({ kind: "network", network: "omniva" });
    expect(decodeServiceCode("Standard Shipping")).toBeNull();
    expect(decodeServiceCode(undefined)).toBeNull();
  });
});

describe("locating the buyer", () => {
  it("normalizes Lithuanian postcodes", () => {
    expect(normalizeZip("LT-01101")).toBe("01101");
    expect(normalizeZip(" 01101 ")).toBe("01101");
  });
});

const inLT = { networks: ["dpd", "omniva"] };

describe("buildRates", () => {
  it("offers one rate per enabled locker type", () => {
    const rates = buildRates(request(), settings(), inLT, "EUR");
    expect(rates).toEqual([
      { service_name: "DPD", service_code: "PLP1N:dpd", total_price: "349", currency: "EUR", description: "Choose your parcel locker after payment" },
      { service_name: "Omniva", service_code: "PLP1N:omniva", total_price: "299", currency: "EUR", description: "Choose your parcel locker after payment" },
    ]);
  });

  it("offers a single combined rate priced at the most expensive type", () => {
    const rates = buildRates(request(), settings({ combineNetworks: true, combinedLabel: "Paštomatas (DPD / Omniva)" }), inLT, "EUR");
    expect(rates).toEqual([
      { service_name: "Paštomatas (DPD / Omniva)", service_code: "PLP1N:any", total_price: "349", currency: "EUR", description: "Choose your parcel locker after payment" },
    ]);
  });

  it("offers only the locker picked on the cart page", () => {
    const rates = buildRates(request(), settings(), { ...inLT, chosen: lockers[1] }, "EUR");
    expect(rates[0]).toMatchObject({ service_name: "Omniva – Locker 2", service_code: "PLP1:alsendo:2", total_price: "299" });
    expect(rates).toHaveLength(1);
  });

  it("ignores a cart locker that is unknown or of a disabled network", () => {
    expect(buildRates(request(), settings(), { ...inLT, chosen: null }, "EUR")).toHaveLength(2);
    const onlyOmniva = settings({ networks: { omniva: { enabled: true, label: "Omniva", price: 2.99 } } });
    expect(buildRates(request(), onlyOmniva, { ...inLT, chosen: lockers[3] }, "EUR").map((r) => r.service_code)).toEqual(["PLP1N:omniva"]);
  });

  it("skips other countries and disabled shops", () => {
    expect(buildRates(request({ country: "LV" }), settings(), inLT, "EUR")).toEqual([]);
    expect(buildRates(request(), settings({ enabled: false }), inLT, "EUR")).toEqual([]);
  });

  it("only answers addresses with the test marker in test mode", () => {
    const test = settings({ testMarker: "PLPTEST" });
    expect(buildRates(request(), test, inLT, "EUR")).toEqual([]);
    expect(buildRates(request({ address1: "Gatvė 1 plptest" }), test, inLT, "EUR").length).toBeGreaterThan(0);
    expect(buildRates(request({ name: "Ona PLPTEST" }), test, inLT, "EUR").length).toBeGreaterThan(0);
  });

  it("makes lockers free above the threshold", () => {
    const rates = buildRates(request({}, 10_000), settings({ freeShippingOver: 100 }), inLT, "EUR");
    expect(rates.every((r) => r.total_price === "0")).toBe(true);
    const below = buildRates(request({}, 9_999), settings({ freeShippingOver: 100 }), inLT, "EUR");
    expect(below[1].total_price).toBe("299");
  });
});

describe("in-memory catalogue", () => {
  const c = cat.buildCatalogue(lockers);

  it("round-trips the D1 snapshot format", () => {
    const rows = [...c.byCountry].map(([countryCode, entries]) => ({
      countryCode,
      data: JSON.stringify(
        entries.map(({ locker: l }) => [l.source, l.externalId, l.network, l.name, l.address, l.city, l.zip, l.lat, l.lng, l.comment]),
      ),
    }));
    expect(cat.fromSnapshot(rows)).toEqual(lockers);
  });

  it("looks up, lists and counts networks", () => {
    expect(cat.findLocker(c, "alsendo", "5")?.city).toBe("Kaunas");
    expect(cat.findLocker(c, "alsendo", "99")).toBeUndefined();
    expect(cat.networksInCountry(c, "LT")).toEqual(["dpd", "omniva"]);
    expect(cat.networksInCountry(c, "LV")).toEqual([]);
    expect(cat.networkCounts(c, ["LT", "LV"])).toEqual(
      expect.arrayContaining([
        { network: "omniva", countryCode: "LT", count: 3 },
        { network: "dpd", countryCode: "LT", count: 2 },
      ]),
    );
  });

  it("locates a postcode by its longest shared prefix", () => {
    expect(cat.locateZip(c, "LT", "LT-44199")).toEqual({ lat: 54.898, lng: 23.903 });
    expect(cat.locateZip(c, "LT", "99999")).toBeNull();
  });

  it("searches by words, network and distance", () => {
    expect(cat.searchLockers(c, { country: "LT", zip: "01101" }).map((l) => l.id)).toEqual([
      "alsendo:1",
      "alsendo:4",
      "alsendo:2",
      "alsendo:3",
      "alsendo:5",
    ]);
    expect(cat.searchLockers(c, { country: "LT", networks: ["dpd"], q: "kaunas 44" }).map((l) => l.id)).toEqual(["alsendo:5"]);
    expect(cat.searchLockers(c, { country: "LT", q: "gatve", limit: 2 }).map((l) => l.city)).toEqual(["Kaunas", "Vilnius"]);
    expect(cat.lockerPoints(c, "LT", ["dpd"])).toEqual([
      ["alsendo:4", 54.688, 25.281, 0],
      ["alsendo:5", 54.898, 23.903, 0],
    ]);
  });
});

describe("brands", () => {
  it("detects the shop chain from the locker name", () => {
    expect(detectBrand("Kauno LIDL Savanorių pr. 315 paštomatas")).toBe("lidl");
    expect(detectBrand("Vasario 16 Norfa paštomatas 097")).toBe("norfa");
    expect(detectBrand("Šilas Taikos DPD paštomatas 141")).toBe("silas");
    expect(detectBrand("Express Market")).toBe("express-market");
    expect(detectBrand("Amatų skveras")).toBeUndefined();
    expect(detectBrand("Venipak locker, NORFA Venipak paštomatas")).toBe("norfa");
  });
});

describe("searchText", () => {
  it("folds case and diacritics into one searchable string", () => {
    const text = searchText(locker({ externalId: "a", network: "omniva", zip: "44100", lat: 54.9, lng: 23.9, name: "Kauno LIDL Savanorių pr. 315", city: "Kaunas" }));
    expect(text).toContain("savanoriu");
    expect(text).toContain("kaunas");
    expect(text).toContain("44100");
  });
});

describe("Alsendo parser", () => {
  it("maps machines and drops deleted, unplaced or stale-list ones", () => {
    const parsed = parseAlsendo({
      result: {
        parcel_machines: [
          { id: 7, name: " A ", city: "Vilnius", country_code: "LT", address: "G. 1", zip: "01100", x_cord: "54.6", y_cord: "25.2", comment: "", deleted_at: null, identifier: "omniva", updated_at: "" },
          { id: 8, name: "B", city: "", country_code: "LT", address: null, zip: null, x_cord: null, y_cord: null, comment: null, deleted_at: null, identifier: "dpd", updated_at: "" },
          { id: 9, name: "C", city: "", country_code: "LT", address: null, zip: null, x_cord: "1", y_cord: "2", comment: null, deleted_at: "2026-01-01", identifier: "dpd", updated_at: "" },
          { id: 10, name: "D", city: "", country_code: "LT", address: null, zip: null, x_cord: "1", y_cord: "2", comment: null, deleted_at: null, identifier: "LpPost", updated_at: "" },
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
