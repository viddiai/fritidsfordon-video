// Granskningsvy: lista videor, spela upp båda formaten, godkänn/underkänn/gör om.
import {Hono} from 'hono';
import {basicAuth} from 'hono/basic-auth';
import {serveStatic} from '@hono/node-server/serve-static';
import path from 'node:path';
import {cfg} from '../lib/config';
import {db} from '../lib/db';
import {enqueueVideo, supersedeOlder, type StoredScript} from '../lib/pipeline';
import {syncOnce} from '../lib/sync';
import {kr} from '../lib/text';
import type {Vehicle} from '../video/types';

type VideoListRow = {
  id: number; vehicle_id: string; variant: string; status: string; file_vertical: string | null; file_landscape: string | null;
  duration_s: string | null; error: string | null; review_note: string | null; created_at: string; updated_at: string;
  script: StoredScript | null; data: Vehicle; vehicle_status: string; page_url: string;
};

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));
const fileUrl = (rel: string | null) => (rel ? `/files/${rel.split('/').map(encodeURIComponent).join('/')}` : '');
const fmtTime = (t: string) => new Date(t).toLocaleString('sv-SE', {timeZone: 'Europe/Stockholm', dateStyle: 'short', timeStyle: 'short'});

const STATUS: Record<string, [string, string]> = {
  queued: ['I kö', '#6b7280'], rendering: ['Renderar', '#2563eb'], review: ['Att granska', '#d97706'],
  approved: ['Godkänd', '#16a34a'], rejected: ['Underkänd', '#dc2626'], failed: ['Misslyckades', '#dc2626'], superseded: ['Ersatt', '#9ca3af'],
};
const badge = (s: string) => `<span class="badge" style="background:${STATUS[s]?.[1] ?? '#6b7280'}">${esc(STATUS[s]?.[0] ?? s)}</span>`;

const layout = (title: string, body: string) => `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Fritidscenter video</title>
<style>
:root{--brand:#C6390C;--bg:#f5f5f4;--card:#fff;--text:#111418;--muted:#6b7280;--line:#e7e5e4}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}
header{background:#111418;color:#fff;padding:14px 24px;display:flex;align-items:center;gap:24px;flex-wrap:wrap}
header a{color:#fff;text-decoration:none;opacity:.8}header a:hover,header a.on{opacity:1}header b{color:var(--brand);font-size:18px}
main{max-width:1280px;margin:0 auto;padding:24px 16px}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}.tabs a{padding:8px 14px;border-radius:999px;background:var(--card);border:1px solid var(--line);color:var(--text);text-decoration:none;font-size:14px}
.tabs a.on{background:var(--text);color:#fff;border-color:var(--text)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;display:block}
.card video,.card img{width:100%;aspect-ratio:9/16;object-fit:cover;background:#222;display:block}
.card .ph{aspect-ratio:9/16;background:#e7e5e4;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:14px}
.card .b{padding:10px 12px}.card h3{margin:0 0 4px;font-size:15px}.muted{color:var(--muted);font-size:13px}
.badge{display:inline-block;color:#fff;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px}
.players{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:16px;align-items:start}
.players video{width:100%;max-height:78vh;border-radius:10px;background:#000}
@media(max-width:800px){.players{grid-template-columns:1fr}}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-top:16px}
.panel h2{margin:0 0 10px;font-size:16px}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
button,.btn{font:inherit;padding:10px 18px;border-radius:8px;border:0;cursor:pointer;font-weight:600;text-decoration:none;display:inline-block}
.ok{background:#16a34a;color:#fff}.no{background:#dc2626;color:#fff}.alt{background:#e7e5e4;color:var(--text)}.pri{background:var(--brand);color:#fff}
.actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}textarea{width:100%;font:inherit;padding:8px;border-radius:8px;border:1px solid var(--line);min-height:60px}
.script li{margin-bottom:8px}.err{white-space:pre-wrap;font-size:12px;background:#fef2f2;padding:10px;border-radius:8px;overflow:auto;max-height:240px}
</style></head><body>
<header><b>Fritidscenter · Video</b><a href="/">Videor</a><a href="/vehicles">Fordon</a><a href="/api/videos?status=approved">API</a></header>
<main>${body}</main></body></html>`;

export function createApp() {
  const app = new Hono();

  if (cfg.adminPassword) app.use('*', basicAuth({username: cfg.adminUser, password: cfg.adminPassword}));

  app.use('/files/*', serveStatic({root: path.relative(process.cwd(), cfg.storageDir) || '.', rewriteRequestPath: (p) => decodeURIComponent(p.replace(/^\/files/, ''))}));

  const videoQuery = `select v.*, ve.data, ve.status as vehicle_status, ve.page_url from videos v join vehicles ve on ve.id = v.vehicle_id`;

  app.get('/', async (c) => {
    const d = await db();
    const tab = c.req.query('tab') ?? 'review';
    const counts = Object.fromEntries((await d.query<{status: string; n: string}>(
      `select status, count(*) n from videos group by status`)).map((r) => [r.status, Number(r.n)]));
    const filter: Record<string, string> = {
      review: `v.status = 'review'`, approved: `v.status = 'approved'`, queue: `v.status in ('queued','rendering')`,
      failed: `v.status in ('failed','rejected')`, all: `true`,
    };
    const rows = await d.query<VideoListRow>(`${videoQuery} where ${filter[tab] ?? filter.review} order by v.updated_at desc limit 200`);
    const [lastSync] = await d.query<any>(`select * from sync_runs order by id desc limit 1`);
    const tabs = [
      ['review', `Att granska (${counts.review ?? 0})`], ['approved', `Godkända (${counts.approved ?? 0})`],
      ['queue', `I kö (${(counts.queued ?? 0) + (counts.rendering ?? 0)})`], ['failed', `Misslyckade/underkända (${(counts.failed ?? 0) + (counts.rejected ?? 0)})`], ['all', 'Alla'],
    ];
    const cards = rows.map((r) => `<a class="card" href="/videos/${r.id}">
      ${r.file_vertical ? `<video src="${fileUrl(r.file_vertical)}#t=2" preload="metadata" muted playsinline></video>` : `<div class="ph">${esc(STATUS[r.status]?.[0] ?? r.status)}…</div>`}
      <div class="b"><h3>${esc(r.data.marke)} ${esc(r.data.modell)} ${esc(r.data.modellar)}</h3>
      <div class="muted">${r.variant === 'sold' ? '<b>SÅLD-version</b> · ' : ''}${esc(kr(r.data.pris))} · ${esc(r.data.anlaggning)}</div>
      <div style="margin-top:6px">${badge(r.status)} <span class="muted">${fmtTime(r.updated_at)}</span></div></div></a>`).join('');
    return c.html(layout('Videor', `
      <div class="actions" style="justify-content:space-between;margin-bottom:16px">
        <div class="muted">Senaste koll av sajten: ${lastSync ? `${fmtTime(lastSync.started_at)}${lastSync.error ? ' (fel)' : ` · ${lastSync.seen ?? '–'} fordon, ${lastSync.created ?? 0} nya, ${lastSync.sold ?? 0} sålda`}` : 'aldrig'}
          · ${cfg.autoApprove ? 'Automatiskt godkännande är PÅ' : 'Manuell granskning'}</div>
        <form method="post" action="/sync"><button class="alt">Kolla efter nya annonser nu</button></form>
      </div>
      <nav class="tabs">${tabs.map(([k, l]) => `<a href="/?tab=${k}" class="${k === tab ? 'on' : ''}">${esc(l)}</a>`).join('')}</nav>
      ${rows.length ? `<div class="grid">${cards}</div>` : '<p class="muted">Inget här just nu.</p>'}`));
  });

  app.get('/videos/:id', async (c) => {
    const d = await db();
    const [r] = await d.query<VideoListRow>(`${videoQuery} where v.id = $1`, [Number(c.req.param('id'))]);
    if (!r) return c.notFound();
    const v = r.data, s = r.script;
    const scriptHtml = s ? `<ol class="script">
      <li><b>Intro:</b> ${esc(s.introVoice)}</li>
      ${s.points.map((p) => `<li><b>${esc(p.text)}</b><br><span class="muted">Röst:</span> ${esc(p.voice)}</li>`).join('')}
      <li><b>Fakta:</b> ${esc(s.specsVoice)}</li>
      <li><b>Avslutning:</b> ${esc(r.variant === 'sold' ? s.soldOutroVoice : s.outroVoice)}</li></ol>
      <div class="muted">Manus: ${s.source === 'claude' ? `Claude (${esc(s.model)})` : 'reservmanus (ingen Claude-nyckel)'} · Röst: ${s.segments?.some((x) => x.file) ? 'ElevenLabs' : 'ingen'}</div>` : '<p class="muted">Inget manus än.</p>';
    const facts = `<table>
      <tr><th>Pris</th><td>${esc(kr(v.pris))}${v.ordPris ? ` <s class="muted">${esc(kr(v.ordPris))}</s>` : ''}</td></tr>
      <tr><th>Delbetalning</th><td>${v.manad ? esc(kr(v.manad)) + '/mån' : '–'}</td></tr>
      <tr><th>Anläggning</th><td>${esc(v.anlaggning)} · ${esc(v.telefon)}</td></tr>
      ${Object.entries(v.specs).map(([k, val]) => `<tr><th>${esc(k)}</th><td>${esc(val)}</td></tr>`).join('')}
      <tr><th>Annons</th><td><a href="${esc(r.page_url)}" target="_blank">${esc(r.page_url)}</a></td></tr></table>`;
    const canReview = r.status === 'review' || r.status === 'approved' || r.status === 'rejected';
    return c.html(layout(`${v.marke} ${v.modell}`, `
      <p><a href="/">← Tillbaka</a></p>
      <h1 style="margin:0 0 6px">${esc(v.marke)} ${esc(v.modell)} ${esc(v.modellar)} ${r.variant === 'sold' ? '· SÅLD-version' : ''}</h1>
      <p>${badge(r.status)} <span class="muted">Video #${r.id} · ${r.duration_s ? Number(r.duration_s).toFixed(1) + ' s · ' : ''}uppdaterad ${fmtTime(r.updated_at)}</span></p>
      ${r.file_vertical ? `<div class="players">
        <div><div class="muted">9:16 – Reels/Stories</div><video src="${fileUrl(r.file_vertical)}#t=3" controls playsinline preload="metadata"></video>
          <a class="muted" href="${fileUrl(r.file_vertical)}" download>Ladda ner</a></div>
        <div><div class="muted">16:9 – webb/Facebook</div><video src="${fileUrl(r.file_landscape)}#t=3" controls playsinline preload="metadata"></video>
          <a class="muted" href="${fileUrl(r.file_landscape)}" download>Ladda ner</a></div></div>` : `<div class="panel">Videon är inte klar än (${esc(STATUS[r.status]?.[0])}). Ladda om sidan om en stund.</div>`}
      ${r.error ? `<div class="panel"><h2>Senaste fel</h2><div class="err">${esc(r.error)}</div></div>` : ''}
      <div class="panel"><h2>Granska</h2>
        ${r.review_note ? `<p><b>Kommentar:</b> ${esc(r.review_note)}</p>` : ''}
        <form method="post" action="/videos/${r.id}/review" class="actions" style="flex-direction:column;align-items:stretch">
          <textarea name="note" placeholder="Kommentar (valfritt, t.ex. vad som ska ändras)"></textarea>
          <div class="actions">
            ${canReview ? `<button class="ok" name="action" value="approve">Godkänn</button><button class="no" name="action" value="reject">Underkänn</button>` : ''}
            <button class="alt" name="action" value="redo">Gör om (nytt manus och ny rendering)</button>
          </div></form></div>
      <div class="panel"><h2>Manus</h2>${scriptHtml}</div>
      <div class="panel"><h2>Fakta från annonsen</h2>${facts}</div>`));
  });

  app.post('/videos/:id/review', async (c) => {
    const d = await db();
    const id = Number(c.req.param('id'));
    const form = await c.req.parseBody();
    const note = String(form.note ?? '').trim() || null;
    const action = String(form.action);
    const [r] = await d.query<{vehicle_id: string; variant: 'listing' | 'sold'}>('select vehicle_id, variant from videos where id=$1', [id]);
    if (!r) return c.notFound();
    if (action === 'approve') {
      await d.query(`update videos set status='approved', approved_at=now(), review_note=coalesce($2, review_note), updated_at=now() where id=$1`, [id, note]);
      await supersedeOlder(id);
    } else if (action === 'reject') {
      await d.query(`update videos set status='rejected', review_note=$2, updated_at=now() where id=$1`, [id, note]);
    } else if (action === 'redo') {
      if (note) await d.query(`update videos set review_note=$2, updated_at=now() where id=$1`, [id, note]);
      const newId = await enqueueVideo(r.vehicle_id, r.variant, 10);
      if (newId) return c.redirect(`/videos/${newId}`);
    }
    return c.redirect(`/videos/${id}`);
  });

  app.get('/vehicles', async (c) => {
    const d = await db();
    const rows = await d.query<{id: string; title: string; status: string; filial: string; price: string; sale_price: string | null; page_url: string; site_created: string; latest: string | null; latest_id: number | null}>(
      `select ve.id, ve.title, ve.status, ve.filial, ve.price, ve.sale_price, ve.page_url, ve.site_created,
         (select status from videos where vehicle_id = ve.id order by created_at desc limit 1) latest,
         (select id from videos where vehicle_id = ve.id order by created_at desc limit 1) latest_id
       from vehicles ve order by ve.status, ve.site_created desc nulls last`);
    const noVideo = rows.filter((r) => !r.latest && r.status === 'active').length;
    return c.html(layout('Fordon', `
      <div class="actions" style="justify-content:space-between;margin-bottom:12px">
        <h1 style="margin:0">Fordon (${rows.length})</h1>
        ${noVideo ? `<form method="post" action="/vehicles/queue-missing"><button class="pri">Skapa video för alla ${noVideo} utan video</button></form>` : ''}
      </div>
      <div class="panel" style="padding:0 6px"><table>
      <tr><th>Fordon</th><th>Anläggning</th><th>Pris</th><th>Status</th><th>Video</th><th></th></tr>
      ${rows.map((r) => `<tr><td><a href="${esc(r.page_url)}" target="_blank">${esc(r.title)}</a><div class="muted">#${esc(r.id)} · inlagd ${r.site_created ? fmtTime(r.site_created) : '–'}</div></td>
        <td>${esc(r.filial)}</td><td>${esc(kr(Number(r.sale_price ?? r.price)))}</td>
        <td>${r.status === 'sold' ? '<b>Såld</b>' : 'Till salu'}</td>
        <td>${r.latest ? `<a href="/videos/${r.latest_id}">${badge(r.latest)}</a>` : '<span class="muted">–</span>'}</td>
        <td>${r.status === 'active' ? `<form method="post" action="/vehicles/${esc(r.id)}/video"><button class="alt">${r.latest ? 'Ny video' : 'Skapa video'}</button></form>` : ''}</td></tr>`).join('')}
      </table></div>`));
  });

  app.post('/vehicles/:id/video', async (c) => {
    const id = await enqueueVideo(c.req.param('id'), 'listing', 10);
    return c.redirect(id ? `/videos/${id}` : '/vehicles');
  });

  app.post('/vehicles/queue-missing', async (c) => {
    const d = await db();
    const rows = await d.query<{id: string}>(
      `select id from vehicles ve where status='active' and not exists (select 1 from videos where vehicle_id = ve.id) order by site_created desc`);
    for (const r of rows) await enqueueVideo(r.id, 'listing', 150);
    return c.redirect('/?tab=queue');
  });

  app.post('/sync', async (c) => {
    syncOnce().catch((e) => console.error('[sync] fel', e));
    return c.redirect('/?tab=queue');
  });

  // JSON för kommande publicering (webb, Instagram, Facebook)
  app.get('/api/videos', async (c) => {
    const d = await db();
    const status = c.req.query('status') ?? 'approved';
    const rows = await d.query<VideoListRow>(`${videoQuery} where v.status = $1 order by v.approved_at desc nulls last, v.updated_at desc limit 500`, [status]);
    const abs = (rel: string | null) => (rel ? cfg.publicBaseUrl + fileUrl(rel) : null);
    return c.json(rows.map((r) => ({
      id: r.id, vehicleId: r.vehicle_id, variant: r.variant, status: r.status, vehicleStatus: r.vehicle_status,
      title: `${r.data.marke} ${r.data.modell} ${r.data.modellar}`, price: r.data.pris, pageUrl: r.page_url,
      vertical: abs(r.file_vertical), landscape: abs(r.file_landscape), durationSeconds: r.duration_s ? Number(r.duration_s) : null,
      caption: r.script?.introVoice ?? null, updatedAt: r.updated_at,
    })));
  });

  app.get('/health', (c) => c.json({ok: true}));
  return app;
}
