import {
  blob,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// Columns required by @shopify/shopify-app-session-storage-drizzle.
export const sessionTable = sqliteTable("session", {
  id: text("id").primaryKey(),
  shop: text("shop").notNull(),
  state: text("state").notNull(),
  isOnline: integer("isOnline", { mode: "boolean" }).notNull().default(false),
  scope: text("scope"),
  expires: text("expires"),
  accessToken: text("accessToken").notNull(),
  userId: blob("userId", { mode: "bigint" }),
  firstName: text("firstName"),
  lastName: text("lastName"),
  email: text("email"),
  accountOwner: integer("accountOwner", { mode: "boolean" }),
  locale: text("locale"),
  collaborator: integer("collaborator", { mode: "boolean" }),
  emailVerified: integer("emailVerified", { mode: "boolean" }),
  refreshToken: text("refreshToken"),
  refreshTokenExpires: text("refreshTokenExpires"),
});

// Shared locker catalogue, refreshed from each source on a schedule.
export const lockers = sqliteTable(
  "lockers",
  {
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    network: text("network").notNull(),
    countryCode: text("country_code").notNull(),
    name: text("name").notNull(),
    address: text("address").notNull(),
    city: text("city").notNull(),
    zip: text("zip").notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    comment: text("comment"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.externalId] }),
    index("lockers_country_network").on(t.countryCode, t.network),
  ],
);

export const shopSettings = sqliteTable("shop_settings", {
  shop: text("shop").primaryKey(),
  settings: text("settings", { mode: "json" }).notNull(),
  carrierServiceId: text("carrier_service_id"),
  currency: text("currency"),
  updatedAt: text("updated_at").notNull(),
});

export const syncRuns = sqliteTable("sync_runs", {
  source: text("source").primaryKey(),
  finishedAt: text("finished_at").notNull(),
  count: integer("count").notNull(),
  error: text("error"),
});
