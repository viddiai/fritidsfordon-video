// Renderingskö: plockar köade videor ur databasen (FOR UPDATE SKIP LOCKED) och kör dem.
import cron from 'node-cron';
import {cfg} from './config';
import {db} from './db';
import {processVideo, type VideoRow} from './pipeline';
import {syncOnce} from './sync';

const MAX_ATTEMPTS = 3;

export async function claimNext(): Promise<VideoRow | null> {
  const d = await db();
  const [row] = await d.query<VideoRow>(
    `update videos set status='rendering', locked_at=now(), attempts=attempts+1, updated_at=now()
     where id = (select id from videos where status='queued' order by priority, created_at limit 1 for update skip locked)
     returning *`);
  return row ?? null;
}

export async function runWorker({once = false} = {}) {
  const d = await db();
  // Jobb som fastnat (t.ex. efter omstart) läggs tillbaka i kön
  await d.query(`update videos set status='queued', locked_at=null where status='rendering' and locked_at < now() - interval '2 hours'`);
  console.log('[worker] Startad');
  for (;;) {
    const job = await claimNext();
    if (!job) {
      if (once) return;
      await new Promise((r) => setTimeout(r, 10_000));
      continue;
    }
    try {
      await processVideo(job);
    } catch (e: any) {
      const msg = String(e?.stack ?? e).slice(0, 4000);
      console.error(`[worker] Video ${job.id} misslyckades:`, e?.message ?? e);
      await d.query(`update videos set status=$2, error=$3, locked_at=null, updated_at=now() where id=$1`,
        [job.id, job.attempts >= MAX_ATTEMPTS ? 'failed' : 'queued', msg]);
    }
  }
}

export function scheduleSync() {
  console.log(`[cron] Koll efter nya annonser: "${cfg.syncCron}" (Europe/Stockholm)`);
  let running = false;
  cron.schedule(cfg.syncCron, async () => {
    if (running) return;
    running = true;
    try { await syncOnce(); } catch (e) { console.error('[cron] Synk misslyckades', e); } finally { running = false; }
  }, {timezone: 'Europe/Stockholm'});
}
