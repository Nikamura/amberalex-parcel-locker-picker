import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./db/schema";

const path = process.env.DATABASE_PATH || "./data/app.sqlite";

function open() {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

export type DB = ReturnType<typeof open>;

declare global {
  // eslint-disable-next-line no-var
  var dbGlobal: DB | undefined;
}

const db = global.dbGlobal ?? open();
if (process.env.NODE_ENV !== "production") global.dbGlobal = db;

export default db;
