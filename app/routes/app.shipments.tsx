import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getShopSettings, networkCounts, saveShopSettings } from "../lockers/repo.server";
import { networkShort, type AlsendoSettings } from "../lockers/settings";
import { alsendoConfigured } from "../alsendo/client.server";
import { missingSenderFields, serviceCodeFor } from "../alsendo/request";
import { cancelShipment, createShipment, recentLockerOrders } from "../alsendo/shipments.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const { settings } = await getShopSettings(session.shop);
  const counts = await networkCounts(settings.countries);
  const networks = [...new Set([...counts.map((c) => c.network), ...Object.keys(settings.alsendo.services)])].sort();
  const store = session.shop.replace(/\.myshopify\.com$/, "");
  return {
    alsendo: settings.alsendo,
    networks: networks.map((network) => ({ network, short: networkShort(network) })),
    configured: alsendoConfigured(),
    missing: missingSenderFields(settings.alsendo),
    orders: await recentLockerOrders(admin, session.shop),
    adminUrl: `https://admin.shopify.com/store/${store}`,
  };
};

const num = (v: FormDataEntryValue | null, fallback: number) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const orderId = str(form.get("orderId"));

  try {
    if (intent === "create") {
      const shipment = await createShipment(admin, session.shop, orderId);
      if (shipment?.status !== "created") return { ok: false as const, intent, error: shipment?.error ?? "Siunta nesukurta" };
      return { ok: true as const, intent, message: `Siunta ${shipment.shipmentId} sukurta` };
    }
    if (intent === "cancel") {
      await cancelShipment(admin, session.shop, orderId);
      return { ok: true as const, intent, message: "Siunta atšaukta" };
    }

    const previous = await getShopSettings(session.shop);
    const old = previous.settings.alsendo;
    const services: Record<string, string> = {};
    for (const network of form.getAll("network").map(String)) {
      const code = str(form.get(`service:${network}`)).toUpperCase();
      if (code) services[network] = code;
    }
    const alsendo: AlsendoSettings = {
      autoCreate: form.get("autoCreate") === "on",
      sender: {
        companyName: str(form.get("companyName")),
        contactName: str(form.get("contactName")),
        street: str(form.get("street")),
        city: str(form.get("city")),
        zip: str(form.get("zip")),
        phone: str(form.get("phone")),
        email: str(form.get("email")),
      },
      parcel: {
        x: num(form.get("x"), old.parcel.x),
        y: num(form.get("y"), old.parcel.y),
        z: num(form.get("z"), old.parcel.z),
        weight: num(form.get("weight"), old.parcel.weight),
      },
      services,
    };
    await saveShopSettings(session.shop, { ...previous, settings: { ...previous.settings, alsendo } });
    return { ok: true as const, intent: "settings", message: "Nustatymai išsaugoti" };
  } catch (error) {
    return { ok: false as const, intent, error: error instanceof Error ? error.message : String(error) };
  }
};

type ActionResult = Awaited<ReturnType<typeof action>>;

const STATUS: Record<string, { tone: "success" | "critical" | "warning" | "neutral" | "info"; label: string }> = {
  created: { tone: "success", label: "Sukurta" },
  failed: { tone: "critical", label: "Nepavyko" },
  cancelled: { tone: "neutral", label: "Atšaukta" },
  creating: { tone: "info", label: "Kuriama…" },
};

export default function Shipments() {
  const { alsendo, networks, configured, missing, orders, adminUrl } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const saving = useNavigation().state === "submitting";
  const shopify = useAppBridge();

  useEffect(() => {
    if (result?.ok) shopify.toast.show(result.message);
    else if (result && !result.ok) shopify.toast.show(result.error, { isError: true });
  }, [result, shopify]);

  const ready = configured && missing.length === 0;
  const s = alsendo.sender;

  return (
    <s-page heading="Alsendo siuntos">
      <s-stack direction="block" gap="base">
        {!configured ? (
          <s-banner tone="critical" heading="Trūksta Alsendo API rakto">
            Nustatykite Worker paslaptį ALSENDO_API_TOKEN ir perkraukite šį puslapį.
          </s-banner>
        ) : missing.length ? (
          <s-banner tone="warning" heading="Užpildykite siuntėjo duomenis">
            Siuntoms trūksta paėmimo duomenų: {missing.join(", ")}.
          </s-banner>
        ) : alsendo.autoCreate ? (
          <s-banner tone="success" heading="Automatiškai">
            Siunta sukuriama, kai tik užsakymas turi paštomatą. Alsendo apmokestina tik kurjeriui nuskenavus siuntą;
            nesiunčiamas siuntas atšaukite.
          </s-banner>
        ) : (
          <s-banner tone="info" heading="Rankiniu būdu">
            Siuntas kurkite iš sąrašo žemiau arba įjunkite automatinį kūrimą.
          </s-banner>
        )}

        <s-section heading="Naujausi užsakymai į paštomatus">
          {orders.length === 0 ? (
            <s-paragraph>Tarp paskutinių 75 užsakymų nėra užsakymų į paštomatus.</s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Užsakymas</s-table-header>
                <s-table-header>Paštomatas</s-table-header>
                <s-table-header>Siunta</s-table-header>
                <s-table-header>Veiksmai</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {orders.map((o) => (
                  <OrderRow key={o.id} order={o} adminUrl={adminUrl} ready={ready} hasService={Boolean(o.locker && serviceCodeFor(alsendo, o.locker.network))} />
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>

        <Form method="post" data-save-bar data-discard-confirmation>
          <input type="hidden" name="intent" value="settings" />
          <s-stack direction="block" gap="base">
            <s-section heading="Kūrimas">
              <s-checkbox
                name="autoCreate"
                label="Kurti Alsendo siuntą automatiškai"
                details="Kai tik užsakymas turi paštomatą: atsiskaitant arba kai pirkėjas jį pasirenka po apmokėjimo."
                defaultChecked={alsendo.autoCreate}
              />
            </s-section>

            <s-section heading="Siuntėjas (kurjerio paėmimas)">
              <s-stack direction="block" gap="base">
                <s-text-field name="companyName" label="Įmonė" defaultValue={s.companyName} />
                <s-text-field name="contactName" label="Kontaktinis asmuo" required defaultValue={s.contactName} />
                <s-text-field name="street" label="Gatvė ir numeris" required defaultValue={s.street} />
                <s-stack direction="inline" gap="base">
                  <s-text-field name="city" label="Miestas" required defaultValue={s.city} />
                  <s-text-field name="zip" label="Pašto kodas" required details="Be LT-" defaultValue={s.zip} />
                </s-stack>
                <s-stack direction="inline" gap="base">
                  <s-text-field name="phone" label="Telefonas" required defaultValue={s.phone} />
                  <s-email-field name="email" label="El. paštas" defaultValue={s.email} />
                </s-stack>
              </s-stack>
            </s-section>

            <s-section heading="Numatytasis siuntinys">
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="base">
                  <s-text-field name="x" label="Plotis (cm)" defaultValue={String(alsendo.parcel.x)} />
                  <s-text-field name="y" label="Ilgis (cm)" defaultValue={String(alsendo.parcel.y)} />
                  <s-text-field name="z" label="Aukštis (cm)" defaultValue={String(alsendo.parcel.z)} />
                  <s-text-field name="weight" label="Svoris (kg)" defaultValue={String(alsendo.parcel.weight)} />
                </s-stack>
                <s-text color="subdued">Jei užsakymo prekės turi svorį, naudojamas užsakymo svoris.</s-text>
              </s-stack>
            </s-section>

            <s-section heading="Alsendo paslaugos">
              <s-stack direction="block" gap="base">
                {networks.map((n) => (
                  <s-stack key={n.network} direction="inline" gap="base" alignItems="center">
                    <input type="hidden" name="network" value={n.network} />
                    <s-text-field
                      name={`service:${n.network}`}
                      label={`${n.short} paslaugos kodas`}
                      defaultValue={alsendo.services[n.network] ?? ""}
                    />
                  </s-stack>
                ))}
                <s-text color="subdued">
                  Kurjeris – paštomatas: DPD S240, Omniva S218, Venipak S217. Palikite tuščią tipams, kurių Alsendo nesiunčia
                  (LP Express paštomatų šioje paskyroje nėra).
                </s-text>
              </s-stack>
            </s-section>

            <s-stack direction="inline" justifyContent="end">
              <s-button type="submit" variant="primary" {...(saving ? { loading: true } : {})}>
                Išsaugoti
              </s-button>
            </s-stack>
          </s-stack>
        </Form>
      </s-stack>
    </s-page>
  );
}

type OrderItem = ReturnType<typeof useLoaderData<typeof loader>>["orders"][number];

function OrderRow({ order, adminUrl, ready, hasService }: { order: OrderItem; adminUrl: string; ready: boolean; hasService: boolean }) {
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";
  const shipment = order.shipment;
  const status = shipment ? STATUS[shipment.status] : null;

  useEffect(() => {
    const r = fetcher.data;
    if (!r) return;
    if (r.ok) shopify.toast.show(r.message);
    else shopify.toast.show(r.error, { isError: true });
  }, [fetcher.data, shopify]);

  async function downloadLabel(size: "a6" | "a4") {
    // App Bridge adds the session token to same-origin fetches.
    const res = await fetch(`/app/shipments/label?order=${encodeURIComponent(order.id)}&size=${size}`);
    if (!res.ok) {
      shopify.toast.show("Lipdukas dar neparuoštas", { isError: true });
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${order.name.replace(/\W+/g, "")}-${shipment?.shipmentId ?? "label"}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  const submit = (intent: string) => fetcher.submit({ intent, orderId: order.id }, { method: "post" });
  const canCreate = ready && hasService && order.locker && !order.cancelled && (!shipment || shipment.status === "failed" || shipment.status === "cancelled");

  return (
    <s-table-row>
      <s-table-cell>
        <s-stack direction="block">
          <s-link href={`${adminUrl}/orders/${order.id.split("/").pop()}`} target="_top">
            {order.name}
          </s-link>
          <s-text color="subdued">
            {new Date(order.createdAt).toLocaleDateString("lt-LT", { timeZone: "Europe/Vilnius" })}
            {order.cancelled ? " · atšauktas" : ""}
          </s-text>
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        {order.locker ? (
          <s-stack direction="block">
            <s-text>{networkShort(order.locker.network)}</s-text>
            <s-text color="subdued">
              {order.locker.name}, {order.locker.city}
            </s-text>
          </s-stack>
        ) : (
          <s-text color="subdued">{order.lockerLabel ?? "Dar nepasirinktas"}</s-text>
        )}
      </s-table-cell>
      <s-table-cell>
        <s-stack direction="block" gap="small-300">
          {status ? <s-badge tone={status.tone}>{status.label}</s-badge> : order.locker && !hasService ? <s-text color="subdued">Nėra Alsendo paslaugos</s-text> : <s-text color="subdued">—</s-text>}
          {shipment?.shipmentId && shipment.status === "created" ? <s-text>{shipment.shipmentId}</s-text> : null}
          {shipment?.trackingNumber && shipment.status === "created" ? <s-text color="subdued">{shipment.trackingNumber}</s-text> : null}
          {shipment?.status === "failed" && shipment.error ? <s-text tone="critical">{shipment.error}</s-text> : null}
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-stack direction="inline" gap="small-200">
          {canCreate ? (
            <s-button onClick={() => submit("create")} {...(busy ? { loading: true } : {})}>
              {shipment ? "Kurti iš naujo" : "Kurti"}
            </s-button>
          ) : null}
          {shipment?.status === "created" ? (
            <>
              <s-button onClick={() => downloadLabel("a6")}>Lipdukas</s-button>
              <s-button onClick={() => downloadLabel("a4")} variant="tertiary">
                A4
              </s-button>
              <s-button tone="critical" variant="tertiary" onClick={() => submit("cancel")} {...(busy ? { loading: true } : {})}>
                Atšaukti
              </s-button>
            </>
          ) : null}
        </s-stack>
      </s-table-cell>
    </s-table-row>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
