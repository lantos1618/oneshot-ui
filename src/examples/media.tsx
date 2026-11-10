import { mix } from '../lib/core'
import { seeded } from './random'

/* Sample media generated in the page, so the showcase works offline: canvas art, a synthesised track, a canvas recording. */

/* ── generated media ───────────────────────────────────────────────────────── */

export type MediaArtKind = 'mountains' | 'sea' | 'city' | 'dunes' | 'abstract'
const MEDIA_PALETTES = [['#0F172A', '#F97316', '#FDBA74', '#7C2D12', '#1E293B', '#FEF3C7'], ['#E0F2FE', '#BAE6FD', '#0EA5E9', '#075985', '#0C4A6E', '#FFFFFF'], ['#FDF2F8', '#FBCFE8', '#F472B6', '#9D174D', '#500724', '#FFF7ED'], ['#ECFDF5', '#A7F3D0', '#10B981', '#065F46', '#022C22', '#FEF9C3'], ['#1E1B4B', '#3B82F6', '#93C5FD', '#1E3A8A', '#0F172A', '#E0E7FF'], ['#FEF3C7', '#FCD34D', '#D97706', '#78350F', '#451A03', '#FFFBEB'], ['#111827', '#374151', '#9CA3AF', '#4B5563', '#030712', '#F3F4F6'], ['#FFF1F2', '#FECDD3', '#FB7185', '#9F1239', '#4C0519', '#FFE4E6']]

/** Paints a procedural landscape (or abstract blur) on a canvas. Same seed, same picture. */
export function mediaArt(kind: MediaArtKind, w: number, h: number, seed: number, pal: number): HTMLCanvasElement {
  const rnd = seeded(seed * 97 + 13)
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')!; const P = MEDIA_PALETTES[pal % MEDIA_PALETTES.length]
  const sky = x.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, P[0]); sky.addColorStop(1, P[1]); x.fillStyle = sky; x.fillRect(0, 0, w, h)
  if (kind === 'abstract') {
    for (let i = 0; i < 6; i++) { const cx = rnd() * w, cy = rnd() * h, r = (0.25 + rnd() * 0.45) * Math.max(w, h), g = x.createRadialGradient(cx, cy, 0, cx, cy, r), col = P[2 + (i % 4)]; g.addColorStop(0, col + 'DD'); g.addColorStop(1, col + '00'); x.fillStyle = g; x.fillRect(0, 0, w, h) }
    return c
  }
  const sunY = h * (0.25 + rnd() * 0.2), sunX = w * (0.2 + rnd() * 0.6)
  const sg = x.createRadialGradient(sunX, sunY, 0, sunX, sunY, w * 0.5); sg.addColorStop(0, P[5] + 'EE'); sg.addColorStop(0.12, P[5] + 'CC'); sg.addColorStop(0.13, P[5] + '55'); sg.addColorStop(1, P[5] + '00'); x.fillStyle = sg; x.fillRect(0, 0, w, h)
  if (kind === 'mountains') for (let l = 0; l < 5; l++) {
    const t = l / 4; x.fillStyle = mix(P[2], P[4], t); x.beginPath(); x.moveTo(0, h); let y = h * (0.5 + t * 0.28)
    for (let px = 0; px <= w; px += 6) { y += (rnd() - 0.5) * 22 * (1 - t * 0.5); y = Math.max(h * (0.34 + t * 0.25), Math.min(h * (0.66 + t * 0.25), y)); x.lineTo(px, y) }
    x.lineTo(w, h); x.fill()
  }
  if (kind === 'dunes') for (let l = 0; l < 5; l++) {
    const t = l / 4; x.fillStyle = mix(P[2], P[4], t); x.beginPath(); x.moveTo(0, h); const f = 0.004 + rnd() * 0.006, ph = rnd() * 6, b = h * (0.55 + t * 0.1)
    for (let px = 0; px <= w; px += 4) x.lineTo(px, b + Math.sin(px * f + ph) * h * 0.05 + l * h * 0.06)
    x.lineTo(w, h); x.fill()
  }
  if (kind === 'sea') {
    const hz = h * 0.6, wg = x.createLinearGradient(0, hz, 0, h); wg.addColorStop(0, P[3]); wg.addColorStop(1, P[4]); x.fillStyle = wg; x.fillRect(0, hz, w, h - hz); x.fillStyle = P[5] + '66'
    for (let i = 0; i < 26; i++) { const yy = hz + (i / 26) ** 1.5 * (h - hz), ww = (1 - i / 30) * w * 0.25 * (0.5 + rnd()); x.fillRect(sunX - ww / 2 + (rnd() - 0.5) * 20, yy, ww, 1.5 + i * 0.12) }
  }
  if (kind === 'city') {
    let px = 0
    while (px < w) {
      const bw = 14 + rnd() * 36, bh = h * (0.18 + rnd() * 0.45); x.fillStyle = mix(P[3], P[4], rnd() * 0.6); x.fillRect(px, h - bh, bw, bh); x.fillStyle = P[5] + 'AA'
      for (let wy = h - bh + 6; wy < h - 6; wy += 9) for (let wx = px + 4; wx < px + bw - 4; wx += 7) if (rnd() < 0.35) x.fillRect(wx, wy, 3, 4)
      px += bw + 2
    }
  }
  return c
}
const mediaImageCache = new Map<string, string>()
/** mediaArt as a JPEG data URL. Memoised: each picture is painted and encoded once per page. */
export function mediaImage(kind: MediaArtKind, w: number, h: number, seed: number, pal: number, quality = 0.82) {
  const key = `${kind}|${w}|${h}|${seed}|${pal}|${quality}`
  let url = mediaImageCache.get(key)
  if (!url) { url = mediaArt(kind, w, h, seed, pal).toDataURL('image/jpeg', quality); mediaImageCache.set(key, url) }
  return url
}
const mediaImageAsyncCache = new Map<string, Promise<string>>()
/** mediaArt as a JPEG blob URL, encoded with canvas.toBlob: the browser encodes off the main thread or in idle slices,
 * so a page of generated pictures doesn't add up to long tasks the way toDataURL (a synchronous encode) does. Memoised. */
export function mediaImageAsync(kind: MediaArtKind, w: number, h: number, seed: number, pal: number, quality = 0.82): Promise<string> {
  const key = `${kind}|${w}|${h}|${seed}|${pal}|${quality}`
  let url = mediaImageAsyncCache.get(key)
  if (!url) {
    const c = mediaArt(kind, w, h, seed, pal)
    url = new Promise<string>(done => c.toBlob(b => done(b ? URL.createObjectURL(b) : c.toDataURL('image/jpeg', quality)), 'image/jpeg', quality))
    mediaImageAsyncCache.set(key, url)
  }
  return url
}

/** The synthesis as steps of roughly 15 ms each (desktop), so it can be spread over tasks (`mediaSynthTrackAsync`). */
function* mediaSynthSteps(seconds: number, bpm: number, sr: number): Generator<void, { url: string; peaks: number[] }> {
  const N = Math.floor(sr * seconds), out = new Float32Array(N), beat = 60 / bpm / 2
  // Each note: env = min(1, t / 0.02) · e^(−2.2t) (· e^t for a swell) over three partials. ~4M samples, so no Math.exp or
  // Math.sin per sample: the decay is one multiply and each partial a phasor turned by a fixed angle (same samples to
  // ~1e-8, about 8× faster; it was a ~1 s main-thread task on a phone).
  const tone = (f: number, dur: number, amp: number, s0: number, swell?: boolean) => {
    const n = Math.min(Math.floor(sr * dur), N - s0), att = sr * 0.02, decay = Math.exp(-(swell ? 1.2 : 2.2) / sr)
    const w1 = 6.2832 * f / sr, w2 = 12.566 * f / sr, w3 = 18.85 * f / sr
    const c1 = Math.cos(w1), s1 = Math.sin(w1), c2 = Math.cos(w2), s2 = Math.sin(w2), c3 = Math.cos(w3), s3 = Math.sin(w3)
    let e = amp, x1 = 1, y1 = 0, x2 = 1, y2 = 0, x3 = 1, y3 = 0, r = 0
    for (let k = 0; k < n; k++) {
      out[s0 + k] += (k < att ? k / att : 1) * e * (y1 + 0.35 * y2 + 0.12 * y3)
      e *= decay
      r = x1 * c1 - y1 * s1; y1 = x1 * s1 + y1 * c1; x1 = r
      r = x2 * c2 - y2 * s2; y2 = x2 * s2 + y2 * c2; x2 = r
      r = x3 * c3 - y3 * s3; y3 = x3 * s3 + y3 * c3; x3 = r
    }
  }
  const CH = [[220, 277.18, 329.63, 440], [196, 246.94, 293.66, 392], [174.61, 220, 261.63, 349.23], [196, 246.94, 293.66, 392]], PAT = [0, 2, 1, 3, 2, 1, 3, 2]
  for (let i = 0; i < Math.floor(seconds / beat); i++) {
    const ch = CH[Math.floor(i / 8) % 4], f = ch[PAT[i % 8]] * (i % 16 > 11 ? 2 : 1), s0 = Math.floor(i * beat * sr); tone(f, 1.6, 0.16, s0)
    if (i % 8 === 0) ch.slice(0, 3).forEach(f2 => tone(f2 / 2, beat * 8, 0.07, s0, true))
    if (i % 8 === 7) yield
  }
  yield
  for (const [dly, g] of [[0.27, 0.35], [0.53, 0.2]]) { const d = Math.floor(sr * dly), copy = out.slice(0, N - d); for (let k = 0; k < copy.length; k++) out[k + d] += g * copy[k] }
  const fade = Math.floor(sr * 1.5); for (let k = 0; k < fade; k++) out[N - fade + k] *= 1 - k / fade
  let mx = 0; for (let k = 0; k < N; k++) { const a = out[k] < 0 ? -out[k] : out[k]; if (a > mx) mx = a } const norm = 1 / (mx * 1.15)
  const buf = new ArrayBuffer(44 + N * 2), v = new DataView(buf), w = (o: number, str: string) => [...str].forEach((c, k) => v.setUint8(o + k, c.charCodeAt(0)))
  w(0, 'RIFF'); v.setUint32(4, 36 + N * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, N * 2, true)
  // 16-bit little-endian samples: a typed-array view where the platform is little-endian (all current ones), else DataView
  const pcm = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? new Int16Array(buf, 44, N) : null
  yield
  for (let k = 0; k < N; k++) {
    const x = out[k] * norm, q = (x > 1 ? 1 : x < -1 ? -1 : x) * 32767
    if (pcm) pcm[k] = q; else v.setInt16(44 + k * 2, q, true)
  }
  yield
  const bars = 96, seg = Math.floor(N / bars), peaks: number[] = []
  for (let b = 0; b < bars; b++) { let sum = 0; for (let k = b * seg; k < (b + 1) * seg; k++) { const x = out[k] * norm; sum += x * x } peaks.push(Math.sqrt(sum / seg)) }
  let pm = 0; for (const p of peaks) if (p > pm) pm = p
  return { url: URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })), peaks: peaks.map(p => Math.round(p / pm * 100) / 100) }
}

/** Synthesises a short arpeggio track as a WAV blob URL, plus normalised waveform peaks. */
export function mediaSynthTrack(seconds = 24, bpm = 92, sr = 22050): { url: string; peaks: number[] } {
  const steps = mediaSynthSteps(seconds, bpm, sr)
  for (;;) { const r = steps.next(); if (r.done) return r.value }
}

/** mediaSynthTrack spread over many short tasks (a macrotask between steps), so making the track never blocks input or
 * frames for long; resolves with the same track. */
export function mediaSynthTrackAsync(seconds = 24, bpm = 92, sr = 22050): Promise<{ url: string; peaks: number[] }> {
  const steps = mediaSynthSteps(seconds, bpm, sr)
  return new Promise((resolve, reject) => {
    const step = () => {
      try { const r = steps.next(); if (r.done) resolve(r.value); else setTimeout(step, 0) } catch (e) { reject(e) }
    }
    setTimeout(step, 0)
  })
}

let mediaVideoCache: { poster: string; ready: Promise<string | null>; setActive: (on: boolean) => void } | null = null
/**
 * Records an animated canvas (with the synthesised soundtrack) into a WebM via captureStream + MediaRecorder.
 * Returns a poster right away and a promise of the blob URL (null where recording isn't supported). Cached.
 * Nothing runs until `setActive(true)`; while inactive (e.g. the player is off screen) the frame loop,
 * the recorder and the audio are paused.
 */
export function mediaRecordVideo(seconds = 8, w = 640, h = 360) {
  if (mediaVideoCache) return mediaVideoCache
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d')!
  const BANDS = ['#0B1120', '#1D4ED8', '#0E7490', '#F59E0B', '#7C2D12']
  const draw = (t: number) => {
    const u = t / seconds, grd = g.createLinearGradient(0, 0, w, 0)
    BANDS.forEach((c, i) => grd.addColorStop(Math.min(1, Math.max(0, i / (BANDS.length - 1) + Math.sin(u * 6.28 + i) * 0.08)), c)); g.fillStyle = grd; g.fillRect(0, 0, w, h)
    for (let k = 0; k < 3; k++) { g.globalAlpha = 0.18; g.fillStyle = '#fff'; g.beginPath(); g.arc(w * ((u * (k + 1) * 0.6 + k * 0.3) % 1), h * (0.3 + k * 0.2), 60 + k * 30, 0, 6.283); g.fill() }
    g.globalAlpha = 1
  }
  draw(0); const poster = cv.toDataURL('image/jpeg', 0.8)
  let active = false, kick: (() => void) | null = null
  let control: { run: () => void; pause: () => void } | null = null
  const ready = new Promise<string | null>(res => {
    kick = () => {
      if (typeof MediaRecorder === 'undefined' || !cv.captureStream) return res(null)
      const stream = cv.captureStream(25), chunks: Blob[] = []
      let ctx: AudioContext | null = null; try { ctx = new AudioContext() } catch { /* no audio */ }
      const begin = (audio: AudioBuffer | null) => {
        let src: AudioBufferSourceNode | null = null
        if (ctx && audio) { src = ctx.createBufferSource(); const dst = ctx.createMediaStreamDestination(); src.buffer = audio; src.connect(dst); dst.stream.getAudioTracks().forEach(t => stream.addTrack(t)) }
        const type = ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || ''
        let rec: MediaRecorder
        try { rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 600000 } : undefined) } catch { return res(null) }
        rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
        rec.onstop = () => { ctx?.close(); res(URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || 'video/webm' }))) }
        let elapsed = 0, last = 0, raf = 0, running = false, done = false
        const step = () => {
          const now = performance.now(); elapsed += (now - last) / 1000; last = now; draw(Math.min(seconds, elapsed))
          if (elapsed < seconds) raf = requestAnimationFrame(step); else { running = false; done = true; rec.stop() }
        }
        control = {
          run: () => {
            if (running || done) return
            running = true; last = performance.now()
            if (rec.state === 'inactive') { rec.start(); src?.start() } else { rec.resume(); ctx?.resume().catch(() => {}) }
            raf = requestAnimationFrame(step)
          },
          pause: () => { if (!running) return; running = false; cancelAnimationFrame(raf); rec.pause(); ctx?.suspend().catch(() => {}) },
        }
        if (active) control.run()
      }
      if (!ctx) return begin(null)
      mediaSynthTrackAsync(seconds, 100).then(t => fetch(t.url)).then(r => r.arrayBuffer()).then(b => ctx!.decodeAudioData(b)).then(begin, () => begin(null))
    }
  })
  const setActive = (on: boolean) => {
    active = on
    if (on && kick) { const k = kick; kick = null; k() }
    if (on) control?.run(); else control?.pause()
  }
  return (mediaVideoCache = { poster, ready, setActive })
}
