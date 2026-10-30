import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { carrierLogoKey } from "./brands";
import { getShopSettings, networkCounts } from "./repo.server";
import { networkSettings, networkShort } from "./settings";

// The cart widget's configuration. The theme app embed inlines it from an app-data
// metafield, so storefront page views never call this app (free-plan Workers allow
// 100k requests a day). /api/networks serves the same object as a fallback.

const NAMESPACE = "plp";
const KEY = "widget";

export async function widgetConfig(shop: string) {
  const { settings, currency } = await getShopSettings(shop);
  if (!settings.enabled) return { enabled: false as const };

  const present = new Set((await networkCounts(settings.countries)).map((c) => c.network));
  const networks = [...present]
    .filter((n) => networkSettings(settings, n).enabled)
    .sort()
    .map((network) => {
      const { label, price } = networkSettings(settings, network);
      return { network, label, short: networkShort(network), price, carrierLogo: carrierLogoKey(network) };
    });
  return {
    enabled: true as const,
    testMode: Boolean(settings.testMarker),
    countries: settings.countries,
    currency,
    combineNetworks: settings.combineNetworks,
    networks,
  };
}

/**
 * Stores the widget config on the app installation for the theme embed
 * (`app.metafields.plp.widget`). Writes only when it changed.
 */
export async function publishWidgetConfig(admin: AdminApiContext, shop: string) {
  const value = JSON.stringify(await widgetConfig(shop));
  const res = await admin.graphql(
    `#graphql
    query WidgetConfig {
      currentAppInstallation {
        id
        widget: metafield(namespace: "plp", key: "widget") { value }
      }
    }`,
  );
  const installation = (await res.json()).data?.currentAppInstallation;
  const stored = installation?.widget?.value;
  if (!installation || (stored && JSON.stringify(JSON.parse(stored)) === value)) return;

  const set = await admin.graphql(
    `#graphql
    mutation PublishWidgetConfig($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    { variables: { metafields: [{ ownerId: installation.id, namespace: NAMESPACE, key: KEY, type: "json", value }] } },
  );
  const errors = (await set.json()).data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) throw new Error(errors.map((e: { message: string }) => e.message).join("; "));
}
