// Hämtar fordon från fritidscenter.se via Emporis öppna JSON-API (samma som sajtens fordonslista använder).
//   Lista:  GET /dsoApi/v1/objects            -> alla publicerade objekt (husvagnar, husbilar, bilar)
//   Detalj: GET /dsoApi/v1/object/{uniqueId}  -> säljtext, utrustning m.m.
import crypto from 'node:crypto';
import {cfg} from './config';
import {formatPhone} from './text';
import type {Vehicle} from '../video/types';

export type DsoSpec = {title: string; value: string | null};
export type DsoObject = {
  uniqueId: string; '@created': string; '@published': string;
  brand: string; category: string; model: string; year: number; milage: number; gearbox: number; fuel: number;
  type: number; effect: number; weight: number; title: string; condition: number;
  images: string[]; price: number; salePrice: number | null; pricePerMonth: number;
  specifications: DsoSpec[]; mainPhoneNumber: string; pageId: number; pageLink: string; articleNr: string;
  isSold: boolean; isReserved: boolean; filial: string; beds: number; layout: string | null;
  length: number; passengers: number;
  costCalculationValues?: {initialDownPayment: number; loanInterest: number; initialLoanPaymentYears: number; monthlyPaymentMinimum?: number};
};
export type DsoDetail = DsoObject & {
  description: string | null; adInfo: string | null;
  equipment: {name: string; price: number}[] | null;
};

const UA = 'FritidscenterVideoBot/1.0 (+https://fritidscenter.se)';

async function getJson<T>(url: string, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, {headers: {'user-agent': UA, accept: 'application/json'}});
      if (!r.ok) throw new Error(`${r.status} ${r.statusText} (${url})`);
      return (await r.json()) as T;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 1000 * 2 ** i));
    }
  }
}

export async function fetchListings(): Promise<DsoObject[]> {
  const d = await getJson<{items: DsoObject[]; total: number}>(`${cfg.siteBase}/dsoApi/v1/objects`);
  return d.items.filter((o) => cfg.vehicleTypes.includes(o.type));
}

export async function fetchDetail(uniqueId: string): Promise<DsoDetail> {
  return getJson<DsoDetail>(`${cfg.siteBase}/dsoApi/v1/object/${uniqueId}`);
}

/** Bild-id ur "/i/UserFiles/Products/54103/3426269.jpg?mw=..." */
export const imageIdsOf = (o: DsoObject) =>
  o.images.map((u) => u.match(/\/(\d+)\.(?:jpe?g|png|webp)/i)?.[1]).filter((x): x is string => !!x);

/** URL till bild i given bredd (sajtens resize-tjänst). */
export const imageUrl = (productId: string, imageId: string, width = 1920) =>
  `${cfg.siteBase}/i/UserFiles/Products/${productId}/${imageId}.jpg?mw=${width}&mh=${Math.round(width * 0.75)}&q=90`;

const CATEGORY: Record<string, string> = {
  'Single axle': 'Enaxlad', 'Double axle': 'Boggi', 'Half integrated': 'Halvintegrerad',
  'Half integrated with roofbed': 'Halvintegrerad m. takbädd', Integrated: 'Helintegrerad', Van: 'Van', Alcove: 'Alkov',
};
const LAYOUT: Record<string, string> = {
  Long_beds: 'Långbäddar', Double_bed: 'Dubbelsäng', Queenbed: 'Queensbed', Kids_room: 'Barnkammare', Corner_bed: 'Hörnsäng',
};

/** "CORAL SUPREME 670 DL *Kampanj*" -> "Coral Supreme 670 DL" */
export function cleanModel(model: string): string {
  let m = model.split('*')[0].split(/\s[-–]\s/)[0].replace(/[.!\s]+$/, '').replace(/\s+/g, ' ').trim();
  m = m.split(' ').map((w) => (/^[A-ZÅÄÖ]{5,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w)).join(' ');
  return m || model.trim();
}

/** Månadskostnad enligt sajtens kalkylator (kontantinsats, ränta, löptid). */
export function monthlyCost(o: DsoObject, price: number): number | null {
  if (o.pricePerMonth > 0) return Math.round(o.pricePerMonth);
  const c = o.costCalculationValues;
  if (!c || !c.loanInterest || !c.initialLoanPaymentYears || !price) return null;
  const loan = price * (1 - c.initialDownPayment / 100);
  const r = c.loanInterest / 100 / 12, n = c.initialLoanPaymentYears * 12;
  return Math.round((loan * r) / (1 - Math.pow(1 + r, -n)));
}

const spec = (o: DsoObject, title: string) => o.specifications.find((s) => s.title === title)?.value?.trim() || null;

export function normalize(o: DsoObject): Vehicle {
  const husbil = o.type === 2;
  const pris = o.salePrice && o.salePrice < o.price ? o.salePrice : o.price;
  const specs: Record<string, string> = {};
  const put = (k: string, v: string | null | undefined) => { if (v && !/^0\b/.test(v)) specs[k] = v; };
  put(husbil ? 'Fordonstyp' : 'Typ', CATEGORY[o.category] ?? o.category);
  put('Planlösning', o.layout ? LAYOUT[o.layout] ?? null : null);
  put('Sovplatser', o.beds ? String(o.beds) : null);
  if (husbil) put('Färdplatser', o.passengers ? String(o.passengers) : null);
  put('Längd', o.length ? `${o.length} cm` : spec(o, 'Längd'));
  put('Totalvikt', o.weight ? `${o.weight.toLocaleString('sv-SE').replace(/[ ,]/g, ' ')} kg` : null);
  if (husbil) {
    put('Växellåda', o.gearbox === 1 ? 'Automat' : o.gearbox === 2 ? 'Manuell' : null);
    put('Effekt', o.effect ? `${o.effect} hk` : null);
    if (o.condition !== 1 && o.milage) put('Miltal', `${o.milage.toLocaleString('sv-SE').replace(/[ ,]/g, ' ')} mil`);
  } else {
    put('Bredd', spec(o, 'Bredd'));
  }
  return {
    id: String(o.pageId),
    uniqueId: o.uniqueId,
    artikelnr: o.articleNr,
    url: cfg.siteBase + o.pageLink,
    typ: husbil ? 'Husbil' : 'Husvagn',
    marke: o.brand.trim(),
    modell: cleanModel(o.model),
    modellar: o.year,
    skick: o.condition === 1 ? 'Ny' : 'Begagnad',
    pris,
    ordPris: pris < o.price ? o.price : null,
    manad: monthlyCost(o, pris),
    anlaggning: o.filial.replace(/\s*OUTLET$/i, '').trim(),
    telefon: formatPhone(o.mainPhoneNumber),
    specs: Object.fromEntries(Object.entries(specs).slice(0, 8)),
    saljpunkter: [],
    bilder: imageIdsOf(o),
  };
}

/** Hash över det som syns/hörs i videon. Ändras den görs en ny video. */
export function videoHash(o: DsoObject): string {
  const v = normalize(o);
  const key = JSON.stringify([v.marke, v.modell, v.modellar, v.pris, v.ordPris, v.bilder.slice(0, 40), v.anlaggning]);
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}
