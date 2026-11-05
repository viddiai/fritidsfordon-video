// Rendering med Remotion. Bundlar mallen en gång per process och serverar bilder/ljud
// från STORAGE_DIR via en lokal filserver så att nya fordon inte kräver ny bundle.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {cfg} from './config';
import {ensureDir, storagePath} from './assets';
import type {Format, VideoProps} from '../video/types';

let bundlePromise: Promise<string> | null = null;
let assetServer: Promise<string> | null = null;

function getBundle() {
  bundlePromise ??= bundle({entryPoint: path.resolve('src/video/index.ts'), publicDir: path.resolve('public')});
  return bundlePromise;
}

const MIME: Record<string, string> = {'.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4'};

/** Enkel statisk filserver på 127.0.0.1 för STORAGE_DIR (bara för renderingen). */
function getAssetBase() {
  assetServer ??= new Promise((resolve) => {
    const root = cfg.storageDir;
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
      const file = path.join(root, rel);
      if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'access-control-allow-origin': '*'});
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as {port: number};
      resolve(`http://127.0.0.1:${addr.port}`);
    });
    srv.unref();
  });
  return assetServer;
}

const COMP: Record<Format, string> = {vertical: 'Vertical', landscape: 'Landscape'};

/** Renderar ett format till storage/videos/... och returnerar relativ sökväg. */
export async function renderFormat(props: Omit<VideoProps, 'format' | 'assetBase'>, format: Format, relOut: string, onProgress?: (p: number) => void) {
  const serveUrl = await getBundle();
  const inputProps: VideoProps = {...props, format, assetBase: await getAssetBase()};
  const common = {serveUrl, inputProps, browserExecutable: cfg.browserExecutable, chromiumOptions: {gl: 'swangle' as const}};
  const composition = await selectComposition({...common, id: COMP[format]});
  const out = storagePath(relOut);
  ensureDir(path.dirname(out));
  await renderMedia({
    ...common,
    composition,
    codec: 'h264',
    crf: 20,
    outputLocation: out + '.part.mp4',
    concurrency: cfg.renderConcurrency ?? Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2))),
    onProgress: ({progress}) => onProgress?.(progress),
  });
  fs.renameSync(out + '.part.mp4', out);
  return {file: relOut, seconds: composition.durationInFrames / composition.fps};
}
