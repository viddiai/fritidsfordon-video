import fs from 'node:fs';
import path from 'node:path';
import {cfg} from './config';

/** Minimal gemensam yta för Supabase/Postgres (postgres.js) och lokal PGlite. */
export interface Db {
  query<T = any>(text: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

let instance: Promise<Db> | null = null;

export function db(): Promise<Db> {
  if (!instance) instance = connect();
  return instance;
}

async function connect(): Promise<Db> {
  let d: Db;
  if (cfg.databaseUrl) {
    const {default: postgres} = await import('postgres');
    // prepare:false krävs för Supabase transaction pooler (port 6543), skadar inte annars
    const sql = postgres(cfg.databaseUrl, {prepare: false, max: 5, onnotice: () => {}});
    d = {
      query: async (text, params = []) => (await sql.unsafe(text, params as any[])) as any,
      close: () => sql.end(),
    };
  } else {
    const {PGlite} = await import('@electric-sql/pglite');
    fs.mkdirSync(cfg.pgliteDir, {recursive: true});
    const pg = new PGlite(cfg.pgliteDir);
    d = {
      query: async (text, params = []) => (await pg.query(text, params as any[])).rows as any,
      close: () => pg.close(),
    };
    console.log(`[db] Ingen DATABASE_URL – använder lokal PGlite i ${cfg.pgliteDir}`);
  }
  const schema = fs.readFileSync(path.resolve('supabase/schema.sql'), 'utf8');
  for (const stmt of schema.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s && !/^(--.*\n?)*$/.test(s))) {
    await d.query(stmt);
  }
  return d;
}

export const json = (v: unknown) => JSON.stringify(v ?? null);
