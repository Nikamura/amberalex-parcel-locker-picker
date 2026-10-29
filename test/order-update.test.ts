import { describe, expect, it } from "vitest";
import {
  ATTR_LOCKER,
  ATTR_LOCKER_ADDRESS,
  ATTR_LOCKER_ID,
  buildOrderInput,
  buildPendingOrderInput,
  choiceFromShippingCodes,
  snapshotFromWebhook,
} from "../app/lockers/order-update";
import { defaultSettings } from "../app/lockers/settings";
import type { Locker } from "../app/lockers/types";

const locker: Locker = {
  source: "alsendo", externalId: "53264", network: "lp_post", countryCode: "LT", name: "Amatų skveras",
  address: "Švitrigailos g. 13", city: "Vilnius", zip: "03209", lat: 54.67, lng: 25.27, comment: null,
};
const order = snapshotFromWebhook({
  admin_graphql_api_id: "gid://shopify/Order/1",
  shipping_lines: [{ code: "PLP1:alsendo:53264" }],
  note_attributes: [{ name: "gift", value: "yes" }, { name: ATTR_LOCKER_ID, value: "stale" }],
});
const settings = { ...defaultSettings(), networks: { lp_post: { enabled: true, label: "LP Express paštomatas", price: 2.99 } } };

describe("shipping line choice", () => {
  it("reads a locker, a locker type, or nothing", () => {
    expect(choiceFromShippingCodes(["PLP1:alsendo:53264"])).toEqual({ kind: "locker", source: "alsendo", externalId: "53264" });
    expect(choiceFromShippingCodes([null, "PLP1N:omniva"])).toEqual({ kind: "network", network: "omniva" });
    expect(choiceFromShippingCodes(["Standard"])).toBeNull();
  });
});

describe("order update", () => {
  it("keeps other attributes and stores the locker in separate fields", () => {
    const input = buildOrderInput(order, locker, settings);
    expect(input.customAttributes).toEqual([
      { key: "gift", value: "yes" },
      { key: ATTR_LOCKER, value: "LP Express paštomatas – Amatų skveras" },
      { key: ATTR_LOCKER_ADDRESS, value: "Švitrigailos g. 13, 03209 Vilnius" },
      { key: ATTR_LOCKER_ID, value: "alsendo:53264" },
    ]);
    expect(input).not.toHaveProperty("shippingAddress");
    expect(JSON.parse((input.metafields as Array<{ value: string }>)[0].value)).toMatchObject({ status: "chosen", id: "53264", network: "lp_post" });
  });

  it("marks a locker type as pending", () => {
    const input = buildPendingOrderInput(order, "lp_post", settings);
    expect(input.customAttributes).toEqual([
      { key: "gift", value: "yes" },
      { key: ATTR_LOCKER, value: "LP Express paštomatas: not chosen yet" },
    ]);
    expect(JSON.parse(input.metafields[0].value)).toEqual({ status: "pending", network: "lp_post", label: "LP Express paštomatas" });
  });
});
