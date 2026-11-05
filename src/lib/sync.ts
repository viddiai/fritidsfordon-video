// Synk mot fritidscenter.se: nya fordon, ändrade priser/bilder, sålda fordon.
import {cfg} from './config';
import {db, json} from './db';
import {fetchDetail, fetchListings, normalize, videoHash, type DsoObject} from './scrape';
import {enqueueVideo} from './pipeline';

type Row = {id: string; status: string; video_hash: string | null};

export async function syncOnce(log = console.log) {
  const d = await db();
  const [run] = await d.query<{id: number}>('insert into sync_runs default values returning id');
  const stats = {seen: 0, created: 0, updated: 0, sold: 0, queued: 0};
  try {
    const listings = await fetchListings();
    stats.seen = listings.length;
    const existing = new Map((await d.query<Row>('select id, status, video_hash from vehicles')).map((r) => [r.id, r]));
    const firstRun = existing.size === 0;

    // Nyaste först, så att backfill-gränsen tar de senast inlagda
    const sorted = [...listings].sort((a, b) => b['@created'].localeCompare(a['@created']));
    const seenIds = new Set<string>();
    let backfillLeft = cfg.backfillLimit;

    // Detaljer (säljtext, utrustning) för nya fordon, fem åt gången
    const details = new Map<string, Awaited<ReturnType<typeof fetchDetail>> | null>();
    const fresh = sorted.filter((o) => !existing.has(String(o.pageId)));
    await Promise.all(Array.from({length: 5}, async () => {
      for (let o; (o = fresh.shift()); ) details.set(o.uniqueId, await fetchDetail(o.uniqueId).catch(() => null));
    }));

    for (const o of sorted) {
      const id = String(o.pageId);
      seenIds.add(id);
      const v = normalize(o);
      const hash = videoHash(o);
      const soldNow = o.isSold;
      const prev = existing.get(id);

      if (!prev) {
        const detail = details.get(o.uniqueId) ?? null;
        await d.query(
          `insert into vehicles (id, unique_id, type, title, filial, page_url, price, sale_price, status, data, detail, video_hash, site_created, sold_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14)`,
          [id, o.uniqueId, o.type, `${v.marke} ${v.modell} ${v.modellar}`, o.filial, v.url, o.price, o.salePrice,
            soldNow ? 'sold' : 'active', json(v), json(detail), hash, o['@created'], soldNow ? new Date().toISOString() : null]);
        stats.created++;
        if (!soldNow && (!firstRun || backfillLeft-- > 0)) {
          if (await enqueueVideo(id, 'listing', firstRun ? 200 : 100)) stats.queued++;
        }
        log(`[sync] Nytt fordon ${id}: ${v.marke} ${v.modell} ${v.modellar}`);
        continue;
      }

      const changed = prev.video_hash !== hash;
      await d.query(
        `update vehicles set unique_id=$2, title=$3, filial=$4, page_url=$5, price=$6, sale_price=$7, data=$8::jsonb,
           video_hash=$9, last_seen=now() where id=$1`,
        [id, o.uniqueId, `${v.marke} ${v.modell} ${v.modellar}`, o.filial, v.url, o.price, o.salePrice, json(v), hash]);

      if (soldNow && prev.status !== 'sold') await markSold(id, log, stats);
      else if (!soldNow && prev.status === 'sold') {
        await d.query(`update vehicles set status='active', sold_at=null where id=$1`, [id]);
        log(`[sync] ${id} är tillbaka som aktiv`);
      } else if (changed && !soldNow) {
        stats.updated++;
        // Ny video bara om fordonet redan haft en (pris eller bilder har ändrats)
        const [had] = await d.query(`select 1 from videos where vehicle_id=$1 and variant='listing' and status in ('review','approved')`, [id]);
        if (had && (await enqueueVideo(id, 'listing', 50))) {
          stats.queued++;
          log(`[sync] ${id} har ändrats (pris/bilder) – ny video köad`);
        }
      }
    }

    // Försvunna fordon = sålda (om inte avstängt)
    if (cfg.soldOnDisappear) {
      for (const [id, r] of existing) if (!seenIds.has(id) && r.status !== 'sold') await markSold(id, log, stats);
    }

    await d.query(`update sync_runs set finished_at=now(), seen=$2, created=$3, updated=$4, sold=$5, queued=$6 where id=$1`,
      [run.id, stats.seen, stats.created, stats.updated, stats.sold, stats.queued]);
    log(`[sync] Klart: ${JSON.stringify(stats)}`);
    return stats;
  } catch (e: any) {
    await d.query(`update sync_runs set finished_at=now(), error=$2 where id=$1`, [run.id, String(e?.stack ?? e)]);
    throw e;
  }
}

async function markSold(id: string, log: typeof console.log, stats: {sold: number; queued: number}) {
  const d = await db();
  await d.query(`update vehicles set status='sold', sold_at=now() where id=$1`, [id]);
  stats.sold++;
  // Avbryt köade annonsvideor och gör en Såld-version om fordonet hade en video
  await d.query(`update videos set status='superseded', updated_at=now() where vehicle_id=$1 and variant='listing' and status='queued'`, [id]);
  const [had] = await d.query(`select 1 from videos where vehicle_id=$1 and variant='listing' and status in ('review','approved')`, [id]);
  if (had && (await enqueueVideo(id, 'sold', 20))) stats.queued++;
  log(`[sync] ${id} markerad som såld${had ? ' – Såld-video köad' : ''}`);
}

export type {DsoObject};
