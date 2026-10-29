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
import { carrierLogoKey } from "../lockers/brands";
import { networkSettings, networkShort, type Settings } from "../lockers/settings";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { settings, currency, carrierServiceId } = await getShopSettings(session.shop);
  const counts = await networkCounts(settings.countries);
  const networks = [...new Set(counts.map((c) => c.network))]
    .map((network) => ({
      network,
      short: networkShort(network),
      logo: carrierLogoKey(network),
      lockers: counts.filter((c) => c.network === network).reduce((s, c) => s + c.count, 0),
      ...networkSettings(settings, network),
    }))
    // Offered types first, then by size.
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.lockers - a.lockers);
  const store = session.shop.replace(/\.myshopify\.com$/, "");
  const admin = `https://admin.shopify.com/store/${store}`;
  return {
    settings,
    currency,
    carrierServiceId,
    networks,
    syncs: await lastSyncs(),
    appUrl: process.env.SHOPIFY_APP_URL ?? "",
    links: {
      themeEmbed: `${admin}/themes/current/editor?context=apps&activateAppId=${process.env.SHOPIFY_API_KEY}/locker-picker`,
      checkoutEditor: `${admin}/settings/checkout/editor?page=thank-you`,
      shipping: `${admin}/settings/shipping`,
    },
  };
};

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const previous = await getShopSettings(session.shop);

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
    chooseLaterText: String(form.get("chooseLaterText") ?? "").trim() || previous.settings.chooseLaterText,
    combineNetworks: form.get("combineNetworks") === "on",
    combinedLabel: String(form.get("combinedLabel") ?? "").trim() || previous.settings.combinedLabel,
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
    await saveShopSettings(session.shop, { settings, carrierServiceId, currency });
    return { ok: true as const };
  } catch (error) {
    await saveShopSettings(session.shop, { settings, carrierServiceId: previous.carrierServiceId, currency: previous.currency });
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
};

export default function Index() {
  const { settings, currency, carrierServiceId, networks, syncs, appUrl, links } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const saving = useNavigation().state === "submitting";
  const shopify = useAppBridge();

  useEffect(() => {
    if (result?.ok) shopify.toast.show("Settings saved");
  }, [result, shopify]);

  const live = settings.enabled && !settings.testMarker;
  const offered = networks.filter((n) => n.enabled);
  const totalLockers = offered.reduce((sum, n) => sum + n.lockers, 0);
  const money = (n: number) => `${n.toFixed(2)}${currency ? ` ${currency}` : ""}`;

  return (
    <s-page heading="Paštomatai">
      <Form method="post" data-save-bar data-discard-confirmation>
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="base">
            {result && !result.ok && (
              <s-banner tone="critical" heading="Could not register the checkout rates">
                {result.error}. Carrier-calculated shipping must be available on the store's plan.
              </s-banner>
            )}
            {!settings.enabled ? (
              <s-banner tone="info" heading="Parcel lockers are switched off">
                Buyers don't see a parcel locker option at checkout. Tick "Offer parcel lockers at checkout" and save.
              </s-banner>
            ) : settings.testMarker ? (
              <s-banner tone="warning" heading="Test mode">
                Parcel lockers only appear when the shipping name or address contains "{settings.testMarker}". On the
                storefront, open any page with ?plptest=1 to see the cart picker. Clear the test marker below to go live.
              </s-banner>
            ) : (
              <s-banner tone="success" heading="Live">
                Buyers in {settings.countries.join(", ")} can pick a parcel locker in the cart, at checkout and after payment.
              </s-banner>
            )}
          </s-stack>

          <s-section heading="How it works">
            <s-ordered-list>
              <s-list-item>
                Cart: the buyer can pick a locker on a map. Checkout then offers exactly that locker, preselected.
              </s-list-item>
              <s-list-item>
                Checkout: otherwise the buyer sees "{settings.combineNetworks ? settings.combinedLabel : "one option per locker type"}"
                next to your other shipping rates. Draft-order checkout links work the same way.
              </s-list-item>
              <s-list-item>
                After payment: the thank-you page asks for (or lets the buyer change) the exact locker, any type at the
                same or lower price.
              </s-list-item>
              <s-list-item>
                The order gets the locker in its attributes ("Parcel locker", "Parcel locker ID")
                {settings.overwriteShippingAddress ? " and as its shipping address" : ""}, ready for Alsendo.
              </s-list-item>
            </s-ordered-list>
          </s-section>

          <s-section heading="Locker types">
            {networks.length === 0 ? (
              <s-paragraph>No lockers loaded for these countries yet. The catalogue syncs daily.</s-paragraph>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header>Offer</s-table-header>
                  <s-table-header listSlot="primary">Carrier</s-table-header>
                  <s-table-header>Name shown to buyers</s-table-header>
                  <s-table-header format="numeric">Price{currency ? ` (${currency})` : ""}</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {networks.map((n) => (
                    <s-table-row key={n.network}>
                      <s-table-cell>
                        <input type="hidden" name="network" value={n.network} />
                        <s-checkbox name={`enabled:${n.network}`} accessibilityLabel={`Offer ${n.short}`} defaultChecked={n.enabled} />
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack direction="inline" gap="small-200" alignItems="center">
                          {n.logo ? (
                            <s-thumbnail size="small-200" src={`${appUrl}/logos/carrier-${n.logo}.png`} alt={n.short} />
                          ) : null}
                          <s-stack direction="block">
                            <s-text type="strong">{n.short}</s-text>
                            <s-text color="subdued">{n.lockers.toLocaleString("en")} lockers</s-text>
                          </s-stack>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-text-field name={`label:${n.network}`} label="Name shown to buyers" labelAccessibilityVisibility="exclusive" defaultValue={n.label} />
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

          <s-section heading="Checkout">
            <s-stack direction="block" gap="base">
              <s-checkbox
                name="enabled"
                label="Offer parcel lockers at checkout"
                details="Adds the parcel locker option next to your other shipping rates."
                defaultChecked={settings.enabled}
              />
              <s-checkbox
                name="combineNetworks"
                label="Show one checkout option for all locker types"
                details="The buyer picks the carrier and locker after payment. Priced at the most expensive offered type."
                defaultChecked={settings.combineNetworks}
              />
              <s-text-field
                name="combinedLabel"
                label="Name of the combined option"
                details="For example: Paštomatas (DPD / LP Express / Omniva)"
                defaultValue={settings.combinedLabel}
              />
              <s-text-field
                name="chooseLaterText"
                label="Text under the locker option at checkout"
                details="Tells the buyer when they pick the exact locker."
                defaultValue={settings.chooseLaterText}
              />
              <s-text-field
                name="freeShippingOver"
                label={`Free locker delivery from order subtotal${currency ? ` (${currency})` : ""}`}
                details="Leave empty to always charge."
                defaultValue={settings.freeShippingOver === null ? "" : String(settings.freeShippingOver)}
              />
              <s-text-field
                name="countries"
                label="Countries"
                details="Comma-separated country codes, e.g. LT, LV, EE"
                defaultValue={settings.countries.join(", ")}
              />
              <s-checkbox
                name="overwriteShippingAddress"
                label="Replace the order's shipping address with the locker address"
                details="Helps shipping tools that only read the address, like Alsendo's importer. The locker is always saved on the order too."
                defaultChecked={settings.overwriteShippingAddress}
              />
              <s-text-field
                name="testMarker"
                label="Test mode marker"
                details="While set, lockers only show when the shipping name or address contains this text (e.g. PLPTEST). Clear it to go live."
                defaultValue={settings.testMarker ?? ""}
              />
            </s-stack>
          </s-section>

          <s-stack direction="inline" justifyContent="end">
            <s-button type="submit" variant="primary" {...(saving ? { loading: true } : {})}>
              Save
            </s-button>
          </s-stack>
        </s-stack>
      </Form>

        <s-section slot="aside" heading="Setup">
          <s-stack direction="block" gap="base">
            <SetupStep done={Boolean(carrierServiceId)} title="Checkout rates">
              {carrierServiceId ? "Registered with Shopify." : "Save this page once to register them."}
            </SetupStep>
            <SetupStep title="Cart picker">
              Turn on the "Paštomatai" app embed in the theme.{" "}
              <s-link href={links.themeEmbed} target="_top">Open theme editor</s-link>
            </SetupStep>
            <SetupStep title="Thank-you page">
              Add the "Parcel locker choice" block under Apps on the thank-you page.{" "}
              <s-link href={links.checkoutEditor} target="_top">Open checkout editor</s-link>
            </SetupStep>
            <SetupStep done={live} title="Go live">
              {live ? "Lockers are offered to every buyer." : "Clear the test mode marker and save."}
            </SetupStep>
          </s-stack>
        </s-section>

        <s-section slot="aside" heading="Locker data">
          <s-stack direction="block" gap="small-200">
            <s-text>
              {totalLockers.toLocaleString("en")} lockers offered in {settings.countries.join(", ")}
            </s-text>
            {syncs.map((s) => (
              <s-text key={s.source} color="subdued">
                Updated from Alsendo {new Date(s.finishedAt).toLocaleString("lt-LT", { timeZone: "Europe/Vilnius" })}
                {s.error ? ` (last error: ${s.error})` : ""}. Refreshes daily.
              </s-text>
            ))}
          </s-stack>
        </s-section>

        <s-section slot="aside" heading="Prices">
          <s-stack direction="block" gap="small-200">
            {offered.map((n) => (
              <s-stack key={n.network} direction="inline" justifyContent="space-between">
                <s-text>{n.short}</s-text>
                <s-text>{money(n.price)}</s-text>
              </s-stack>
            ))}
            <s-text color="subdued">
              Keep lockers below your standard shipping rate and Shopify preselects them at checkout.{" "}
              <s-link href={links.shipping} target="_top">Shipping settings</s-link>
            </s-text>
          </s-stack>
        </s-section>
    </s-page>
  );
}

function SetupStep({ done, title, children }: { done?: boolean; title: string; children: React.ReactNode }) {
  return (
    <s-stack direction="block" gap="small-300">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        {done === undefined ? null : (
          <s-badge tone={done ? "success" : "warning"}>{done ? "Done" : "To do"}</s-badge>
        )}
        <s-text type="strong">{title}</s-text>
      </s-stack>
      <s-text color="subdued">{children}</s-text>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
