// Manus: Claude väljer säljpunkter + bilder och skriver speakertext.
// Priser och siffror i prisdelen kommer ALLTID direkt från datan (inte från Claude).
import Anthropic from '@anthropic-ai/sdk';
import {betaZodOutputFormat} from '@anthropic-ai/sdk/helpers/beta/zod';
import {z} from 'zod';
import {cfg} from './config';
import {thumbnailsBase64} from './assets';
import {numberToSwedish} from './text';
import type {Vehicle} from '../video/types';
import type {DsoDetail} from './scrape';

export type ScriptPoint = {text: string; image: string; voice: string};
export type Script = {
  introImage: string;
  introVoice: string;
  points: ScriptPoint[];
  specsVoice: string;
  outroVoice: string;
  soldOutroVoice: string;
  source: 'claude' | 'fallback';
  model?: string;
};

const ScriptSchema = z.object({
  intro_image: z.string().describe('Bild-id för öppningsbilden: snyggaste exteriörbilden av fordonet'),
  intro_voice: z.string().describe('Öppningsrepliken, max 18 ord'),
  points: z.array(z.object({
    text: z.string().describe('Kort säljpunkt som visas på skärmen, max 42 tecken, ingen punkt på slutet'),
    image: z.string().describe('Bild-id som tydligt visar just den säljpunkten'),
    voice: z.string().describe('Vad speakern säger under säljpunkten, max 16 ord'),
  })).describe('4–6 säljpunkter i en naturlig ordning (exteriör -> sittgrupp -> kök -> sovdel -> badrum/förvaring)'),
  specs_voice: z.string().describe('Kort replik när faktarutan visas, max 14 ord, utan siffror'),
});

const SYSTEM = `Du skriver manus till korta sälj-videor (30–45 sekunder) för Fritidscenter, en svensk återförsäljare av husbilar och husvagnar med anläggningar i Göteborg, Trollhättan och Mellerud.

Ton: varm, kunnig och rak – som en erfaren säljare som visar fordonet för en kund. Svenska, du-tilltal, inga överdrifter eller klyschor ("unik möjlighet", "drömmen"), inga utropstecken.

Regler:
- Använd bara fakta som finns i underlaget (säljtext, utrustningslista, specifikationer). Hitta inte på utrustning eller egenskaper.
- Nämn ALDRIG pris, kampanjpris, månadskostnad, ränta eller rabatter. Prisdelen läggs på automatiskt.
- Skriv tal med bokstäver ("hundrafemtio liter"), inga siffror – texten läses upp av en röst.
- Undantag: fältet "text" (det som visas på skärmen) får ha siffror, t.ex. "150 L kompressorkyl".
- Välj bilder genom att titta på bilderna. Varje säljpunkt ska ha en egen bild som faktiskt visar det som sägs. Undvik bilder på dokument, logotyper och närbilder som inte säger något.
- Tänk på att speakertexten och skärmtexten ska komplettera varandra, inte vara identiska.`;

function client() {
  return new Anthropic({apiKey: cfg.anthropicKey});
}

export function outroVoices(v: Vehicle) {
  const what = v.typ.toLowerCase();
  const price = `Priset är ${numberToSwedish(v.pris)} kronor` + (v.ordPris ? `, ordinarie ${numberToSwedish(v.ordPris)}` : '') + '.';
  const monthly = v.manad ? ` Delbetala från ${numberToSwedish(v.manad)} kronor i månaden.` : '';
  return {
    outroVoice: `${price}${monthly} Välkommen in till Fritidscenter i ${v.anlaggning} och boka en visning.`,
    soldOutroVoice: `Den här ${what === 'husbil' ? 'husbilen' : 'husvagnen'} är tyvärr redan såld – men vi har många fler. Titta in på fritidscenter punkt se.`,
  };
}

export async function writeScript(v: Vehicle, detail: DsoDetail | null): Promise<Script> {
  if (!cfg.anthropicKey) return fallbackScript(v, detail);

  const ids = v.bilder.slice(0, 30);
  const thumbs = await thumbnailsBase64(v.id, ids);
  const facts = {
    typ: v.typ, marke: v.marke, modell: v.modell, arsmodell: v.modellar, skick: v.skick,
    anlaggning: v.anlaggning, specifikationer: v.specs,
    saljtext: detail?.adInfo?.slice(0, 4000) ?? null,
    utrustning: detail?.description?.slice(0, 3000) ?? null,
    tillval: (detail?.equipment ?? []).map((e) => e.name).slice(0, 30),
  };

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const t of thumbs) {
    content.push({type: 'text', text: `Bild-id ${t.id}:`});
    content.push({type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: t.b64}});
  }
  content.push({
    type: 'text',
    text: `Underlag för fordonet:\n${JSON.stringify(facts, null, 2)}\n\nSkriv manus enligt schemat. Bild-id måste vara ett av: ${ids.join(', ')}.`,
  });

  const res = await client().beta.messages.parse({
    model: cfg.claudeModel,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: {effort: 'medium', format: betaZodOutputFormat(ScriptSchema)},
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{role: 'user', content}],
  });
  if (res.stop_reason === 'refusal' || !res.parsed_output) {
    console.warn(`[script] Claude gav inget manus (stop_reason=${res.stop_reason}) – använder reservmanus`);
    return fallbackScript(v, detail);
  }
  const out = res.parsed_output;
  const valid = new Set(ids);
  const used = new Set<string>();
  const pick = (id: string, i: number) => {
    let img = valid.has(id) && !used.has(id) ? id : ids.find((x, j) => j > 0 && !used.has(x)) ?? ids[i % ids.length];
    used.add(img);
    return img;
  };
  const introImage = valid.has(out.intro_image) ? out.intro_image : ids[0];
  used.add(introImage);
  return {
    introImage,
    introVoice: out.intro_voice,
    points: out.points.slice(0, 6).map((p, i) => ({text: p.text.replace(/\.$/, ''), image: pick(p.image, i + 1), voice: p.voice})),
    specsVoice: out.specs_voice,
    ...outroVoices(v),
    source: 'claude',
    model: cfg.claudeModel,
  };
}

/** Reservmanus utan Claude (för test, eller om API:t inte svarar). */
export function fallbackScript(v: Vehicle, detail: DsoDetail | null): Script {
  const items = (detail?.description ?? '')
    .split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length > 6 && s.length < 40 && !/[()]/.test(s));
  const pts = (v.saljpunkter.length ? v.saljpunkter : items).slice(0, 5);
  const imgs = v.punktBilder ?? v.bilder.slice(1);
  return {
    introImage: v.bilder[0],
    introVoice: `Välkommen till Fritidscenter. Här är ${v.skick === 'Ny' ? 'nya' : 'en fin'} ${v.marke} ${v.modell}.`,
    points: pts.map((t, i) => ({text: t, image: imgs[i % imgs.length] ?? v.bilder[0], voice: t + '.'})),
    specsVoice: 'Här är de viktigaste fakta.',
    ...outroVoices(v),
    source: 'fallback',
  };
}
