// Svenska hjälpfunktioner: tal till ord (för speakerröst), formatering.

const ONES = ['noll', 'ett', 'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio', 'elva', 'tolv',
  'tretton', 'fjorton', 'femton', 'sexton', 'sjutton', 'arton', 'nitton'];
const TENS = ['', '', 'tjugo', 'trettio', 'fyrtio', 'femtio', 'sextio', 'sjuttio', 'åttio', 'nittio'];

function below1000(n: number): string {
  let s = '';
  const h = Math.floor(n / 100), r = n % 100;
  if (h) s += (h === 1 ? 'ett' : ONES[h]) + 'hundra';
  if (r) s += r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? ONES[r % 10] : '');
  return s;
}

/** 1502900 -> "en miljon femhundratvåtusen niohundra" */
export function numberToSwedish(n: number): string {
  n = Math.round(n);
  if (n === 0) return 'noll';
  if (n < 0) return 'minus ' + numberToSwedish(-n);
  const parts: string[] = [];
  const mil = Math.floor(n / 1_000_000), tus = Math.floor((n % 1_000_000) / 1000), rest = n % 1000;
  if (mil) parts.push(mil === 1 ? 'en miljon' : `${below1000(mil)} miljoner`);
  if (tus) parts.push((tus === 1 ? 'et' : below1000(tus)) + 'tusen');
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

/** Årtal läses som "tjugohundratjugosju" av TTS ibland – vi skriver "tjugotjugosju". */
export function yearToSwedish(y: number): string {
  if (y >= 2010 && y < 2100) return 'tjugo' + (y % 100 ? (y % 100 < 10 ? 'noll' : '') + below1000(y % 100) : 'hundra');
  return numberToSwedish(y);
}

const UNITS: [RegExp, string][] = [
  [/\s?kr\b/gi, ' kronor'],
  [/\s?cm\b/gi, ' centimeter'],
  [/\s?kg\b/gi, ' kilo'],
  [/\s?hk\b/gi, ' hästkrafter'],
  [/\s?L\b/g, ' liter'],
  [/\s?mil\b/g, ' mil'],
  [/\s?st\b/g, ''],
  [/\s?%/g, ' procent'],
];

/** Gör text TTS-vänlig: tal och enheter skrivs ut i ord. */
export function speakable(text: string): string {
  let t = text.replace(/(\d)[\s ](?=\d{3}\b)/g, '$1'); // "1 502 900" -> "1502900"
  t = t.replace(/\b(\d+)[,.](\d+)\b/g, (_, a, b) => `${numberToSwedish(+a)} komma ${b.split('').map((d: string) => ONES[+d]).join(' ')}`);
  t = t.replace(/(\d+)(\s?(?:kr|cm|kg|hk|L|mil|st|%))/g, (_, n, u) => numberToSwedish(+n) + u);
  for (const [re, rep] of UNITS) t = t.replace(re, rep);
  t = t.replace(/\b(20\d\d)\b/g, (_, y) => yearToSwedish(+y));
  t = t.replace(/\d+/g, (n) => numberToSwedish(+n));
  return t.replace(/\s{2,}/g, ' ').trim();
}

export const kr = (n: number) => Math.round(n).toLocaleString('sv-SE').replace(/[ ,]/g, ' ') + ' kr';

const AREA3 = ['031', '033', '035', '036', '040', '042', '044', '046', '054', '060', '063', '090', '011', '013', '016', '018', '019', '021', '023', '026'];
/** "0520211900" -> "0520-21 19 00" */
export function formatPhone(raw: string | null | undefined): string {
  const d = (raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  const a = d.startsWith('08') ? 2 : AREA3.includes(d.slice(0, 3)) ? 3 : 4;
  const area = d.slice(0, a), rest = d.slice(a);
  const groups = rest.length === 7 ? [3, 2, 2] : rest.length === 6 ? [2, 2, 2] : rest.length === 5 ? [3, 2] : rest.length === 8 ? [3, 3, 2] : [rest.length];
  let i = 0;
  return area + '-' + groups.map((g) => rest.slice(i, (i += g))).join(' ');
}
