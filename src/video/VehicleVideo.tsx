import React from 'react';
import {AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Scene, Vehicle, VideoProps} from './types';

export const FPS = 30;
export const XF = 12; // överlappning/övertoning mellan scener (frames)
export const AUDIO_DELAY = 8; // repliken startar strax efter att scenen börjat
export const MIN_FRAMES = {intro: 105, point: 75, specs: 120, outro: 135} as const;

const BRAND = {red: '#C6390C', dark: '#111418', light: '#F6F6F6'};
const font = 'Inter, "Inter Display", "Helvetica Neue", Arial, sans-serif';

const kr = (n: number) => Math.round(n).toLocaleString('sv-SE').replace(/[ ,]/g, ' ') + ' kr';
const asset = (base: string, rel: string) => (base ? `${base}/${rel}` : staticFile(rel));
const img = (p: VideoProps, b: string) => asset(p.assetBase, `img/${p.vehicle.id}/${b}.jpg`);

export const totalFrames = (scenes: Scene[]) => scenes.reduce((s, x) => s + x.frames, 0);

/** Scener utan manus (studio/förhandsvisning): samma upplägg som första PoC:n. */
export function defaultScenes(v: Vehicle): Scene[] {
  const imgs = v.punktBilder ?? v.bilder.slice(1);
  return [
    {kind: 'intro', frames: MIN_FRAMES.intro, image: v.bilder[0]},
    ...v.saljpunkter.slice(0, 6).map((t, i) => ({kind: 'point' as const, frames: MIN_FRAMES.point, text: t, image: imgs[i] ?? v.bilder[0]})),
    {kind: 'specs', frames: MIN_FRAMES.specs},
    {kind: 'outro', frames: MIN_FRAMES.outro, image: v.bilder[0]},
  ];
}

// Bild med Ken Burns. I stående format: oskarp bakgrund + bild i full bredd.
const Photo: React.FC<{src: string; dur: number; dir?: number; vertical: boolean}> = ({src, dur, dir = 1, vertical}) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [0, dur], [0, 1], {extrapolateRight: 'clamp'});
  const scale = 1.05 + 0.1 * p;
  const tx = dir * interpolate(p, [0, 1], [-2, 2]);
  const fade = interpolate(f, [0, XF], [0, 1], {extrapolateRight: 'clamp'});
  if (!vertical) {
    return <AbsoluteFill style={{opacity: fade, overflow: 'hidden'}}>
      <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale}) translateX(${tx}%)`}} />
    </AbsoluteFill>;
  }
  return <AbsoluteFill style={{opacity: fade, overflow: 'hidden', background: BRAND.dark}}>
    <Img src={src} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(40px) brightness(0.55)', transform: 'scale(1.2)'}} />
    <div style={{position: 'absolute', left: 0, right: 0, top: 220, height: 1240, overflow: 'hidden'}}>
      <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale}) translateX(${tx * 3}%)`}} />
    </div>
  </AbsoluteFill>;
};

const Logo: React.FC<{size: number}> = ({size}) => (
  <Img src={staticFile('logo-t.png')} style={{height: size, width: 'auto', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,.45))'}} />
);

const Rise: React.FC<{delay?: number; children: React.ReactNode; style?: React.CSSProperties}> = ({delay = 0, children, style}) => {
  const f = useCurrentFrame(); const {fps} = useVideoConfig();
  const s = spring({frame: f - delay, fps, config: {damping: 200}});
  return <div style={{opacity: s, transform: `translateY(${(1 - s) * 40}px)`, ...style}}>{children}</div>;
};

type SceneProps = {p: VideoProps; s: Scene; i: number};

const Intro: React.FC<SceneProps> = ({p, s}) => {
  const v = p.vehicle, vert = p.format === 'vertical';
  return <AbsoluteFill>
    <Photo src={img(p, s.image ?? v.bilder[0])} dur={s.frames} vertical={vert} />
    <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(0,0,0,.6) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 50%, rgba(0,0,0,.85) 100%)'}} />
    <div style={{position: 'absolute', top: vert ? 80 : 50, left: 70}}><Logo size={vert ? 80 : 64} /></div>
    <div style={{position: 'absolute', left: vert ? 70 : 90, right: 70, bottom: vert ? 170 : 90, fontFamily: font, color: 'white'}}>
      <Rise delay={8}><span style={{background: BRAND.red, padding: '8px 18px', fontWeight: 700, fontSize: vert ? 38 : 30, borderRadius: 6}}>
        {v.skick === 'Ny' ? 'NYHET' : 'BEGAGNAD'} · {v.modellar}</span></Rise>
      <Rise delay={14}><div style={{fontSize: vert ? 64 : 56, fontWeight: 600, marginTop: 26, opacity: .9}}>{v.marke}</div></Rise>
      <Rise delay={20}><div style={{fontSize: vert ? (v.modell.length > 18 ? 84 : 104) : 96, fontWeight: 800, lineHeight: 1.0, letterSpacing: -2}}>{v.modell}</div></Rise>
    </div>
  </AbsoluteFill>;
};

const Point: React.FC<SceneProps> = ({p, s, i}) => {
  const v = p.vehicle, vert = p.format === 'vertical';
  return <AbsoluteFill>
    <Photo src={img(p, s.image ?? v.bilder[0])} dur={s.frames} dir={i % 2 ? -1 : 1} vertical={vert} />
    {!vert && <AbsoluteFill style={{background: 'linear-gradient(0deg, rgba(0,0,0,.7) 0%, rgba(0,0,0,0) 40%)'}} />}
    <div style={{position: 'absolute', left: vert ? 70 : 90, right: vert ? 70 : 600, bottom: vert ? 210 : 90, fontFamily: font}}>
      <Rise delay={6}><div style={{display: 'inline-block', background: 'white', color: BRAND.dark, padding: vert ? '26px 34px' : '20px 30px',
        fontSize: vert ? 58 : 50, fontWeight: 700, lineHeight: 1.15, borderLeft: `12px solid ${BRAND.red}`, borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,.35)'}}>{s.text}</div></Rise>
    </div>
  </AbsoluteFill>;
};

const Specs: React.FC<SceneProps> = ({p}) => {
  const v = p.vehicle, vert = p.format === 'vertical';
  const entries = Object.entries(v.specs).slice(0, 8);
  return <AbsoluteFill style={{background: BRAND.dark, fontFamily: font, color: 'white', justifyContent: 'center', padding: vert ? '200px 70px' : '90px 110px'}}>
    <Rise><div style={{fontSize: vert ? 46 : 40, color: BRAND.red, fontWeight: 700, letterSpacing: 2}}>FAKTA</div></Rise>
    <Rise delay={4}><div style={{fontSize: vert ? 76 : 68, fontWeight: 800, marginBottom: vert ? 60 : 50}}>{v.marke} {v.modell}</div></Rise>
    <div style={{display: 'grid', gridTemplateColumns: vert ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: vert ? 34 : 30}}>
      {entries.map(([k, val], i) => <Rise key={k} delay={10 + i * 4}>
        <div style={{background: 'rgba(255,255,255,.07)', borderRadius: 14, padding: vert ? '34px 30px' : '28px 28px'}}>
          <div style={{fontSize: vert ? 34 : 28, opacity: .65}}>{k}</div>
          <div style={{fontSize: vert ? (val.length > 14 ? 42 : 56) : (val.length > 14 ? 36 : 48), fontWeight: 700, marginTop: 6}}>{val}</div>
        </div></Rise>)}
    </div>
  </AbsoluteFill>;
};

const Outro: React.FC<SceneProps> = ({p, s}) => {
  const v = p.vehicle, vert = p.format === 'vertical';
  return <AbsoluteFill>
    <Photo src={img(p, s.image ?? v.bilder[0])} dur={s.frames} vertical={false} />
    <AbsoluteFill style={{background: 'rgba(10,12,15,.78)'}} />
    <AbsoluteFill style={{fontFamily: font, color: 'white', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 70}}>
      <Rise><Logo size={vert ? 120 : 100} /></Rise>
      {p.sold ? <>
        <Rise delay={8}><div style={{fontSize: vert ? 150 : 130, fontWeight: 800, letterSpacing: -3, marginTop: 40, color: BRAND.red}}>SÅLD</div></Rise>
        <Rise delay={14}><div style={{fontSize: vert ? 50 : 44, opacity: .85}}>Tack till nya ägaren!</div></Rise>
        <Rise delay={24}><div style={{marginTop: vert ? 90 : 60, background: BRAND.red, padding: '26px 50px', borderRadius: 999, fontSize: vert ? 52 : 44, fontWeight: 700}}>
          Se fler fordon på fritidscenter.se</div></Rise>
      </> : <>
        <Rise delay={8}><div style={{fontSize: vert ? 150 : 130, fontWeight: 800, letterSpacing: -3, marginTop: 40}}>{kr(v.pris)}</div></Rise>
        {v.ordPris && <Rise delay={10}><div style={{fontSize: 48, opacity: .6, textDecoration: 'line-through'}}>{kr(v.ordPris)}</div></Rise>}
        {v.manad && <Rise delay={14}><div style={{fontSize: vert ? 50 : 44, opacity: .85}}>Delbetala från {kr(v.manad)}/mån</div></Rise>}
        <Rise delay={24}><div style={{marginTop: vert ? 90 : 60, background: BRAND.red, padding: '26px 50px', borderRadius: 999, fontSize: vert ? 52 : 44, fontWeight: 700}}>
          Boka visning i {v.anlaggning}</div></Rise>
        <Rise delay={30}><div style={{marginTop: 30, fontSize: vert ? 44 : 38, opacity: .8}}>{v.telefon} · fritidscenter.se</div></Rise>
      </>}
    </AbsoluteFill>
  </AbsoluteFill>;
};

/** Diagonalt "SÅLD"-band i hörnet, syns genom hela videon. */
const SoldBadge: React.FC<{vertical: boolean}> = ({vertical}) => {
  const f = useCurrentFrame(); const {fps} = useVideoConfig();
  const s = spring({frame: f - 4, fps, config: {damping: 14}});
  const w = vertical ? 760 : 640;
  return <div style={{position: 'absolute', top: 0, right: 0, width: w, height: w, overflow: 'hidden', pointerEvents: 'none'}}>
    <div style={{position: 'absolute', top: w * 0.2, right: -w * 0.28, width: w * 1.1, transform: `rotate(45deg) scale(${s})`,
      background: BRAND.red, color: 'white', textAlign: 'center', fontFamily: font, fontWeight: 900,
      fontSize: vertical ? 96 : 80, letterSpacing: 10, padding: '18px 0', boxShadow: '0 10px 40px rgba(0,0,0,.45)',
      borderTop: '4px solid rgba(255,255,255,.85)', borderBottom: '4px solid rgba(255,255,255,.85)'}}>SÅLD</div>
  </div>;
};

const SCENES = {intro: Intro, point: Point, specs: Specs, outro: Outro};

export const VehicleVideo: React.FC<VideoProps> = (props) => {
  const scenes = props.scenes?.length ? props.scenes : defaultScenes(props.vehicle);
  let at = 0, pointIdx = 0;
  return <AbsoluteFill style={{background: BRAND.dark}}>
    {scenes.map((s, k) => {
      const C = SCENES[s.kind];
      const last = k === scenes.length - 1;
      const el = <Sequence key={k} from={at} durationInFrames={s.frames + (last ? 0 : XF)}>
        <C p={props} s={s} i={s.kind === 'point' ? pointIdx++ : 0} />
        {s.audio && <Sequence from={AUDIO_DELAY}><Audio src={asset(props.assetBase, s.audio)} /></Sequence>}
      </Sequence>;
      at += s.frames;
      return el;
    })}
    {props.sold && <SoldBadge vertical={props.format === 'vertical'} />}
  </AbsoluteFill>;
};
