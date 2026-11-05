// Speakerröst via ElevenLabs. Ett ljudsegment per scen, så att scenlängden kan följa repliken.
import fs from 'node:fs';
import {cfg} from './config';
import {ensureDir, storagePath} from './assets';
import {speakable} from './text';

export type VoiceSegment = {key: string; text: string; file?: string; seconds?: number};

type TtsResponse = {
  audio_base64: string;
  alignment?: {character_end_times_seconds: number[]} | null;
};

export const voiceEnabled = () => !!cfg.elevenKey;

/**
 * Genererar mp3 per segment till storage/audio/{videoId}/{key}.mp3.
 * previous_text/next_text gör att intonationen hänger ihop mellan segmenten.
 */
export async function synthesize(videoId: number, segments: VoiceSegment[]): Promise<VoiceSegment[]> {
  if (!cfg.elevenKey) return segments;
  const dir = ensureDir(storagePath('audio', String(videoId)));
  const out: VoiceSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const text = speakable(s.text);
    const body = {
      text,
      model_id: cfg.elevenModel,
      previous_text: i > 0 ? speakable(segments[i - 1].text) : undefined,
      next_text: i < segments.length - 1 ? speakable(segments[i + 1].text) : undefined,
      voice_settings: {stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true},
    };
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${cfg.voiceId}/with-timestamps?output_format=mp3_44100_128`;
    let data: TtsResponse | null = null;
    for (let attempt = 1; !data; attempt++) {
      const r = await fetch(url, {
        method: 'POST',
        headers: {'xi-api-key': cfg.elevenKey, 'content-type': 'application/json'},
        body: JSON.stringify(body),
      });
      if (r.ok) data = (await r.json()) as TtsResponse;
      else if ((r.status === 429 || r.status >= 500) && attempt < 4) await new Promise((res) => setTimeout(res, 2000 * attempt));
      else throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 300)}`);
    }
    const file = `audio/${videoId}/${s.key}.mp3`;
    fs.writeFileSync(storagePath(file), Buffer.from(data.audio_base64, 'base64'));
    const ends = data.alignment?.character_end_times_seconds ?? [];
    const seconds = ends.length ? ends[ends.length - 1] : estimateSeconds(text);
    out.push({...s, file, seconds});
    void dir;
  }
  return out;
}

/** Grov uppskattning (~2,6 ord/s) när vi saknar exakt längd. */
export const estimateSeconds = (text: string) => text.split(/\s+/).filter(Boolean).length / 2.6;
