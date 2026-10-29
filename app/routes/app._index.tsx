import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureCarrierService } from "../carrier/carrier-service.server";
import {
  getShopSettings,
  lastSyncs,
  networkCounts,
  saveShopSettings,
} from "../lockers/repo.server";
import { networkSettings, type Settings } from "../lockers/settings";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { settings, currency, carrierServiceId } = getShopSettings(session.shop);
  const counts = networkCounts(settings.countries);
  const networks = [...new Set(counts.map((c) => c.network))].sort().map((network) => ({
    network,
    lockers: counts.filter((c) => c.network === network).reduce((s, c) => s + c.count, 0),
    ...networkSettings(settings, network),
  }));
  return { settings, currency, carrierServiceId, networks, syncs: lastSyncs() };
};

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const previous = getShopSettings(session.shop);

  const networks: Settings["networks"] = {};
  for (const network of form.getAll("network").map(String)) {
    networks[network] = {
      enabled: form.get(`enabled:${network}`) === "on",
      label: String(form.get(`label:${network}`) || network).trim(),
      price: Math.max(0, num(form.get(`price:${network}`))),
    };
  }
  const freeOver = String(form.get("freeShippingOver") ?? "").trim();
  const settings: Settings = {
    enabled: form.get("enabled") === "on",
    countries: String(form.get("countries") ?? "")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c)),
    networks: { ...previous.settings.networks, ...networks },
    perNetwork: Math.min(5, Math.max(1, Math.round(num(form.get("perNetwork"))) || 2)),
    freeShippingOver: freeOver === "" ? null : Math.max(0, num(freeOver)),
    overwriteShippingAddress: form.get("overwriteShippingAddress") === "on",
    testMarker: String(form.get("testMarker") ?? "").trim() || null,
  };

  try {
    const { carrierServiceId, currency } = await ensureCarrierService(
      admin,
      previous.carrierServiceId,
      settings.enabled,
    );
    saveShopSettings(session.shop, { settings, carrierServiceId, currency });
    return { ok: true as const };
  } catch (error) {
    saveShopSettings(session.shop, { settings, carrierServiceId: previous.carrierServiceId, currency: previous.currency });
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
};

export default function Index() {
  const { settings, currency, carrierServiceId, networks, syncs } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const saving = useNavigation().state === "submitting";
  const shopify = useAppBridge();

  useEffect(() => {
    if (result?.ok) shopify.toast.show("Settings saved");
  }, [result, shopify]);

  return (
    <s-page heading="Parcel lockers">
      <Form method="post">
        {result && !result.ok && (
          <s-banner tone="critical" heading="Could not register the checkout rates">
            {result.error}. Carrier-calculated shipping must be available on the store's plan.
          </s-banner>
        )}

        <s-section heading="Checkout">
          <s-stack direction="block" gap="base">
            <s-checkbox
              name="enabled"
              label="Offer parcel lockers at checkout"
              details="Buyers see the nearest lockers as shipping options, based on their postcode."
              defaultChecked={settings.enabled}
            />
            <s-text-field
              name="countries"
              label="Countries"
              details="Comma-separated ISO codes, e.g. LT, LV, EE"
              defaultValue={settings.countries.join(", ")}
            />
            <s-number-field
              name="perNetwork"
              label="Lockers shown per network"
              min={1}
              max={5}
              defaultValue={String(settings.perNetwork)}
            />
            <s-text-field
              name="freeShippingOver"
              label={`Free locker delivery from order subtotal${currency ? ` (${currency})` : ""}`}
              details="Leave empty to always charge."
              defaultValue={settings.freeShippingOver === null ? "" : String(settings.freeShippingOver)}
            />
            <s-text-field
              name="testMarker"
              label="Test mode marker"
              details="If set, lockers only show when the shipping name or address contains this text (e.g. PLPTEST). Clear it to go live."
              defaultValue={settings.testMarker ?? ""}
            />
            <s-checkbox
              name="overwriteShippingAddress"
              label="Replace the order's shipping address with the locker address"
              details="Helps shipping tools that only read the address. The locker is always saved on the order too."
              defaultChecked={settings.overwriteShippingAddress}
            />
          </s-stack>
        </s-section>

        <s-section heading="Networks">
          {networks.length === 0 ? (
            <s-paragraph>No lockers loaded for these countries yet. The catalogue syncs on startup and daily.</s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Offer</s-table-header>
                <s-table-header>Network</s-table-header>
                <s-table-header>Name shown to buyers</s-table-header>
                <s-table-header>Price{currency ? ` (${currency})` : ""}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {networks.map((n) => (
                  <s-table-row key={n.network}>
                    <s-table-cell>
                      <input type="hidden" name="network" value={n.network} />
                      <s-checkbox name={`enabled:${n.network}`} label="" defaultChecked={n.enabled} />
                    </s-table-cell>
                    <s-table-cell>
                      {n.network} ({n.lockers})
                    </s-table-cell>
                    <s-table-cell>
                      <s-text-field name={`label:${n.network}`} label="Label" labelAccessibilityVisibility="exclusive" defaultValue={n.label} />
                    </s-table-cell>
                    <s-table-cell>
                      <s-text-field name={`price:${n.network}`} label="Price" labelAccessibilityVisibility="exclusive" defaultValue={String(n.price)} />
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>

        <s-section slot="aside" heading="Status">
          <s-paragraph>Checkout rates: {carrierServiceId ? "registered" : "not registered yet (save to register)"}</s-paragraph>
          {syncs.map((s) => (
            <s-paragraph key={s.source}>
              {s.source}: {s.count} lockers, synced {new Date(s.finishedAt).toLocaleString()}
              {s.error ? ` (last error: ${s.error})` : ""}
            </s-paragraph>
          ))}
        </s-section>

        <s-button type="submit" variant="primary" {...(saving ? { loading: true } : {})}>
          Save
        </s-button>
      </Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
