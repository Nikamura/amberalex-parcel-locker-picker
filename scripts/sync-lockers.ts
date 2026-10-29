// Refreshes the locker catalogue in D1. Workers' free-plan CPU limit is too small
// to parse the full Alsendo list, so a scheduled GitHub Action runs this instead.
//
//   pnpm sync:lockers            # writes SQL and applies it to the remote D1 database
//   pnpm sync:lockers --local    # applies it to the local (wrangler dev) database
//   pnpm sync:lockers --dry-run  # only writes the SQL file
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchText } from "../app/lockers/search";
import { alsendoSource } from "../app/lockers/sources/alsendo";
import type { Locker } from "../app/lockers/types";

const DATABASE = "parcel-locker-picker";
// D1 caps a single statement at 100 KB; ~300 bytes per row keeps this well under.
const ROWS_PER_INSERT = 100;

const sql = (value: string | number | null) =>
  value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;

export function buildSyncSql(sourceId: string, list: Locker[], now: string): string {
  const statements: string[] = [];
  for (let i = 0; i < list.length; i += ROWS_PER_INSERT) {
    const rows = list.slice(i, i + ROWS_PER_INSERT).map((l) =>
      `(${[l.source, l.externalId, l.network, l.countryCode, l.name, l.address, l.city, l.zip, l.lat, l.lng, l.comment, searchText(l), now]
        .map(sql)
        .join(",")})`,
    );
    statements.push(
      "INSERT OR REPLACE INTO lockers (source,external_id,network,country_code,name,address,city,zip,lat,lng,comment,search,updated_at) VALUES\n" +
        rows.join(",\n") +
        ";",
    );
  }
  // Rows are replaced in place, so the catalogue is never empty mid-import;
  // anything the source no longer lists is dropped last.
  statements.push(`DELETE FROM lockers WHERE source = ${sql(sourceId)} AND updated_at <> ${sql(now)};`);
  statements.push(
    `INSERT INTO sync_runs (source,finished_at,count,error) VALUES (${sql(sourceId)},${sql(now)},${list.length},NULL)` +
      ` ON CONFLICT(source) DO UPDATE SET finished_at = excluded.finished_at, count = excluded.count, error = NULL;`,
  );
  return statements.join("\n");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const list = await alsendoSource.fetchLockers();
  if (list.length < 1000) throw new Error(`Only ${list.length} lockers returned; refusing to sync`);
  const file = join(mkdtempSync(join(tmpdir(), "plp-sync-")), "lockers.sql");
  writeFileSync(file, buildSyncSql(alsendoSource.id, list, new Date().toISOString()));
  console.log(`${list.length} lockers → ${file}`);
  if (args.has("--dry-run")) return;
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", DATABASE, args.has("--local") ? "--local" : "--remote", "--file", file, "--yes"], {
    stdio: "inherit",
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
