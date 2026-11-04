import { describe, expect, it } from "vitest";
import { buildOrderRequest, missingSenderFields, normalizePhone } from "../app/alsendo/request";
import { defaultAlsendoSettings, withDefaults, type AlsendoSettings } from "../app/lockers/settings";
import type { Locker } from "../app/lockers/types";

const locker: Locker = {
  source: "alsendo", externalId: "49898", network: "dpd", countryCode: "LT", name: "Dainavos Rimi DPD paštomatas 016",
  address: "V. Krėvės pr. 43", city: "Kaunas", zip: "49440", lat: 54.9, lng: 23.9, comment: null,
};
const settings: AlsendoSettings = {
  ...defaultAlsendoSettings(),
  sender: { companyName: "Amber Alex", contactName: "Sandėlis", street: "Gedimino pr. 1", city: "Vilnius", zip: "01103", phone: "8 612 34567", email: "" },
};
const order = { name: "#1001", email: "buyer@example.com", phone: null, receiverName: "Jonas Jonaitis", receiverPhone: "+370 698 76543", totalWeight: 1250 };

describe("Alsendo order request", () => {
  it("sends a courier pickup to the chosen terminal", () => {
    const result = buildOrderRequest(settings, locker, order);
    expect(result).toEqual({
      ok: true,
      body: {
        service_code: "S240",
        reference: "#1001",
        sender: {
          country_id: 122, shipping_type: "courier", company_name: "Amber Alex", contact_name: "Sandėlis",
          street: "Gedimino pr. 1", city: "Vilnius", zipcode: "01103", phone: "+37061234567",
        },
        receiver: {
          country_id: 122, shipping_type: "terminal", terminal_id: "49898", contact_name: "Jonas Jonaitis",
          phone: "+37069876543", email: "buyer@example.com",
        },
        parcels: [{ x: 30, y: 20, z: 15, weight: 1.25, amount: 1 }],
      },
    });
  });

  it("falls back to the default weight and the order phone", () => {
    const result = buildOrderRequest(settings, locker, { ...order, receiverPhone: null, phone: "861111111", totalWeight: 0 });
    expect(result.ok && result.body.parcels[0].weight).toBe(1);
    expect(result.ok && result.body.receiver.phone).toBe("+37061111111");
  });

  it("refuses what Alsendo can't ship", () => {
    expect(buildOrderRequest(settings, { ...locker, network: "lp_post" }, order)).toMatchObject({ ok: false });
    expect(buildOrderRequest(settings, locker, { ...order, receiverPhone: null })).toEqual({ ok: false, error: "The order has no phone number for the locker SMS" });
    expect(buildOrderRequest(defaultAlsendoSettings(), locker, order)).toMatchObject({ ok: false, error: expect.stringContaining("Sender") });
  });

  it("lists missing sender fields", () => {
    expect(missingSenderFields(defaultAlsendoSettings())).toEqual(["contact name", "street", "city", "postcode", "phone"]);
    expect(missingSenderFields(settings)).toEqual([]);
  });

  it("normalises Lithuanian phone numbers", () => {
    expect(normalizePhone("8-612-34567", "LT")).toBe("+37061234567");
    expect(normalizePhone("00370 612 34567", "LT")).toBe("+37061234567");
    expect(normalizePhone("+371 2123 4567", "LV")).toBe("+37121234567");
  });
});

describe("stored settings", () => {
  it("fills in Alsendo defaults for shops saved before it existed", () => {
    const s = withDefaults({ enabled: true });
    expect(s.enabled).toBe(true);
    expect(s.alsendo.services).toEqual({ dpd: "S240", omniva: "S218", venipak: "S217" });
    expect(withDefaults({ alsendo: { parcel: { x: 40 } } as never }).alsendo.parcel).toEqual({ x: 40, y: 20, z: 15, weight: 1 });
  });
});
