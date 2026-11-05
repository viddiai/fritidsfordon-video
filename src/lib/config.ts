import 'dotenv/config';
import path from 'node:path';

const env = (k: string) => (process.env[k] ?? '').trim() || undefined;

export const cfg = {
  siteBase: 'https://fritidscenter.se',
  /** Empori-typer: 1 = husvagn, 2 = husbil (3 = bilar, ignoreras) */
  vehicleTypes: [1, 2],
  databaseUrl: env('DATABASE_URL'),
  pgliteDir: env('PGLITE_DIR') ?? '.data/pglite',
  storageDir: path.resolve(env('STORAGE_DIR') ?? 'storage'),

  anthropicKey: env('ANTHROPIC_API_KEY'),
  claudeModel: env('CLAUDE_MODEL') ?? 'claude-opus-5-5',

  elevenKey: env('ELEVENLABS_API_KEY'),
  voiceId: env('ELEVENLABS_VOICE_ID') ?? '4xkUqaR9MYOJHoaC1Nak',
  elevenModel: env('ELEVENLABS_MODEL') ?? 'eleven_multilingual_v2',

  port: Number(env('PORT') ?? 3000),
  adminUser: env('ADMIN_USER') ?? 'admin',
  adminPassword: env('ADMIN_PASSWORD'),
  publicBaseUrl: env('PUBLIC_BASE_URL') ?? `http://localhost:${env('PORT') ?? 3000}`,

  syncCron: env('SYNC_CRON') ?? '*/30 * * * *',
  autoApprove: env('AUTO_APPROVE') === 'true',
  backfillLimit: Number(env('BACKFILL_LIMIT') ?? 10),
  soldOnDisappear: (env('SOLD_ON_DISAPPEAR') ?? 'true') === 'true',

  renderConcurrency: env('RENDER_CONCURRENCY') ? Number(env('RENDER_CONCURRENCY')) : null,
  browserExecutable: env('REMOTION_BROWSER_EXECUTABLE') ?? null,
};
