import {serve} from '@hono/node-server';
import {cfg} from '../lib/config';
import {createApp} from './app';

export function startServer() {
  serve({fetch: createApp().fetch, port: cfg.port}, (i) => console.log(`[server] Granskningsvy på http://localhost:${i.port}`));
}

if (import.meta.url === `file://${process.argv[1]}`) startServer();
