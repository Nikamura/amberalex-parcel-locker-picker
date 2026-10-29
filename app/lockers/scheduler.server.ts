import { lastSyncs, sources, syncSource } from "./repo.server";

const DAY = 24 * 60 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var lockerSchedulerStarted: boolean | undefined;
}

async function syncAll() {
  for (const source of sources) {
    try {
      const count = await syncSource(source);
      console.log(`[lockers] synced ${count} from ${source.id}`);
    } catch (error) {
      console.error(`[lockers] sync failed for ${source.id}`, error);
    }
  }
}

/** Syncs on boot when the catalogue is stale, then once a day. */
export function startLockerScheduler() {
  if (global.lockerSchedulerStarted || process.env.LOCKER_SYNC === "off") return;
  global.lockerSchedulerStarted = true;
  const synced = new Map(lastSyncs().filter((r) => !r.error).map((r) => [r.source, r.finishedAt]));
  const stale = sources.some((s) => {
    const at = synced.get(s.id);
    return !at || Date.now() - Date.parse(at) > DAY;
  });
  if (stale) void syncAll();
  setInterval(() => void syncAll(), DAY).unref();
}
