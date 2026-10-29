import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";

// D1 binding from wrangler.jsonc; migrations run in CI (`wrangler d1 migrations apply`).
const db = drizzle(env.DB, { schema });

export type DB = typeof db;
export default db;
