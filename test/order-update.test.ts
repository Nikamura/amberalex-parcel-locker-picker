import { describe, expect, it } from "vitest";
import { ATTR_LOCKER, ATTR_LOCKER_ID, buildOrderInput, lockerRefFromOrder } from "../app/lockers/order-update";
import { defaultSettings } from "../app/lockers/settings";
import type { Locker } from "../app/lockers/types";

const locker: Locker = {
  source: "alsendo", externalId: "53264", network: "lp_post", countryCode: "LT", name: "Amatų skveras",
  address: "Švitrigailos g. 13", city: "Vilnius", zip: "03209", lat: 54.67, lng: 25.27, comment: null,
};
const order = {
  admin_graphql_api_id: "gid://shopify/Order/1",
  shipping_lines: [{ code: "PLP1:alsendo:53264" }],
  note_attributes: [{ name: "gift", value: "yes" }, { name: ATTR_LOCKER_ID, value: "stale" }],
  shipping_address: { first_name: "Ona", last_name: "Onaitė", phone: "+37060000000", country_code: "LT" },
};

describe("order update", () => {
  it("reads the locker from the shipping line", () => {
    expect(lockerRefFromOrder(order)).toEqual({ source: "alsendo", externalId: "53264" });
    expect(lockerRefFromOrder({ ...order, shipping_lines: [{ code: "Standard" }] })).toBeNull();
  });

  it("keeps other attributes, replaces locker ones and overwrites the address", () => {
    const input = buildOrderInput(order, locker, { ...defaultSettings(), overwriteShippingAddress: true });
    expect(input.customAttributes).toEqual([
      { key: "gift", value: "yes" },
      { key: ATTR_LOCKER, value: "LP Express – Amatų skveras, Švitrigailos g. 13, Vilnius 03209" },
      { key: ATTR_LOCKER_ID, value: "alsendo:53264" },
    ]);
    expect(input.shippingAddress).toMatchObject({
      firstName: "Ona", lastName: "Onaitė", phone: "+37060000000",
      company: "LP Express 53264", address1: "Amatų skveras", address2: "Švitrigailos g. 13", city: "Vilnius", zip: "03209", countryCode: "LT",
    });
    expect(JSON.parse((input.metafields as Array<{ value: string }>)[0].value)).toMatchObject({ id: "53264", network: "lp_post" });
  });

  it("leaves the address alone when overwrite is off", () => {
    const input = buildOrderInput(order, locker, { ...defaultSettings(), overwriteShippingAddress: false });
    expect(input.shippingAddress).toBeUndefined();
  });
});
