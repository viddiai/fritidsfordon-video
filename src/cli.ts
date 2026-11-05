// Kommandon:
//   sync                 – hämta annonser från sajten en gång
//   worker               – rendera köade videor (kör tills den stoppas) + schemalagd synk
//   worker --once        – rendera det som ligger i kön och avsluta
//   all                  – granskningsvy + worker + schemalagd synk i samma process (enklast i drift)
//   render-one <id>      – köa och rendera ett fordon direkt (pageId, t.ex. 54103)
import {cfg} from './lib/config';
import {db} from './lib/db';
import {syncOnce} from './lib/sync';
import {runWorker, scheduleSync} from './lib/worker';
import {enqueueVideo} from './lib/pipeline';
import {startServer} from './server/index';

const [cmd, ...args] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case 'sync':
      await syncOnce();
      break;
    case 'worker':
      if (!args.includes('--once')) scheduleSync();
      await runWorker({once: args.includes('--once')});
      break;
    case 'all':
      startServer();
      scheduleSync();
      syncOnce().catch((e) => console.error('[sync] fel vid start', e));
      await runWorker();
      break;
    case 'render-one': {
      const id = args[0];
      if (!id) throw new Error('Ange fordonets id, t.ex. render-one 54103');
      const d = await db();
      const [exists] = await d.query('select 1 from vehicles where id=$1', [id]);
      if (!exists) {
        const keep = cfg.backfillLimit;
        cfg.backfillLimit = 0;
        await syncOnce();
        cfg.backfillLimit = keep;
      }
      const vid = await enqueueVideo(id, args.includes('--sold') ? 'sold' : 'listing', 0);
      console.log(`Köade video ${vid ?? '(fanns redan i kö)'} för ${id}`);
      await runWorker({once: true});
      break;
    }
    default:
      console.log('Användning: tsx src/cli.ts <sync|worker [--once]|all|render-one <id> [--sold]>');
      process.exit(1);
  }
  if (cmd !== 'all' && !(cmd === 'worker' && !args.includes('--once'))) {
    await (await db()).close();
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
