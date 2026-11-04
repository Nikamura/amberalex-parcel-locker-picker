import { useEffect } from "react";
import type { ActionFunctionArgs, AppLoadContext, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary, type AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureCarrierService } from "../carrier/carrier-service.server";
import {
  getShopSettings,
  lastSyncs,
  networkCounts,
  saveShopSettings,
} from "../lockers/repo.server";
import { carrierLogoKey } from "../lockers/brands";
import { alsendoService, networkSettings, networkShort, type Settings } from "../lockers/settings";
import { publishWidgetConfig } from "../lockers/widget-config.server";

/** Keeps the theme embed's inlined config current; never blocks or fails the page. */
function publishInBackground(context: AppLoadContext, admin: AdminApiContext, shop: string) {
  context.cloudflare.ctx.waitUntil(
    publishWidgetConfig(admin, shop).catch((error) => console.error(`[widget] ${shop}: publish failed`, error)),
  );
}

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  // Also backfills shops that saved settings before the metafield existed, and picks
  // up locker types that appeared in the catalogue since the last save.
  publishInBackground(context, admin, session.shop);
  const { settings, currency, carrierServiceId } = await getShopSettings(session.shop);
  const counts = await networkCounts(settings.countries);
  const networks = [...new Set(counts.map((c) => c.network))]
    .map((network) => ({
      network,
      short: networkShort(network),
      logo: carrierLogoKey(network),
      lockers: counts.filter((c) => c.network === network).reduce((s, c) => s + c.count, 0),
      ...networkSettings(settings, network),
      shippable: Boolean(alsendoService(network)),
    }))
    // Offered types first, then those Alsendo ships, then by size.
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || Number(b.shippable) - Number(a.shippable) || b.lockers - a.lockers);
  const store = session.shop.replace(/\.myshopify\.com$/, "");
  const adminUrl = `https://admin.shopify.com/store/${store}`;
  return {
    settings,
    currency,
    carrierServiceId,
    networks,
    syncs: await lastSyncs(),
    appUrl: process.env.SHOPIFY_APP_URL ?? "",
    links: {
      themeEmbed: `${adminUrl}/themes/current/editor?context=apps&activateAppId=${process.env.SHOPIFY_API_KEY}/locker-picker`,
      checkoutEditor: `${adminUrl}/settings/checkout/editor?page=thank-you`,
      shipping: `${adminUrl}/settings/shipping`,
    },
  };
};

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const previous = await getShopSettings(session.shop);

  const networks: Settings["networks"] = {};
  for (const network of form.getAll("network").map(String)) {
    networks[network] = {
      enabled: form.get(`enabled:${network}`) === "on" && Boolean(alsendoService(network)),
      label: String(form.get(`label:${network}`) || network).trim(),
      price: Math.max(0, num(form.get(`price:${network}`))),
    };
  }
  const freeOver = String(form.get("freeShippingOver") ?? "").trim();
  const settings: Settings = {
    // Keeps settings edited on other pages (Alsendo shipments).
    ...previous.settings,
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
    testMarker: String(form.get("testMarker") ?? "").trim() || null,
  };

  try {
    const { carrierServiceId, currency } = await ensureCarrierService(
      admin,
      previous.carrierServiceId,
      settings.enabled,
    );
    await saveShopSettings(session.shop, { settings, carrierServiceId, currency });
    publishInBackground(context, admin, session.shop);
    return { ok: true as const };
  } catch (error) {
    await saveShopSettings(session.shop, { settings, carrierServiceId: previous.carrierServiceId, currency: previous.currency });
    publishInBackground(context, admin, session.shop);
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
};

export default function Index() {
  const { settings, currency, carrierServiceId, networks, syncs, appUrl, links } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const saving = useNavigation().state === "submitting";
  const shopify = useAppBridge();

  useEffect(() => {
    if (result?.ok) shopify.toast.show("Nustatymai išsaugoti");
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
              <s-banner tone="critical" heading="Nepavyko užregistruoti pristatymo kainų">
                {result.error}. Parduotuvės plane turi būti įjungtas vežėjų skaičiuojamas pristatymas (carrier-calculated shipping).
              </s-banner>
            )}
            {!settings.enabled ? (
              <s-banner tone="info" heading="Paštomatai išjungti">
                Pirkėjai atsiskaitydami nemato paštomato pasirinkimo. Pažymėkite „Siūlyti paštomatus atsiskaitant“ ir išsaugokite.
              </s-banner>
            ) : settings.testMarker ? (
              <s-banner tone="warning" heading="Bandomasis režimas">
                Paštomatai rodomi tik tada, kai pristatymo varde ar adrese yra „{settings.testMarker}“. Parduotuvėje atidarykite
                bet kurį puslapį su ?plptest=1, kad pamatytumėte pasirinkimą krepšelyje. Kad įjungtumėte visiems, ištrinkite bandomąjį žymeklį žemiau.
              </s-banner>
            ) : (
              <s-banner tone="success" heading="Įjungta">
                Pirkėjai iš {settings.countries.join(", ")} gali pasirinkti paštomatą krepšelyje, atsiskaitydami ir po apmokėjimo.
              </s-banner>
            )}
          </s-stack>

          <s-section heading="Kaip tai veikia">
            <s-ordered-list>
              <s-list-item>
                Krepšelis: pirkėjas gali pasirinkti paštomatą žemėlapyje. Atsiskaitant jis jau būna pasirinktas.
              </s-list-item>
              <s-list-item>
                Atsiskaitymas: kitu atveju pirkėjas mato „{settings.combineNetworks ? settings.combinedLabel : "po vieną pasirinkimą kiekvienam paštomatų tipui"}“
                šalia kitų pristatymo būdų. Užsakymų juodraščių atsiskaitymo nuorodos veikia taip pat.
              </s-list-item>
              <s-list-item>
                Po apmokėjimo: jei paštomatas dar nepasirinktas (pvz., užsakymų juodraščiai), padėkos puslapyje pirkėjas jį pasirenka –
                bet kurio tipo, kurio kaina tokia pati ar mažesnė. Pasirinktas paštomatas rodomas be galimybės keisti; pakeitimus atliekate jūs.
              </s-list-item>
              <s-list-item>
                Paštomatas įrašomas į atskirus užsakymo laukus („Parcel locker“, „Parcel locker address“, „Parcel locker
                ID“). Paties pirkėjo pristatymo adresas nekeičiamas.
              </s-list-item>
            </s-ordered-list>
          </s-section>

          <s-section heading="Paštomatų tipai">
            {networks.length === 0 ? (
              <s-paragraph>Šioms šalims paštomatų dar neįkelta. Sąrašas atnaujinamas kasdien.</s-paragraph>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header>Siūlyti</s-table-header>
                  <s-table-header listSlot="primary">Vežėjas</s-table-header>
                  <s-table-header>Pavadinimas pirkėjams</s-table-header>
                  <s-table-header format="numeric">Kaina{currency ? ` (${currency})` : ""}</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {networks.map((n) => (
                    <s-table-row key={n.network}>
                      <s-table-cell>
                        <input type="hidden" name="network" value={n.network} />
                        <s-checkbox name={`enabled:${n.network}`} accessibilityLabel={`Siūlyti ${n.short}`} defaultChecked={n.enabled} disabled={!n.shippable} />
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack direction="inline" gap="small-200" alignItems="center">
                          {n.logo ? (
                            <s-thumbnail size="small-200" src={`${appUrl}/logos/carrier-${n.logo}.png`} alt={n.short} />
                          ) : null}
                          <s-stack direction="block">
                            <s-text type="strong">{n.short}</s-text>
                            <s-text color="subdued">
                              {n.lockers.toLocaleString("lt-LT")} paštomatų{n.shippable ? "" : " · Alsendo nesiunčia"}
                            </s-text>
                          </s-stack>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-text-field name={`label:${n.network}`} label="Pavadinimas pirkėjams" labelAccessibilityVisibility="exclusive" defaultValue={n.label} />
                      </s-table-cell>
                      <s-table-cell>
                        <s-text-field name={`price:${n.network}`} label="Kaina" labelAccessibilityVisibility="exclusive" defaultValue={String(n.price)} />
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </s-section>

          <s-section heading="Atsiskaitymas">
            <s-stack direction="block" gap="base">
              <s-checkbox
                name="enabled"
                label="Siūlyti paštomatus atsiskaitant"
                details="Prideda paštomato pasirinkimą šalia kitų pristatymo būdų."
                defaultChecked={settings.enabled}
              />
              <s-checkbox
                name="combineNetworks"
                label="Rodyti vieną pasirinkimą visiems paštomatų tipams"
                details="Vežėją ir paštomatą pirkėjas pasirenka po apmokėjimo. Kaina – brangiausio siūlomo tipo."
                defaultChecked={settings.combineNetworks}
              />
              <s-text-field
                name="combinedLabel"
                label="Bendro pasirinkimo pavadinimas"
                details="Pavyzdžiui: Paštomatas (DPD / LP Express / Omniva)"
                defaultValue={settings.combinedLabel}
              />
              <s-text-field
                name="chooseLaterText"
                label="Tekstas po paštomato pasirinkimu atsiskaitant"
                details="Paaiškina pirkėjui, kada jis pasirinks konkretų paštomatą."
                defaultValue={settings.chooseLaterText}
              />
              <s-text-field
                name="freeShippingOver"
                label={`Nemokamas pristatymas į paštomatą nuo užsakymo sumos${currency ? ` (${currency})` : ""}`}
                details="Palikite tuščią, jei pristatymas visada mokamas."
                defaultValue={settings.freeShippingOver === null ? "" : String(settings.freeShippingOver)}
              />
              <s-text-field
                name="countries"
                label="Šalys"
                details="Šalių kodai, atskirti kableliais, pvz., LT, LV, EE"
                defaultValue={settings.countries.join(", ")}
              />
              <s-text-field
                name="testMarker"
                label="Bandomojo režimo žymeklis"
                details="Kol nustatytas, paštomatai rodomi tik tada, kai pristatymo varde ar adrese yra šis tekstas (pvz., PLPTEST). Ištrinkite, kad įjungtumėte visiems."
                defaultValue={settings.testMarker ?? ""}
              />
            </s-stack>
          </s-section>

          <s-stack direction="inline" justifyContent="end">
            <s-button type="submit" variant="primary" {...(saving ? { loading: true } : {})}>
              Išsaugoti
            </s-button>
          </s-stack>
        </s-stack>
      </Form>

        <s-section slot="aside" heading="Paruošimas">
          <s-stack direction="block" gap="base">
            <SetupStep done={Boolean(carrierServiceId)} title="Pristatymo kainos">
              {carrierServiceId ? "Užregistruotos Shopify." : "Išsaugokite šį puslapį, kad jos būtų užregistruotos."}
            </SetupStep>
            <SetupStep title="Pasirinkimas krepšelyje">
              Temoje įjunkite programėlės įterpinį „Paštomatai“.{" "}
              <s-link href={links.themeEmbed} target="_top">Atidaryti temos redaktorių</s-link>
            </SetupStep>
            <SetupStep title="Padėkos puslapis">
              Padėkos puslapyje pridėkite programėlės bloką „Parcel locker choice“, pvz., skiltyje Main po patvirtinimu.{" "}
              <s-link href={links.checkoutEditor} target="_top">Atidaryti atsiskaitymo redaktorių</s-link>
            </SetupStep>
            <SetupStep done={live} title="Įjungimas visiems">
              {live ? "Paštomatai siūlomi visiems pirkėjams." : "Ištrinkite bandomojo režimo žymeklį ir išsaugokite."}
            </SetupStep>
          </s-stack>
        </s-section>

        <s-section slot="aside" heading="Paštomatų duomenys">
          <s-stack direction="block" gap="small-200">
            <s-text>
              Siūloma paštomatų: {totalLockers.toLocaleString("lt-LT")} ({settings.countries.join(", ")})
            </s-text>
            {syncs.map((s) => (
              <s-text key={s.source} color="subdued">
                Atnaujinta iš Alsendo {new Date(s.finishedAt).toLocaleString("lt-LT", { timeZone: "Europe/Vilnius" })}
                {s.error ? ` (paskutinė klaida: ${s.error})` : ""}. Atnaujinama kasdien.
              </s-text>
            ))}
          </s-stack>
        </s-section>

        <s-section slot="aside" heading="Kainos">
          <s-stack direction="block" gap="small-200">
            {offered.map((n) => (
              <s-stack key={n.network} direction="inline" justifyContent="space-between">
                <s-text>{n.short}</s-text>
                <s-text>{money(n.price)}</s-text>
              </s-stack>
            ))}
            <s-text color="subdued">
              Jei paštomatai pigesni už standartinį pristatymą, Shopify juos pažymi atsiskaitant automatiškai.{" "}
              <s-link href={links.shipping} target="_top">Pristatymo nustatymai</s-link>
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
          <s-badge tone={done ? "success" : "warning"}>{done ? "Atlikta" : "Reikia atlikti"}</s-badge>
        )}
        <s-text type="strong">{title}</s-text>
      </s-stack>
      <s-text color="subdued">{children}</s-text>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
