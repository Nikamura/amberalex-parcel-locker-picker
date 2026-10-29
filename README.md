# Parcel locker picker

Shopify app that lets buyers choose a parcel locker (paštomatas) at checkout, before payment, and saves the chosen locker on the order.

- **Checkout:** registers a carrier service. For each rate request it returns the nearest lockers per enabled network (Omniva, LP Express, DPD, Venipak, SmartPosti…) as shipping options, priced per network, with an optional free-delivery threshold. Works with Shopify's market-based shipping settings; the store needs carrier-calculated shipping (Grow on annual billing, Advanced, Plus, or the CCS add-on).
- **Orders:** on `orders/create`, if the shipping line is a locker rate, the app writes the locker to an app metafield (`$app.parcel_locker`) and to order attributes (`Parcel locker`, `Parcel locker ID`). Optionally it replaces the shipping address with the locker address, for shipping tools that only read the address (e.g. Alsendo's Shopify importer).
- **Locker catalogue:** synced daily from Alsendo's public list (`https://www.alsendo.lt/api/v1/parcel_machines`, ~5,000 lockers in LT/LV/EE). Locker IDs are Alsendo terminal IDs, so a later version can create Alsendo shipments with `shipping_type: "terminal"`.

The buyer's position is estimated from the postcode (centroid of lockers with the longest matching postcode prefix, falling back to the city name). No external geocoder.

## Develop

```sh
pnpm install
pnpm test
pnpm shopify app config link   # fill client_id
pnpm dev
```

Stack: React Router Shopify template, Drizzle + SQLite (`DATABASE_PATH`), Polaris web components.

## Deploy

```sh
cp .env.example .env   # fill in
docker compose up -d --build
```

Expose port 3000 over HTTPS (Caddy, Cloudflare Tunnel…) at `SHOPIFY_APP_URL`, then `pnpm shopify app deploy` to push the app config and webhooks. If the app is down, checkout just shows the store's other shipping rates.

`orders/create` requires protected customer data access to be approved for the app in the Dev Dashboard.

## Roadmap

1. Create Alsendo shipments for locker orders (`POST /api/v1/orders` with the terminal ID; needs an Alsendo API token, and buys the label on create).
2. Admin order block showing the locker; thank-you page block to change it.
3. Map picker on the cart page for stores without carrier-calculated shipping.
