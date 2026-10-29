# Amber Alex parcel locker picker

Shopify app that lets buyers choose a parcel locker (paštomatas) at checkout, before payment, and saves the chosen locker on the order.

- **Checkout:** registers a carrier service. For each rate request it returns the nearest lockers per enabled network (Omniva, LP Express, DPD, Venipak, SmartPosti…) as shipping options, priced per network, with an optional free-delivery threshold. Works with Shopify's market-based shipping settings; the store needs carrier-calculated shipping (Grow on annual billing, Advanced, Plus, or the CCS add-on).
- **Orders:** on `orders/create`, if the shipping line is a locker rate, the app writes the locker to an app metafield (`$app.parcel_locker`) and to order attributes (`Parcel locker`, `Parcel locker ID`). Optionally it replaces the shipping address with the locker address, for shipping tools that only read the address (e.g. Alsendo's Shopify importer).
- **Locker catalogue:** synced daily from Alsendo's public list (`https://www.alsendo.lt/api/v1/parcel_machines`, ~5,000 lockers in LT/LV/EE). Locker IDs are Alsendo terminal IDs, so a later version can create Alsendo shipments with `shipping_type: "terminal"`.

The buyer's position is estimated from the postcode (centroid of lockers with the longest matching postcode prefix). No external geocoder.

## Develop

```sh
pnpm install
pnpm test
pnpm shopify app config link   # fill client_id
pnpm dev
```

Stack: React Router Shopify template on Cloudflare Workers, Drizzle + D1, Polaris web components.

Local Worker: `pnpm exec wrangler d1 migrations apply amberalex-parcel-locker-picker --local`, `pnpm sync:lockers --local`, put `SHOPIFY_API_SECRET=…` in `.dev.vars`, then `pnpm build && pnpm preview`.

## Deploy

Runs on Cloudflare Workers + D1 (free plan) at `https://amberalex-parcel-locker-picker.karolis.workers.dev` (`SHOPIFY_APP_URL`); config in `wrangler.jsonc`. The URL is also set in `shopify.app.toml`, the thank-you extension (`APP_URL`) and the cart embed block. Changing it means `shopify app deploy` plus updating each shop's carrier service callback (saving the app settings page does that).

- **Deploys:** pushing to `main` runs `.github/workflows/deploy.yml` (checks, D1 migrations, `wrangler deploy`). Needs the `production` environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- **Locker catalogue:** `.github/workflows/sync-lockers.yml` runs `pnpm sync:lockers` daily (03:17 UTC). Parsing the 5,000-locker list doesn't fit the Workers free-plan CPU limit, so it runs in Actions and writes SQL to D1.
- **Secret:** `pnpm exec wrangler secret put SHOPIFY_API_SECRET` once.
- **App config:** `pnpm shopify app deploy` pushes the app config, webhooks and extensions.

If the app is down, checkout just shows the store's other shipping rates.

`orders/create` requires protected customer data access to be approved for the app in the Dev Dashboard.

## Roadmap

1. Create Alsendo shipments for locker orders (`POST /api/v1/orders` with the terminal ID; needs an Alsendo API token, and buys the label on create).
2. Admin order block showing the locker.
