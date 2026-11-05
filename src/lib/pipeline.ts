// Från fordon i databasen till färdiga videor: manus -> röst -> rendering (9:16 + 16:9).
import {cfg} from './config';
import {db, json} from './db';
import {downloadImages} from './assets';
import {fetchDetail, type DsoDetail} from './scrape';
import {outroVoices, writeScript, type Script} from './script';
import {estimateSeconds, synthesize, voiceEnabled, type VoiceSegment} from './voice';
import {renderFormat} from './render';
import {AUDIO_DELAY, FPS, MIN_FRAMES} from '../video/VehicleVideo';
import type {Scene, Vehicle} from '../video/types';

export type VideoRow = {
  id: number; vehicle_id: string; variant: 'listing' | 'sold'; status: string; attempts: number;
  script: StoredScript | null; file_vertical: string | null; file_landscape: string | null;
};
export type StoredScript = Script & {segments: VoiceSegment[]; scenes: Scene[]};

const TAIL = 14; // frames luft efter repliken innan nästa scen

function sceneFrames(kind: keyof typeof MIN_FRAMES, seg?: VoiceSegment) {
  if (!seg?.file) return MIN_FRAMES[kind];
  const secs = seg.seconds ?? estimateSeconds(seg.text);
  return Math.max(MIN_FRAMES[kind], Math.ceil(secs * FPS) + AUDIO_DELAY + TAIL + (kind === 'outro' ? 30 : 0));
}

function buildScenes(v: Vehicle, s: Script, segs: VoiceSegment[], sold: boolean): Scene[] {
  const seg = (k: string) => segs.find((x) => x.key === k);
  const withAudio = (sc: Scene, k: string): Scene => ({...sc, audio: seg(k)?.file});
  const outroKey = sold ? 'outro_sold' : 'outro';
  return [
    withAudio({kind: 'intro', frames: sceneFrames('intro', seg('intro')), image: s.introImage}, 'intro'),
    ...s.points.map((p, i) => withAudio({kind: 'point', frames: sceneFrames('point', seg(`p${i}`)), image: p.image, text: p.text}, `p${i}`)),
    withAudio({kind: 'specs', frames: sceneFrames('specs', seg('specs'))}, 'specs'),
    withAudio({kind: 'outro', frames: sceneFrames('outro', seg(outroKey)), image: s.introImage}, outroKey),
  ];
}

async function loadVehicle(id: string): Promise<{v: Vehicle; detail: DsoDetail | null; uniqueId: string}> {
  const d = await db();
  const [row] = await d.query<{data: Vehicle; detail: DsoDetail | null; unique_id: string}>(
    'select data, detail, unique_id from vehicles where id = $1', [id]);
  if (!row) throw new Error(`Fordon ${id} finns inte`);
  return {v: row.data, detail: row.detail, uniqueId: row.unique_id};
}

/** Kör ett videojobb från början till slut. */
export async function processVideo(video: VideoRow, log = console.log) {
  const d = await db();
  const {v, uniqueId, detail: storedDetail} = await loadVehicle(video.vehicle_id);
  let detail = storedDetail;
  const sold = video.variant === 'sold';

  if (!detail && !sold) {
    detail = await fetchDetail(uniqueId).catch(() => null);
    if (detail) await d.query('update vehicles set detail = $2::jsonb where id = $1', [v.id, json(detail)]);
  }

  // Manus + röst. Såld-varianten återanvänder senaste annonsvideons manus och ljud.
  let stored: StoredScript;
  if (sold) {
    const [prev] = await d.query<{script: StoredScript}>(
      `select script from videos where vehicle_id = $1 and variant = 'listing' and script is not null
       order by (status = 'approved') desc, created_at desc limit 1`, [v.id]);
    const base = prev?.script ?? {...(await writeScript(v, detail)), segments: [], scenes: []};
    const soldText = outroVoices(v).soldOutroVoice;
    let segs = base.segments.filter((s) => s.key !== 'outro' && s.key !== 'outro_sold');
    if (voiceEnabled()) segs = [...segs, ...(await synthesize(video.id, [{key: 'outro_sold', text: soldText}]))];
    stored = {...base, soldOutroVoice: soldText, segments: segs, scenes: []};
  } else {
    log(`[video ${video.id}] Skriver manus (${cfg.anthropicKey ? cfg.claudeModel : 'reservmanus'})`);
    const script = await writeScript(v, detail);
    const segments: VoiceSegment[] = [
      {key: 'intro', text: script.introVoice},
      ...script.points.map((p, i) => ({key: `p${i}`, text: p.voice})),
      {key: 'specs', text: script.specsVoice},
      {key: 'outro', text: script.outroVoice},
    ];
    log(`[video ${video.id}] ${voiceEnabled() ? 'Spelar in speakerröst' : 'Ingen ElevenLabs-nyckel – renderar utan röst'}`);
    stored = {...script, segments: await synthesize(video.id, segments), scenes: []};
  }

  const usedImages = [stored.introImage, ...stored.points.map((p) => p.image)];
  await downloadImages(v.id, [...new Set(usedImages)]);

  stored.scenes = buildScenes(v, stored, stored.segments, sold);
  await d.query('update videos set script = $2::jsonb, updated_at = now() where id = $1', [video.id, json(stored)]);

  const props = {vehicle: {...v, saljpunkter: stored.points.map((p) => p.text)}, scenes: stored.scenes, sold};
  const slug = `${v.marke}-${v.modell}-${v.modellar}`.toLowerCase().replace(/[^a-z0-9åäö]+/g, '-').replace(/^-|-$/g, '');
  const dir = `videos/${v.id}/${video.id}-${sold ? 'sald-' : ''}${slug}`;

  log(`[video ${video.id}] Renderar 9:16`);
  const vert = await renderFormat(props, 'vertical', `${dir}-9x16.mp4`);
  log(`[video ${video.id}] Renderar 16:9`);
  const land = await renderFormat(props, 'landscape', `${dir}-16x9.mp4`);

  const status = cfg.autoApprove ? 'approved' : 'review';
  await d.query(
    `update videos set status = $2, file_vertical = $3, file_landscape = $4, duration_s = $5, error = null,
       locked_at = null, updated_at = now(), approved_at = case when $2 = 'approved' then now() else null end
     where id = $1`,
    [video.id, status, vert.file, land.file, vert.seconds]);
  if (status === 'approved') await supersedeOlder(video.id);
  log(`[video ${video.id}] Klar (${vert.seconds.toFixed(1)} s) -> ${status}`);
}

/** När en video godkänns blir äldre godkända videor för samma fordon ersatta. */
export async function supersedeOlder(videoId: number) {
  const d = await db();
  await d.query(
    `update videos set status = 'superseded', updated_at = now()
     where vehicle_id = (select vehicle_id from videos where id = $1) and id <> $1 and status in ('approved','review')`,
    [videoId]);
}

/** Lägger en video i kön (om det inte redan finns en köad/pågående för samma fordon och variant). */
export async function enqueueVideo(vehicleId: string, variant: 'listing' | 'sold', priority = 100) {
  const d = await db();
  const [busy] = await d.query(
    `select id from videos where vehicle_id = $1 and variant = $2 and status in ('queued','rendering')`, [vehicleId, variant]);
  if (busy) return null;
  const [row] = await d.query<{id: number}>(
    'insert into videos (vehicle_id, variant, priority) values ($1, $2, $3) returning id', [vehicleId, variant, priority]);
  return row.id;
}
