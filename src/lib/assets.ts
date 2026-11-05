// Lokal fillagring: bilder, ljud och färdiga videor under STORAGE_DIR.
import fs from 'node:fs';
import path from 'node:path';
import {cfg} from './config';
import {imageUrl} from './scrape';

export const storagePath = (...p: string[]) => path.join(cfg.storageDir, ...p);

export function ensureDir(p: string) {
  fs.mkdirSync(p, {recursive: true});
  return p;
}

async function download(url: string, dest: string) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  ensureDir(path.dirname(dest));
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(dest + '.tmp', buf);
      fs.renameSync(dest + '.tmp', dest);
      return;
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise((res) => setTimeout(res, 1000 * i));
    }
  }
}

/** Laddar ner bilder i videokvalitet (1920 px) till storage/img/{id}/{bild}.jpg */
export async function downloadImages(productId: string, imageIds: string[]) {
  const queue = [...imageIds];
  const worker = async () => {
    for (let id; (id = queue.shift()); ) await download(imageUrl(productId, id, 1920), storagePath('img', productId, `${id}.jpg`));
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

/** Små bilder (400 px) som Claude tittar på för att välja bilder. Returnerar base64. */
export async function thumbnailsBase64(productId: string, imageIds: string[]): Promise<{id: string; b64: string}[]> {
  const out: {id: string; b64: string}[] = [];
  for (const id of imageIds) {
    const dest = storagePath('thumb', productId, `${id}.jpg`);
    await download(imageUrl(productId, id, 400), dest);
    out.push({id, b64: fs.readFileSync(dest).toString('base64')});
  }
  return out;
}
