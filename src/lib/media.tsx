import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, animate, motion, useInView, useMotionValue, useReducedMotion } from 'motion/react'
import { Avatar, Button, Chip, Icon, IconButton, TOUCH, clamp, cn, fmt, mix, seeded, spring, surface, useFocusTrap, useWidth } from './core'
import { Slider } from './forms'
import { useToast } from './feedback'
import { OverlayPortal, useScrollLock } from './overlay'
import { useFrameLoop, useViewport } from './motion'

/* ════════════════════════════════════════════════════════════════════════════
 * Media: players, gallery, lightbox, cards, image states, avatar crop, carousel, compare.
 * The demo media is generated in the page (canvas art, a synthesised WAV, a canvas recording),
 * so every demo works offline. The components themselves take any src.
 * ══════════════════════════════════════════════════════════════════════════ */

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

/** Synthesises a short arpeggio track as a WAV blob URL, plus normalised waveform peaks. */
export function mediaSynthTrack(seconds = 24, bpm = 92, sr = 22050): { url: string; peaks: number[] } {
  const N = Math.floor(sr * seconds), out = new Float32Array(N), beat = 60 / bpm / 2
  const tone = (f: number, dur: number, amp: number, s0: number, swell?: boolean) => {
    const n = Math.floor(sr * dur)
    for (let k = 0; k < n && s0 + k < N; k++) { const t = k / sr; let env = Math.min(1, t / 0.02) * Math.exp(-t * 2.2); if (swell) env *= Math.exp(t); out[s0 + k] += amp * env * (Math.sin(6.2832 * f * t) + 0.35 * Math.sin(12.566 * f * t) + 0.12 * Math.sin(18.85 * f * t)) }
  }
  const CH = [[220, 277.18, 329.63, 440], [196, 246.94, 293.66, 392], [174.61, 220, 261.63, 349.23], [196, 246.94, 293.66, 392]], PAT = [0, 2, 1, 3, 2, 1, 3, 2]
  for (let i = 0; i < Math.floor(seconds / beat); i++) {
    const ch = CH[Math.floor(i / 8) % 4], f = ch[PAT[i % 8]] * (i % 16 > 11 ? 2 : 1), s0 = Math.floor(i * beat * sr); tone(f, 1.6, 0.16, s0)
    if (i % 8 === 0) ch.slice(0, 3).forEach(f2 => tone(f2 / 2, beat * 8, 0.07, s0, true))
  }
  for (const [dly, g] of [[0.27, 0.35], [0.53, 0.2]]) { const d = Math.floor(sr * dly), copy = out.slice(0, N - d); for (let k = 0; k < copy.length; k++) out[k + d] += g * copy[k] }
  const fade = Math.floor(sr * 1.5); for (let k = 0; k < fade; k++) out[N - fade + k] *= 1 - k / fade
  let mx = 0; for (let k = 0; k < N; k++) mx = Math.max(mx, Math.abs(out[k])); const norm = 1 / (mx * 1.15)
  const buf = new ArrayBuffer(44 + N * 2), v = new DataView(buf), w = (o: number, str: string) => [...str].forEach((c, k) => v.setUint8(o + k, c.charCodeAt(0)))
  w(0, 'RIFF'); v.setUint32(4, 36 + N * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, N * 2, true)
  for (let k = 0; k < N; k++) v.setInt16(44 + k * 2, Math.max(-1, Math.min(1, out[k] * norm)) * 32767, true)
  const bars = 96, seg = Math.floor(N / bars), peaks: number[] = []
  for (let b = 0; b < bars; b++) { let sum = 0; for (let k = b * seg; k < (b + 1) * seg; k++) sum += (out[k] * norm) ** 2; peaks.push(Math.sqrt(sum / seg)) }
  const pm = Math.max(...peaks)
  return { url: URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })), peaks: peaks.map(p => Math.round(p / pm * 100) / 100) }
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
      fetch(mediaSynthTrack(seconds, 100).url).then(r => r.arrayBuffer()).then(b => ctx!.decodeAudioData(b)).then(begin, () => begin(null))
    }
  })
  const setActive = (on: boolean) => {
    active = on
    if (on && kick) { const k = kick; kick = null; k() }
    if (on) control?.run(); else control?.pause()
  }
  return (mediaVideoCache = { poster, ready, setActive })
}

/* ── shared audio tracks ───────────────────────────────────────────────────── */

export type AudioTrackState = { playing: boolean; time: number; duration: number; rate: number }
export type AudioTrackHandle = {
  /** The audio element, created on first use (null on the server, where there is no Audio) */ readonly el: HTMLAudioElement | null
  subscribe: (f: () => void) => () => void; get: () => AudioTrackState
  /** A player showing this track came on (+1) or went off (−1) screen; the frame loop only runs while one is visible. */
  view: (delta: 1 | -1) => void
  play: () => Promise<boolean>; pause: () => void; toggle: () => Promise<boolean>; seek: (t: number) => void; skip: (d: number) => void; setRate: (r: number) => void
}
const mediaLive = new Set<HTMLAudioElement>()
/**
 * A shared audio source that several players can render (e.g. the full player and the slim one stay in sync).
 * Only one track plays at a time: starting one pauses the others. Safe to call during render and on the server: the
 * audio element is only created when a player comes on screen or something is played (an inert handle where `Audio` doesn't exist).
 */
export function createAudioTrack(src: string, fallbackDuration = 0): AudioTrackHandle {
  let state: AudioTrackState = { playing: false, time: 0, duration: fallbackDuration, rate: 1 }
  const subs = new Set<() => void>()
  let el: HTMLAudioElement | null = null, raf = 0, viewers = 0
  const emit = () => {
    if (!el) return
    state = { playing: !el.paused, time: el.currentTime, duration: Number.isFinite(el.duration) && el.duration ? el.duration : fallbackDuration, rate: el.playbackRate }
    subs.forEach(f => f())
  }
  // smooth progress while playing and on screen; otherwise the 4 Hz timeupdate event is enough
  const loop = () => { raf = 0; emit(); kick() }
  const kick = () => { if (!raf && el && !el.paused && viewers > 0) raf = requestAnimationFrame(loop) }
  const halt = () => { if (raf) cancelAnimationFrame(raf); raf = 0 }
  const audio = () => {
    if (el || typeof Audio === 'undefined') return el
    const a = el = new Audio(); a.preload = 'metadata'; a.src = src; a.playbackRate = state.rate
    a.addEventListener('play', () => { mediaLive.forEach(o => { if (o !== a) o.pause() }); mediaLive.add(a); emit(); kick() })
    a.addEventListener('pause', () => { mediaLive.delete(a); halt(); emit() })
    a.addEventListener('ended', () => { a.currentTime = 0; emit() })
    for (const ev of ['loadedmetadata', 'timeupdate', 'ratechange', 'seeked']) a.addEventListener(ev, emit)
    return a
  }
  const dur = () => state.duration || fallbackDuration
  const play = () => audio()?.play().then(() => true, () => false) ?? Promise.resolve(false)
  return {
    get el() { return audio() },
    get: () => state, subscribe: f => { subs.add(f); return () => { subs.delete(f) } },
    view: d => { viewers = Math.max(0, viewers + d); if (viewers) { audio(); kick() } else halt() },
    play, pause: () => el?.pause(), toggle: () => !el || el.paused ? play() : (el.pause(), Promise.resolve(true)),
    seek: t => { const a = audio(); if (a) { a.currentTime = clamp(t, 0, dur()); emit() } },
    skip: d => { const a = audio(); if (a) { a.currentTime = clamp(a.currentTime + d, 0, dur()); emit() } },
    setRate: r => { const a = audio(); if (a) { a.playbackRate = r; emit() } },
  }
}
/** Subscribe to a track's state (playing, time, duration, rate). Server-safe. */
export function useAudioTrack(track: AudioTrackHandle) { return useSyncExternalStore(track.subscribe, track.get, track.get) }
function useOwnTrack(track: AudioTrackHandle | undefined, src: string | undefined, duration: number, box: RefObject<Element | null>) {
  const [own] = useState(() => track ? null : createAudioTrack(src ?? '', duration))
  useEffect(() => () => own?.pause(), [own])
  const t = track ?? own!
  const onScreen = useInView(box)
  useEffect(() => { if (!onScreen) return; t.view(1); return () => t.view(-1) }, [onScreen, t])
  return t
}

/**
 * A seek bar for media players: returns `bind` (role=slider props: value, ARIA text, pointer and keyboard handlers) to
 * spread on the bar, plus `drag` (scrubbing) and `hover` (0..1 under the mouse, or under the finger while scrubbing).
 * Mouse seeks on press and while dragging; touch and pen use `touch-action: pan-y` (give the bar `touch-pan-y`), so a
 * vertical swipe still scrolls the page, a sideways drag scrubs and a tap seeks to where it landed. Keys: ← / → move
 * `step` seconds, Home / End jump, Space calls `onToggle`. The pointer is captured, so drags keep working outside the bar.
 */
export function useSeekSlider({ time, duration, onSeek, step = 2, onToggle, label = 'Seek', valueText = (t: number, d: number) => `${fmt.clock(t)} of ${fmt.clock(d)}`, focusable = true }:
  { time: number; duration: number; onSeek: (t: number) => void; step?: number; onToggle?: () => void; label?: string; valueText?: (t: number, d: number) => string; focusable?: boolean }) {
  const [drag, setDrag] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const start = useRef<{ x: number; y: number; touch: boolean } | null>(null)
  const d = duration || 1
  const frac = (e: RPointerEvent) => { const r = e.currentTarget.getBoundingClientRect(); return clamp((e.clientX - r.left) / (r.width || 1), 0, 1) }
  const seek = (f: number) => onSeek(f * d)
  const begin = (e: RPointerEvent) => { try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ } setDrag(true); seek(frac(e)) }
  const bind = {
    role: 'slider', tabIndex: focusable ? 0 : -1, 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': Math.round(d), 'aria-valuenow': Math.round(time), 'aria-valuetext': valueText(time, d),
    onPointerDown: (e: RPointerEvent) => { const touch = e.pointerType !== 'mouse'; start.current = { x: e.clientX, y: e.clientY, touch }; if (!touch) begin(e) },
    onPointerMove: (e: RPointerEvent) => {
      if (drag) { const f = frac(e); setHover(f); seek(f); return }
      if (e.pointerType === 'mouse') setHover(frac(e))
      const s = start.current; if (!s?.touch) return
      const dx = Math.abs(e.clientX - s.x), dy = Math.abs(e.clientY - s.y)
      if (dx > 6 && dx > dy) begin(e)
    },
    onPointerUp: (e: RPointerEvent) => { const s = start.current; start.current = null; if (s?.touch && !drag) seek(frac(e)); setDrag(false); if (e.pointerType !== 'mouse') setHover(null) },
    onPointerCancel: () => { start.current = null; setDrag(false); setHover(null) },
    onPointerLeave: (e: RPointerEvent) => { if (e.pointerType === 'mouse' && !drag) setHover(null) },
    onKeyDown: (e: RKeyboardEvent) => {
      const to = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? time + step : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? time - step : e.key === 'Home' ? 0 : e.key === 'End' ? d - 0.1 : null
      if (to !== null) { e.preventDefault(); onSeek(clamp(to, 0, d)) }
      else if (e.key === ' ' && onToggle) { e.preventDefault(); onToggle() }
    },
  } as const
  return { bind, drag, hover }
}

const WAVE_TONE = {
  /** played in the primary colour, previewed in grey, the rest light grey (on cards) */ primary: ['bg-[var(--primary)]', 'bg-[var(--fg3)]', 'bg-[var(--line2)]'],
  /** the text colour, full for played and faded for the rest (inside a coloured bubble) */ current: ['bg-current opacity-100', 'bg-current opacity-60', 'bg-current opacity-35'],
  /** foreground when active, grey otherwise (live input level) */ ink: ['bg-[var(--fg)]', 'bg-[var(--fg2)]', 'bg-[var(--fg3)]'],
} as const
/**
 * Waveform bars from `peaks` (0..1 each). `played` (0..1) colours the bars before it, `hover` (0..1) previews a seek,
 * `bars` resamples to that many bars. `intro` grows the bars in the first time they scroll into view; `live` makes them
 * bounce (a listening microphone). Bars stretch to fill the width unless `barWidth` fixes it. Decorative (aria-hidden):
 * put it inside the control that owns the value (useSeekSlider).
 */
export function Waveform({ peaks, played = 0, hover, bars, tone = 'primary', minHeight = 8, barWidth, intro = true, live, className }:
  { peaks: number[]; played?: number; hover?: number | null; bars?: number; tone?: keyof typeof WAVE_TONE; minHeight?: number; barWidth?: number; intro?: boolean; live?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref, { once: true, amount: 0.5 })
  const n = bars ?? peaks.length
  const pk = bars ? Array.from({ length: n }, (_, i) => peaks.length ? peaks[Math.floor(i / n * peaks.length)] : 0.5) : peaks
  const on = Math.floor(played * n), hov = hover == null ? -1 : Math.floor(hover * n)
  const [cPlayed, cHover, cRest] = WAVE_TONE[tone]
  return (
    <div ref={ref} aria-hidden className={cn('flex items-center gap-0.5', className)}>
      {pk.map((p, i) => {
        const h = Math.max(minHeight, p * 100)
        return (
          <motion.i key={i} className={cn('rounded-sm transition-colors', barWidth ? 'flex-none rounded-full' : 'min-w-px flex-1', i < on ? cPlayed : i < hov ? cHover : cRest)}
            style={{ width: barWidth, height: live ? undefined : `${h}%` }}
            initial={intro ? { scaleY: 0.1 } : false}
            animate={live ? { height: [`${minHeight}%`, `${h}%`, `${minHeight}%`] } : intro ? { scaleY: seen ? 1 : 0.1 } : { height: `${h}%` }}
            transition={live ? { duration: 0.5 + (i % 5) * 0.12, repeat: Infinity, ease: 'easeInOut' } : intro ? { duration: 0.4, delay: i * (4.8 / Math.max(48, n * 8)), ease: [0.22, 1, 0.36, 1] } : { duration: 0.2 }} />
        )
      })}
    </div>
  )
}

/** What a pan reports: distance from where it started, whether it moved more than a few px, and the event. */
export type PinchPanMove = { dx: number; dy: number; moved: boolean; event: RPointerEvent }
/**
 * Two-finger pinch zoom plus one-pointer pan for a zoomable surface (lightbox, cropper). Spread `bind` on the element
 * (give it `touch-none`). A second finger starts a pinch from `getZoom()`; `onZoom(z)` gets the new zoom, clamped to
 * [min, max]. One pointer pans: `onPanStart(e)` may return false to ignore that press, then `onPan` / `onPanEnd` report
 * the distance. `wheel` (the element's ref) also zooms by `wheelStep` per notch. The pointer is captured.
 */
export function usePinchPan({ getZoom, onZoom, min = 1, max = 4, onPinchStart, onPinchEnd, onPanStart, onPan, onPanEnd, onCancel, wheel, wheelStep = 0.15 }: {
  getZoom: () => number; onZoom: (z: number) => void; min?: number; max?: number
  onPinchStart?: () => void; onPinchEnd?: () => void
  onPanStart?: (e: RPointerEvent) => boolean | void; onPan?: (m: PinchPanMove) => void; onPanEnd?: (m: PinchPanMove) => void; onCancel?: () => void
  wheel?: RefObject<HTMLElement | null>; wheelStep?: number }) {
  const fns = useRef({ getZoom, onZoom, onPinchStart, onPinchEnd, onPanStart, onPan, onPanEnd, onCancel, min, max, wheelStep })
  useLayoutEffect(() => { fns.current = { getZoom, onZoom, onPinchStart, onPinchEnd, onPanStart, onPan, onPanEnd, onCancel, min, max, wheelStep } })
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; z: number } | null>(null), pan = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  useEffect(() => {
    const el = wheel?.current; if (!el) return
    const on = (e: WheelEvent) => { e.preventDefault(); const f = fns.current, s = 1 + f.wheelStep; f.onZoom(clamp(f.getZoom() * (e.deltaY < 0 ? s : 1 / s), f.min, f.max)) }
    el.addEventListener('wheel', on, { passive: false }); return () => el.removeEventListener('wheel', on)
  }, [wheel])
  const dist = () => { const [a, b] = [...pts.current.values()]; return Math.hypot(a.x - b.x, a.y - b.y) }
  const move = (e: RPointerEvent): PinchPanMove => { const p = pan.current!, dx = e.clientX - p.x, dy = e.clientY - p.y; if (Math.abs(dx) + Math.abs(dy) > 4) p.moved = true; return { dx, dy, moved: p.moved, event: e } }
  const bind = {
    onPointerDown: (e: RPointerEvent) => {
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
      if (pts.current.size === 2) { pinch.current = { d: dist() || 1, z: fns.current.getZoom() }; pan.current = null; fns.current.onPinchStart?.(); return }
      if (pts.current.size > 2 || fns.current.onPanStart?.(e) === false) return
      pan.current = { x: e.clientX, y: e.clientY, moved: false }
    },
    onPointerMove: (e: RPointerEvent) => {
      if (!pts.current.has(e.pointerId)) return
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const pz = pinch.current, f = fns.current
      if (pz && pts.current.size >= 2) { f.onZoom(clamp(pz.z * dist() / pz.d, f.min, f.max)); return }
      if (pan.current) f.onPan?.(move(e))
    },
    onPointerUp: (e: RPointerEvent) => {
      pts.current.delete(e.pointerId)
      if (pinch.current) { if (pts.current.size < 2) { pinch.current = null; fns.current.onPinchEnd?.() } return }
      if (pan.current) { const m = move(e); pan.current = null; fns.current.onPanEnd?.(m) }
    },
    onPointerCancel: (e: RPointerEvent) => { pts.current.delete(e.pointerId); pinch.current = null; pan.current = null; fns.current.onCancel?.() },
  }
  return { bind, pinching: () => pinch.current !== null }
}

/* ── Video player ──────────────────────────────────────────────────────────── */

const VIDEO_SPEEDS = [1, 1.5, 2, 0.5]
/** Control-bar icon buttons on the video: light on dark whatever the theme, 34px (40px on touch). */
const VIDEO_BTN = '!h-[34px] !w-[34px] [@media(pointer:coarse)]:!h-10 [@media(pointer:coarse)]:!w-10'

/**
 * Video player with custom controls: big play button, title that fades while playing, seek bar with buffer,
 * hover time and drag, back 5 s, mute + volume, time, speed cycle and fullscreen. Controls hide when idle.
 * Keys (when the player itself is focused): Space / K play, ← / → seek 2 s, M mute, F fullscreen. Its controls keep their
 * own keys (the seek bar: ← / → and Home / End), so nothing fires twice.
 * Touch: tap shows or hides the controls (tap while paused plays), double-tap the left or right half to seek ∓5 s,
 * and the seek bar and buttons grow to finger size.
 */
export function VideoPlayer({ src, poster, title, meta, duration: fallback = 0, preparing, className }:
  { src?: string | null; poster?: string; title?: ReactNode; meta?: ReactNode; duration?: number; preparing?: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null), vid = useRef<HTMLVideoElement>(null)
  const toast = useToast()
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0), [dur, setDur] = useState(fallback), [buf, setBuf] = useState(0)
  const [muted, setMuted] = useState(false), [vol, setVol] = useState(0.8), [si, setSi] = useState(0)
  const [idle, setIdle] = useState(false), [isFs, setFs] = useState(false)
  const idleT = useRef<ReturnType<typeof setTimeout>>(undefined)
  const fixing = useRef(false), wantPlay = useRef(false)
  const tap = useRef<{ t: number; side: -1 | 1 } | null>(null), tapT = useRef<ReturnType<typeof setTimeout>>(undefined), touched = useRef(0)
  const [seekFx, setSeekFx] = useState<{ side: -1 | 1; n: number } | null>(null)
  const d = dur || fallback || 1
  const sync = () => {
    const v = vid.current; if (!v) return
    setT(v.currentTime); if (Number.isFinite(v.duration) && v.duration) setDur(v.duration)
    try { if (v.buffered.length) setBuf(v.buffered.end(v.buffered.length - 1)) } catch { /* not ready */ }
  }
  const seekTo = (s: number) => { const v = vid.current; if (v) { v.currentTime = clamp(s, 0, d); sync() } }
  const wake = () => { clearTimeout(idleT.current); setIdle(false); idleT.current = setTimeout(() => setIdle(true), 2200) }
  const toggle = () => { const v = vid.current; if (!v || !src) return; if (fixing.current) { wantPlay.current = !wantPlay.current; return } if (v.paused) v.play().catch(() => toast({ title: 'Couldn’t play video', description: 'Your browser blocked playback', tone: 'bad' })); else v.pause() }
  const seek = useSeekSlider({ time: t, duration: d, onSeek: s => { seekTo(s); wake() }, onToggle: toggle })
  useEffect(() => () => { clearTimeout(idleT.current); clearTimeout(tapT.current) }, [])
  useEffect(() => { if (vid.current) vid.current.volume = 0.8 }, [])
  const { visible: onScreen } = useViewport(box, { amount: 0 })
  useFrameLoop(playing && onScreen, sync) // smooth progress while playing on screen
  useEffect(() => { const on = () => setFs(document.fullscreenElement === box.current); document.addEventListener('fullscreenchange', on); return () => document.removeEventListener('fullscreenchange', on) }, [])
  const seekBy = (s: number) => { const v = vid.current; if (v) seekTo(v.currentTime + s) }
  const toggleMute = () => { const v = vid.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted) }
  const setVolume = (n: number) => { const v = vid.current; setVol(n); if (v) { v.volume = n; v.muted = n === 0; setMuted(n === 0) } }
  const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else box.current?.requestFullscreen?.().catch(() => {}) }
  const cycleSpeed = () => { const n = (si + 1) % VIDEO_SPEEDS.length; setSi(n); if (vid.current) vid.current.playbackRate = VIDEO_SPEEDS[n] }
  const hideControls = playing && idle && !seek.drag
  // touch on the picture: single tap toggles the controls (plays when paused), double tap seeks ∓5 s on that half
  const onTouchTap = (e: RPointerEvent<HTMLVideoElement>) => {
    if (e.pointerType === 'mouse') return
    touched.current = performance.now()
    const r = e.currentTarget.getBoundingClientRect(), side: -1 | 1 = e.clientX - r.left < r.width / 2 ? -1 : 1, now = performance.now(), last = tap.current
    if (last && now - last.t < 320 && last.side === side) {
      clearTimeout(tapT.current); tap.current = { t: now, side } // keep the chain going: triple tap seeks 10 s
      seekBy(side * 5); setSeekFx(f => ({ side, n: (f?.n ?? 0) + 1 })); wake(); return
    }
    tap.current = { t: now, side }
    clearTimeout(tapT.current)
    tapT.current = setTimeout(() => {
      tap.current = null
      if (!playing) toggle()
      else if (idle) wake()
      else { clearTimeout(idleT.current); setIdle(true) }
    }, 280)
  }
  const fromTouch = () => performance.now() - touched.current < 800
  const icon = (name: Parameters<typeof Icon>[0]['name'], size = 17, filled?: boolean) => <Icon name={name} size={size} filled={filled} />
  return (
    <div ref={box} tabIndex={0} aria-label={typeof title === 'string' ? `Video player: ${title}` : 'Video player'}
      className={cn('relative touch-manipulation overflow-hidden bg-black outline-none select-none focus-visible:shadow-[0_0_0_2px_var(--accent)]', isFs ? 'h-full w-full' : 'aspect-video rounded-[var(--r-lg)]', hideControls && 'cursor-none', className)}
      onPointerMove={e => { if (e.pointerType === 'mouse') wake() }} onPointerLeave={e => { if (playing && e.pointerType === 'mouse') setIdle(true) }}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return // keys pressed on a control (seek bar, volume, buttons) belong to that control
        const k = e.key.toLowerCase()
        if (k === ' ' || k === 'k') { e.preventDefault(); toggle() }
        else if (k === 'arrowright') { e.preventDefault(); seekBy(2); wake() }
        else if (k === 'arrowleft') { e.preventDefault(); seekBy(-2); wake() }
        else if (k === 'm') toggleMute()
        else if (k === 'f') fullscreen()
      }}>
      <video ref={vid} src={src ?? undefined} poster={poster} playsInline preload="metadata" className="block h-full w-full object-cover"
        onPointerUp={onTouchTap} onClick={() => { if (!fromTouch()) toggle() }} onDoubleClick={() => { if (!fromTouch()) fullscreen() }}
        onPlay={() => { setPlaying(true); wake() }} onPause={() => { setPlaying(false); setIdle(false); sync() }} onEnded={e => { e.currentTarget.currentTime = 0 }}
        onTimeUpdate={sync} onProgress={sync} onDurationChange={sync}
        onLoadedMetadata={e => {
          const v = e.currentTarget; sync()
          // a recorded WebM reports Infinity until it has been seeked to the end once
          if (v.duration === Infinity) {
            fixing.current = true; v.currentTime = 1e6
            const back = () => { v.removeEventListener('timeupdate', back); v.currentTime = 0; fixing.current = false; sync(); if (wantPlay.current) { wantPlay.current = false; toggle() } }
            v.addEventListener('timeupdate', back)
          }
        }} />
      <AnimatePresence>
        {seekFx && (
          <motion.span key={seekFx.n} aria-hidden initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: [0, 1, 1, 0], scale: 1 }} transition={{ duration: 0.7, times: [0, 0.15, 0.6, 1] }}
            onAnimationComplete={() => setSeekFx(f => f?.n === seekFx.n ? null : f)}
            className={cn('pointer-events-none absolute top-1/2 z-[3] -mt-7 grid h-14 w-14 place-items-center rounded-full bg-black/45 text-[11px] font-semibold text-white', seekFx.side < 0 ? 'left-[18%]' : 'right-[18%]')}>
            <span className="flex flex-col items-center leading-tight">{icon(seekFx.side < 0 ? 'replay' : 'forward', 18)}{seekFx.side < 0 ? '−5 s' : '+5 s'}</span>
          </motion.span>
        )}
      </AnimatePresence>
      {(preparing || !src) && <span className="absolute top-3 right-3 z-[3] rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium text-white">{preparing ? 'Preparing preview…' : 'Video preview isn’t supported in this browser'}</span>}
      <AnimatePresence>
        {!playing && (
          <motion.button key="big" type="button" aria-label="Play" onClick={toggle} disabled={!src}
            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1, transition: spring(0.4, 0.35) }} exit={{ opacity: 0, scale: 1.3, transition: { duration: 0.25 } }}
            className="absolute top-1/2 left-1/2 -mt-8 -ml-8 grid h-16 w-16 cursor-pointer place-items-center rounded-full border-0 bg-white/20 pl-1 text-white backdrop-blur-md hover:bg-white/30 disabled:cursor-default">
            {icon('play', 26, true)}
          </motion.button>
        )}
      </AnimatePresence>
      {(title || meta) && (
        <motion.div initial={false} animate={{ opacity: playing ? 0 : 1 }} transition={{ duration: 0.3 }}
          className="pointer-events-none absolute inset-x-0 top-0 flex flex-col bg-gradient-to-b from-black/55 to-transparent px-4 pt-3 pb-7 text-[13px] text-white">
          <b className="font-semibold">{title}</b><span className="text-[11px] opacity-70">{meta}</span>
        </motion.div>
      )}
      <motion.div initial={false} animate={{ opacity: hideControls ? 0 : 1 }} transition={{ duration: 0.2 }}
        // the gradient itself lets taps through to the video (only the seek bar and buttons catch them)
        className={cn('pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-b from-transparent to-black/65 px-3 pt-6 pb-2 text-white max-sm:px-2 max-sm:pt-4 max-sm:pb-1 [&>*]:pointer-events-auto', hideControls && '[&>*]:!pointer-events-none')}>
        <div {...seek.bind} className="group relative flex h-4 cursor-pointer touch-pan-y items-center rounded-sm outline-none focus-visible:shadow-[0_0_0_2px_#fff] [@media(pointer:coarse)]:h-8">
          <span className="absolute inset-x-0 h-1 rounded-sm bg-white/25 transition-[height] group-hover:h-1.5" />
          <span className="absolute left-0 h-1 rounded-sm bg-white/35 transition-[height] group-hover:h-1.5" style={{ width: `${Math.min(100, buf / d * 100)}%` }} />
          <span className="absolute left-0 h-1 rounded-sm bg-white transition-[height] group-hover:h-1.5" style={{ width: `${t / d * 100}%` }} />
          <span className={cn('absolute -ml-1.5 h-[13px] w-[13px] rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,.4)] transition-transform group-hover:scale-100 group-focus-visible:scale-100 [@media(pointer:coarse)]:scale-100', seek.drag ? 'scale-100 [@media(pointer:coarse)]:scale-125' : 'scale-0')} style={{ left: `${t / d * 100}%` }} />
          {seek.hover != null && <span className="pointer-events-none absolute bottom-5 -translate-x-1/2 rounded-[5px] bg-black/75 px-1.5 py-1 font-[family-name:var(--mono)] text-[11px] font-medium" style={{ left: `${seek.hover * 100}%` }}>{fmt.clock(seek.hover * d)}</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-0.5">
          <IconButton tone="onDark" size="icon" className={VIDEO_BTN} label={playing ? 'Pause' : 'Play'} onClick={toggle} icon={icon(playing ? 'pause' : 'play', 18, true)} />
          <IconButton tone="onDark" size="icon" className={VIDEO_BTN} label="Back 5 seconds" onClick={() => seekBy(-5)} icon={icon('replay')} />
          <div className="group/vol flex items-center">{/* phones use the hardware volume: only the mute button shows on touch */}
            <IconButton tone="onDark" size="icon" className={VIDEO_BTN} label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute} icon={icon(muted || vol === 0 ? 'volumeX' : 'volume')} />
            {/* the shared Slider, re-tinted light for the video (its track and thumb follow --primary / --muted) */}
            <label className="flex w-0 items-center overflow-hidden opacity-0 transition-[width,opacity,margin] duration-200 [--muted:rgba(255,255,255,.3)] [--primary:#fff] [@media(pointer:coarse)]:hidden group-hover/vol:mr-1.5 group-hover/vol:w-[70px] group-hover/vol:opacity-100 group-focus-within/vol:mr-1.5 group-focus-within/vol:w-[70px] group-focus-within/vol:opacity-100">
              <span className="sr-only">Volume</span><Slider min={0} max={1} step={0.01} value={muted ? 0 : vol} onChange={setVolume} className="w-full" />
            </label>
          </div>
          <span className="ml-1.5 font-[family-name:var(--mono)] text-xs font-medium whitespace-nowrap opacity-90 max-sm:ml-0.5">{fmt.clock(t)} / {fmt.clock(d)}</span>
          <span className="flex-1" />
          <IconButton tone="onDark" size="icon" className="!h-[34px] !w-auto min-w-[34px] !px-2 font-[family-name:var(--mono)] text-xs font-semibold [@media(pointer:coarse)]:!h-10 [@media(pointer:coarse)]:min-w-10" label={`Playback speed ${VIDEO_SPEEDS[si]}×`} onClick={cycleSpeed}
            icon={<motion.span key={si} initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={spring(0.5, 0.3)}>{VIDEO_SPEEDS[si]}×</motion.span>} />
          <IconButton tone="onDark" size="icon" className={VIDEO_BTN} label={isFs ? 'Exit fullscreen' : 'Fullscreen'} onClick={fullscreen} icon={icon(isFs ? 'minimize' : 'maximize')} />
        </div>
      </motion.div>
    </div>
  )
}

/* ── Audio player ──────────────────────────────────────────────────────────── */

const AUDIO_SPEEDS = [1, 1.25, 1.5, 2, 0.75]
/** Round primary play / pause button shared by the audio players. */
function MediaPlayButton({ playing, label, size, iconSize, className, onClick }: { playing: boolean; label: string; size: string; iconSize: number; className?: string; onClick: () => void }) {
  return (
    <motion.button type="button" whileTap={{ scale: 0.88 }} aria-label={label} onClick={onClick}
      className={cn('grid flex-none cursor-pointer place-items-center rounded-full border-0', size, !playing && 'pl-0.5', className ?? 'bg-[var(--primary)] text-[var(--on-primary)]')}>
      <Icon name={playing ? 'pause' : 'play'} size={iconSize} filled />
    </motion.button>
  )
}

/**
 * Audio player: cover, title, back / forward 10 s, speed cycle and a waveform you click or drag to seek
 * (hovering previews the jump; on touch, tap or swipe sideways along it, while a vertical swipe still scrolls the page). The waveform is a slider: ← / → seek 2 s, Home / End, Space plays.
 * Pass `track` (createAudioTrack) to share playback with other players, or just `src`.
 */
export function AudioPlayer({ track: shared, src, title, meta, cover, peaks, duration = 0, className }:
  { track?: AudioTrackHandle; src?: string; title: ReactNode; meta?: ReactNode; cover?: string | ReactNode; peaks: number[]; duration?: number; className?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const track = useOwnTrack(shared, src, duration, root)
  const s = useAudioTrack(track)
  const toast = useToast()
  const d = s.duration || duration || 1
  const toggle = () => track.toggle().then(ok => { if (!ok) toast({ title: 'Couldn’t play audio', description: 'Your browser blocked playback', tone: 'bad' }) })
  const seek = useSeekSlider({ time: s.time, duration: d, onSeek: track.seek, onToggle: toggle })
  const [plays, setPlays] = useState(0)
  useEffect(() => { if (s.playing) setPlays(p => p + 1) }, [s.playing])
  return (
    <div ref={root} className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center gap-3">
        <motion.div key={plays} initial={plays ? { scale: 1 } : false} animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 0.5 }}
          className={cn(surface.muted, 'h-14 w-14 flex-none overflow-hidden')}>
          {typeof cover === 'string' ? <img src={cover} alt="" className="block h-full w-full object-cover" /> : cover}
        </motion.div>
        <div className="min-w-0 flex-1">
          <b className="block truncate font-semibold">{title}</b>
          {meta && <span className="text-xs text-[var(--fg3)]">{meta}</span>}
          <div className="mt-2 flex items-center gap-1">
            <IconButton icon="replay" label="Back 10 seconds" onClick={() => track.skip(-10)} tone="default" className="text-[var(--fg2)] hover:text-[var(--fg)]" />
            <MediaPlayButton playing={s.playing} label={s.playing ? 'Pause' : 'Play'} onClick={toggle} size="h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" iconSize={16} />
            <IconButton icon="forward" label="Forward 10 seconds" onClick={() => track.skip(10)} tone="default" className="text-[var(--fg2)] hover:text-[var(--fg)]" />
            <span className="flex-1" />
            <Button variant="ghost" size="sm" aria-label={`Playback speed ${s.rate}×`} onClick={() => track.setRate(AUDIO_SPEEDS[(AUDIO_SPEEDS.indexOf(s.rate) + 1) % AUDIO_SPEEDS.length])} className="ui-num [@media(pointer:coarse)]:min-w-11">{s.rate}×</Button>
          </div>
        </div>
      </div>
      <div {...seek.bind} className="h-12 cursor-pointer touch-pan-y rounded-md outline-none select-none focus-visible:shadow-[0_0_0_2px_var(--accent)]">
        <Waveform peaks={peaks} played={s.time / d} hover={seek.hover} className="h-full" />
      </div>
      <div className="ui-num -mt-1 flex justify-between text-[11px] text-[var(--fg3)]"><span>{fmt.clock(s.time)}</span><span>{fmt.clock(d)}</span></div>
    </div>
  )
}

/** Slim pill player: play, title, a thin draggable progress bar (← / → when focused; a 32px touch band on phones) and the time. Share `track` to sync with a full player. */
export function MiniAudioPlayer({ track: shared, src, title, duration = 0, className }: { track?: AudioTrackHandle; src?: string; title: string; duration?: number; className?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const track = useOwnTrack(shared, src, duration, root)
  const s = useAudioTrack(track)
  const d = s.duration || duration || 1
  const seek = useSeekSlider({ time: s.time, duration: d, onSeek: track.seek, onToggle: () => track.toggle(), valueText: t => fmt.clock(t) })
  return (
    <div ref={root} className={cn('flex items-center gap-2.5 rounded-full border border-[var(--line)] bg-[var(--card)] py-2 pr-3 pl-2 [@media(pointer:coarse)]:gap-3 [@media(pointer:coarse)]:pr-4', className)}>
      <MediaPlayButton playing={s.playing} label={`${s.playing ? 'Pause' : 'Play'} ${title}`} onClick={() => track.toggle()} size="h-8 w-8 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9" iconSize={13} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <b className="truncate text-xs leading-none font-semibold">{title}</b>
        <motion.div {...seek.bind} animate={{ scaleY: seek.drag ? 1.6 : 1 }} transition={{ duration: 0.12 }}
          className="relative h-1 cursor-pointer touch-pan-y rounded-sm bg-[var(--muted)] outline-none before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] focus-visible:shadow-[0_0_0_2px_var(--accent)] [@media(pointer:coarse)]:before:-inset-y-3.5">
          <i className="absolute inset-y-0 left-0 rounded-sm bg-[var(--primary)]" style={{ width: `${s.time / d * 100}%` }} />
        </motion.div>
      </div>
      <span className="ui-num flex-none text-[11px] text-[var(--fg3)] [@media(pointer:coarse)]:text-xs">{fmt.clock(!s.playing && !s.time ? d : s.time)}</span>
    </div>
  )
}

const VOICE_SPEEDS = [1, 1.5, 2]
/** Chat-style voice note bubble: play, a waveform you tap or drag to seek, elapsed / total time and a speed chip. */
export function VoiceNote({ track: shared, src, peaks, duration = 0, bars = 34, className }: { track?: AudioTrackHandle; src?: string; peaks: number[]; duration?: number; bars?: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const track = useOwnTrack(shared, src, duration, box)
  const s = useAudioTrack(track)
  const d = s.duration || duration || 1
  const seek = useSeekSlider({ time: s.time, duration: d, onSeek: track.seek, onToggle: () => track.toggle(), label: 'Seek voice note' })
  return (
    <div ref={box} className={cn('flex w-full max-w-[280px] items-center gap-2 self-end rounded-[18px_18px_4px_18px] bg-[var(--primary)] py-2 pr-2.5 pl-2 text-[var(--on-primary)]', className)}>
      <MediaPlayButton playing={s.playing} label={s.playing ? 'Pause voice note' : 'Play voice note'} onClick={() => track.toggle()} iconSize={12}
        size="h-7 w-7 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9" className="bg-[color-mix(in_srgb,var(--on-primary)_18%,transparent)] text-inherit" />
      <div {...seek.bind} className="h-[22px] min-w-0 flex-1 cursor-pointer touch-pan-y rounded outline-none select-none focus-visible:shadow-[0_0_0_2px_var(--on-primary)] [@media(pointer:coarse)]:h-8">
        <Waveform peaks={peaks} bars={bars} played={s.time / d} tone="current" minHeight={14} className="h-full" />
      </div>
      <span className="ui-num flex-none text-[11px] opacity-80">{fmt.clock(s.time || d)}</span>
      <button type="button" aria-label={`Playback speed ${s.rate}×`} onClick={() => track.setRate(VOICE_SPEEDS[(VOICE_SPEEDS.indexOf(s.rate) + 1) % VOICE_SPEEDS.length])}
        className="h-5 flex-none cursor-pointer rounded-full border-0 bg-[color-mix(in_srgb,var(--on-primary)_16%,transparent)] px-1.5 font-[family-name:var(--mono)] text-[10px] font-semibold text-inherit [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:min-w-9 [@media(pointer:coarse)]:text-[11px]">
        <motion.span key={s.rate} className="inline-block" initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={spring(0.5, 0.3)}>{s.rate}×</motion.span>
      </button>
    </div>
  )
}

/* ── Lightbox ──────────────────────────────────────────────────────────────── */

export type LightboxItem = { id: string | number; src: string; full?: string | (() => string); title: string; meta?: string; ratio: number }
const lightboxFull = (it: LightboxItem) => typeof it.full === 'function' ? it.full() : it.full ?? it.src
/** Round chrome button on the dark lightbox backdrop (any theme). */
const LB_BTN = '!h-[38px] !w-[38px] !rounded-full !bg-white/10 text-white hover:!bg-white/20 aria-pressed:!bg-white/25'
const LB_NAV = '!h-12 !w-12 !rounded-full !bg-white/10 text-white hover:!bg-white/20'

/**
 * Full-screen image viewer. Opens from (and closes back into) the thumbnail `originFor(id)` returns.
 * Thumbnails strip, swipe to change, click / double-click / wheel / + − to zoom, drag to pan,
 * ← / → to move, Esc to close. Touch: swipe sideways to change, pinch or double-tap to zoom, swipe down to close.
 * Renders in the themed overlay layer with the shared scroll lock; focus is trapped while open; the chrome respects the safe areas.
 */
export function Lightbox(props: { items: LightboxItem[]; index: number; onIndexChange: (i: number) => void; onClose: () => void; originFor?: (id: LightboxItem['id']) => Element | null | undefined }) {
  useScrollLock(true)
  return <OverlayPortal><LightboxView {...props} /></OverlayPortal>
}

function LightboxView({ items, index, onIndexChange, onClose, originFor }:
  { items: LightboxItem[]; index: number; onIndexChange: (i: number) => void; onClose: () => void; originFor?: (id: LightboxItem['id']) => Element | null | undefined }) {
  const root = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), thumbs = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const fx = useMotionValue(0), fy = useMotionValue(0), fs = useMotionValue(1), fo = useMotionValue(1)
  const zs = useMotionValue(1), zx = useMotionValue(0), zy = useMotionValue(0)
  const [zoom, setZoomState] = useState(1)
  const [closing, setClosing] = useState(false)
  const [, setTick] = useState(0)
  const [hiSrc, setHiSrc] = useState<string | null>(null)
  const lastTap = useRef(0), ptrType = useRef('mouse'), zoomRef = useRef(1), panFrom = useRef({ x: 0, y: 0 }), moved = useRef(false), bgDown = useRef(false)
  const it = items[index]
  useFocusTrap(root, true)
  useEffect(() => { const r = () => setTick(n => n + 1); addEventListener('resize', r); return () => removeEventListener('resize', r) }, [])
  // frame size from the image ratio, so it's known before the full image decodes
  const vw = document.documentElement.clientWidth || window.innerWidth, stageH = Math.max(120, (stage.current?.clientHeight ?? window.innerHeight - 64 - 130))
  const w = Math.min(Math.min(vw * 0.92, 1100), stageH / it.ratio), h = w * it.ratio
  const delta = (el: Element) => {
    const a = el.getBoundingClientRect(), b = frame.current!.getBoundingClientRect()
    const bx = b.left + b.width / 2 - fx.get(), by = b.top + b.height / 2 - fy.get(), bw = b.width / fs.get()
    return { x: a.left + a.width / 2 - bx, y: a.top + a.height / 2 - by, s: a.width / bw }
  }
  const setZoom = (z: number) => {
    zoomRef.current = z; setZoomState(z)
    if (z === 1) { animate(zx, 0, spring(0.15, 0.4)); animate(zy, 0, spring(0.15, 0.4)) }
    animate(zs, z, spring(0.15, 0.4))
  }
  const zoomNow = (z: number) => { zoomRef.current = z; setZoomState(z); zs.set(z); if (z === 1) { zx.set(0); zy.set(0) } } // follows a pinch or wheel directly
  const resetZoom = () => { zoomRef.current = 1; setZoomState(1); zs.set(1); zx.set(0); zy.set(0) }
  // open: shared-element transition from the thumbnail
  useLayoutEffect(() => {
    const origin = originFor?.(it.id)
    if (origin && !reduce) { const dl = delta(origin); fx.set(dl.x); fy.set(dl.y); fs.set(dl.s); animate(fx, 0, spring(0.18, 0.5)); animate(fy, 0, spring(0.18, 0.5)); animate(fs, 1, spring(0.18, 0.5)) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // swap in the full-resolution image once the thumbnail is showing
  useEffect(() => { setHiSrc(null); const r = requestAnimationFrame(() => setHiSrc(lightboxFull(it))); return () => cancelAnimationFrame(r) }, [it])
  useEffect(() => { thumbs.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' }) }, [index])
  const go = (k: number) => {
    const dir = k > index ? 1 : -1, n = (k + items.length) % items.length
    resetZoom(); onIndexChange(n)
    if (!reduce) { fx.set(dir * 40); fo.set(0); animate(fx, 0, spring(0.2, 0.4)); animate(fo, 1, { duration: 0.25 }) } else { fx.set(0); fo.set(1) }
  }
  const close = async () => {
    if (closing) return
    setClosing(true)
    const origin = originFor?.(it.id)
    if (origin && !reduce) {
      const dl = delta(origin); zs.set(1); zx.set(0); zy.set(0)
      await Promise.all([animate(fx, dl.x, { duration: 0.3, ease: [0.4, 0, 0.2, 1] }), animate(fy, dl.y, { duration: 0.3, ease: [0.4, 0, 0.2, 1] }), animate(fs, dl.s, { duration: 0.3, ease: [0.4, 0, 0.2, 1] })])
    } else await animate(fo, 0, { duration: 0.15 })
    onClose()
  }
  const settle = () => { animate(fx, 0, spring(0.3, 0.35)); animate(fy, 0, spring(0.3, 0.35)); animate(fo, 1, { duration: 0.15 }) }
  const latest = useRef({ go, close, setZoom, index }); latest.current = { go, close, setZoom, index }
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const L = latest.current
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); L.close() }
      else if (e.key === 'ArrowRight') L.go(L.index + 1)
      else if (e.key === 'ArrowLeft') L.go(L.index - 1)
      else if (e.key === '+' || e.key === '=') L.setZoom(Math.min(4, zoomRef.current + 0.6))
      else if (e.key === '-') L.setZoom(Math.max(1, zoomRef.current - 0.6))
    }
    document.addEventListener('keydown', on, true); return () => document.removeEventListener('keydown', on, true)
  }, [])
  const gesture = usePinchPan({
    getZoom: () => zoomRef.current, onZoom: zoomNow, wheel: stage,
    onPinchStart: () => { moved.current = true; animate(fx, 0, spring(0.3, 0.35)); animate(fy, 0, spring(0.3, 0.35)) }, // a second finger takes over from the swipe / pan
    onPinchEnd: () => { if (zoomRef.current < 1.08) setZoom(1); setTimeout(() => { moved.current = false }, 0) },
    onPanStart: e => {
      ptrType.current = e.pointerType; bgDown.current = e.target === e.currentTarget
      if (!(e.target as Element).closest('img')) return false
      panFrom.current = { x: zx.get(), y: zy.get() }; moved.current = false
    },
    onPan: ({ dx, dy, moved: m }) => {
      if (m) moved.current = true
      if (zoomRef.current > 1) { zx.set(panFrom.current.x + dx); zy.set(panFrom.current.y + dy) }
      else if (Math.abs(dy) > Math.abs(dx) && dy > 0) { fy.set(dy * 0.8); fx.set(0); fo.set(Math.max(0.4, 1 - dy / 500)) } // swipe down to close
      else { fx.set(dx); fy.set(0); fo.set(1) }
    },
    onPanEnd: ({ dx, dy, moved: m, event }) => {
      if (event.pointerType !== 'mouse' && !m) { // touch double tap toggles zoom
        const now = performance.now()
        if (now - lastTap.current < 300) { lastTap.current = 0; setZoom(zoomRef.current > 1 ? 1 : 2.2) } else lastTap.current = now
      }
      if (zoomRef.current === 1) {
        if (dy > 110 && dy > Math.abs(dx)) close()
        else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(index + (dx < 0 ? 1 : -1))
        else settle()
      }
      setTimeout(() => { moved.current = false }, 0)
    },
    onCancel: () => { animate(fx, 0, spring(0.3, 0.35)); animate(fy, 0, spring(0.3, 0.35)); fo.set(1) },
  })
  const chrome = { initial: { opacity: 0 }, animate: { opacity: closing ? 0 : 1 }, transition: { duration: closing ? 0.15 : 0.3, delay: closing ? 0 : 0.1 } }
  return (
    <div ref={root} role="dialog" aria-modal="true" aria-label="Image viewer" className="fixed inset-0 z-[95] text-white">
      <motion.div className="absolute inset-0 bg-[rgba(8,8,10,.92)] backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: closing ? 0 : 1 }} transition={{ duration: 0.25 }} onClick={close} />
      <motion.div {...chrome} className="absolute inset-x-0 top-0 z-[2] flex items-center gap-1.5 p-3 pt-[max(12px,env(safe-area-inset-top))] text-[13px]">
        <span className="ui-num">{index + 1} / {items.length}</span><span className="flex-1" />
        <IconButton tone="default" size="icon" className={LB_BTN} label={zoom > 1 ? 'Zoom out' : 'Zoom in'} aria-pressed={zoom > 1} onClick={() => setZoom(zoom > 1 ? 1 : 2.2)} icon={<Icon name="zoomIn" size={18} />} />
        <IconButton tone="default" size="icon" className={LB_BTN} label="Close" data-autofocus onClick={close} icon={<Icon name="x" size={17} />} />
      </motion.div>
      <div ref={stage} className="absolute inset-x-0 top-[calc(64px+env(safe-area-inset-top))] bottom-[calc(130px+env(safe-area-inset-bottom))] flex touch-none items-center justify-center overflow-hidden"
        onClick={() => { if (bgDown.current && !moved.current) close(); bgDown.current = false }} {...gesture.bind}>
        <motion.div ref={frame} style={{ x: fx, y: fy, scale: fs, opacity: fo, width: w, height: h }} className="relative flex-none">
          <motion.img src={hiSrc ?? it.src} alt={it.title} draggable={false} style={{ x: zx, y: zy, scale: zs, backgroundImage: `url(${it.src})` }}
            onClick={() => { if (ptrType.current === 'mouse' && zoomRef.current === 1 && !moved.current) setZoom(2.2) }} onDoubleClick={() => { if (ptrType.current === 'mouse') setZoom(zoomRef.current > 1 ? 1 : 2.2) }}
            className={cn('block h-full w-full rounded-[10px] bg-cover object-cover shadow-[0_20px_60px_rgba(0,0,0,.5)] select-none', zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in')} />
        </motion.div>
      </div>
      <motion.div {...chrome} className="absolute top-1/2 left-4 z-[2] -mt-6 max-sm:hidden"><IconButton tone="default" size="icon" className={LB_NAV} label="Previous" onClick={() => go(index - 1)} icon={<Icon name="chevronLeft" size={24} />} /></motion.div>
      <motion.div {...chrome} className="absolute top-1/2 right-4 z-[2] -mt-6 max-sm:hidden"><IconButton tone="default" size="icon" className={LB_NAV} label="Next" onClick={() => go(index + 1)} icon={<Icon name="chevronRight" size={24} />} /></motion.div>
      <motion.div {...chrome} className="pointer-events-none absolute inset-x-0 bottom-[calc(86px+env(safe-area-inset-bottom))] flex flex-col gap-0.5 text-center text-[13px]" aria-live="polite">
        <b className="font-semibold">{it.title}</b>{it.meta && <span className="text-xs opacity-65">{it.meta}</span>}
      </motion.div>
      <motion.div {...chrome} ref={thumbs} className="absolute inset-x-0 bottom-0 flex gap-1.5 overflow-x-auto overscroll-x-contain p-3 pb-[max(12px,env(safe-area-inset-bottom))] [scrollbar-width:none] [&>:first-child]:ml-auto [&>:last-child]:mr-auto">
        {items.map((t, k) => (
          <button key={t.id} type="button" aria-label={t.title} aria-current={k === index} onClick={() => go(k)}
            className={cn('h-[52px] w-[52px] flex-none cursor-pointer overflow-hidden rounded-lg border-0 bg-[#222] p-0 transition-[opacity,transform] duration-200', k === index ? '-translate-y-0.5 opacity-100 shadow-[0_0_0_2px_#fff]' : 'opacity-45 hover:opacity-80')}>
            <img src={t.src} alt="" className="block h-full w-full object-cover" />
          </button>
        ))}
      </motion.div>
    </div>
  )
}

/* ── Masonry gallery ───────────────────────────────────────────────────────── */

export type GalleryItem = LightboxItem & { category: string; author: string; likes: number }

function MasonryTile({ it, x, y, width, imgH, delay, saved, onSave, onOpen, imgRef }:
  { it: GalleryItem; x: number; y: number; width: number; imgH: number; delay: number; saved: boolean; onSave: () => void; onOpen: () => void; imgRef: (el: HTMLImageElement | null) => void }) {
  const [entered, setEntered] = useState(false)
  // a list item holding two sibling controls: the picture opens the lightbox, Save toggles (never a button inside a button)
  return (
    <motion.div role="listitem"
      initial={{ x, y: y + 20, opacity: 0, scale: 0.96 }} animate={{ x, y, opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
      transition={entered ? spring(0.15, 0.55) : { duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }} onAnimationComplete={() => setEntered(true)}
      className="group absolute top-0 left-0" style={{ width }}>
      <div className="relative overflow-hidden rounded-[var(--r-lg)] bg-[var(--muted)] has-[button:focus-visible]:shadow-[0_0_0_2px_var(--accent)]" style={{ height: imgH }}>
        <button type="button" onClick={onOpen} aria-label={`Open ${it.title} by ${it.author}`} className="absolute inset-0 block cursor-zoom-in border-0 bg-transparent p-0 outline-none">
          <img ref={imgRef} src={it.src} alt="" draggable={false} className="block h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] group-hover:scale-[1.04]" />
          <span aria-hidden className="absolute inset-0 flex items-end justify-between gap-2 bg-gradient-to-b from-transparent from-55% to-black/55 p-2.5 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 max-sm:p-2">
            <span className="min-w-0 truncate">{it.title}</span><span className="flex-none">♥ {it.likes}</span>
          </span>
        </button>
        <motion.button type="button" aria-pressed={saved} aria-label={`${saved ? 'Unsave' : 'Save'} ${it.title}`} whileTap={{ scale: 0.85 }} onClick={onSave}
          className={cn('absolute top-2 right-2 h-[30px] cursor-pointer rounded-full border-0 px-3 text-xs font-semibold transition-[opacity,transform] duration-200 [@media(pointer:coarse)]:h-[34px] max-sm:top-1.5 max-sm:right-1.5',
            // touch has no hover: the button is always shown there
            saved ? 'bg-[var(--primary)] text-[var(--on-primary)] opacity-100' : '-translate-y-1 bg-[var(--bad)] text-[var(--card)] opacity-0 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100 [@media(pointer:coarse)]:translate-y-0 [@media(pointer:coarse)]:opacity-100')}>
          {saved ? 'Saved' : 'Save'}
        </motion.button>
      </div>
      <div className="flex h-[30px] min-w-0 items-center gap-1.5 px-0.5 pt-2 text-xs text-[var(--fg2)]"><Avatar name={it.author} size={18} className="!border-0 [@media(pointer:coarse)]:!h-[22px] [@media(pointer:coarse)]:!w-[22px] [@media(pointer:coarse)]:!text-[11px]" /><span className="min-w-0 truncate">{it.author}</span></div>
    </motion.div>
  )
}

/**
 * Pinterest-style masonry: each tile drops into the shortest column; columns follow the width (two on phones).
 * On touch screens the Save button and the title overlay are always visible (no hover there).
 * Category chips filter with a reflow, "Load more" staggers new tiles in (and says "That’s everything"
 * when `hasMore` is false), Save toggles per tile, and clicking opens the Lightbox from the tile.
 * Tiles appear when the gallery scrolls into view.
 */
export function MasonryGallery({ items, categories, onLoadMore, hasMore = true, minColumn = 210, className }:
  { items: GalleryItem[]; categories?: string[]; onLoadMore?: () => void; hasMore?: boolean; minColumn?: number; className?: string }) {
  const [host, W] = useWidth<HTMLDivElement>()
  const inView = useInView(host, { once: true, amount: 0.05 })
  const toast = useToast()
  const [filter, setFilter] = useState('All')
  const [saved, setSaved] = useState<Set<GalleryItem['id']>>(() => new Set())
  const [open, setOpen] = useState<number | null>(null)
  const imgs = useRef(new Map<GalleryItem['id'], HTMLImageElement>())
  const prevIds = useRef(new Set<GalleryItem['id']>())
  const cats = categories ?? ['All', ...new Set(items.map(i => i.category))]
  const visible = inView ? items.filter(it => filter === 'All' || it.category === filter) : []
  const gap = W < 480 ? 8 : 12, cols = Math.max(2, Math.min(5, Math.floor((W + gap) / minColumn))), cw = W ? (W - gap * (cols - 1)) / cols : 0
  const hs = new Array<number>(cols).fill(0)
  let fresh = 0
  const placed = visible.map(it => {
    const c = hs.indexOf(Math.min(...hs)), x = c * (cw + gap), y = hs[c], imgH = cw * it.ratio
    hs[c] += imgH + 30 + gap
    const delay = prevIds.current.has(it.id) ? 0 : Math.min(12, fresh++) * 0.04
    return { it, x, y, imgH, delay }
  })
  useEffect(() => { prevIds.current = new Set(visible.map(v => v.id)) })
  const height = visible.length ? Math.max(...hs) - gap : 240
  const lbItems = visible.map(it => ({ ...it, meta: `${it.author} · ${it.category} · ♥ ${it.likes}` }))
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
        {cats.map(c => <Chip key={c} pressed={c === filter} onClick={() => setFilter(c)} className="font-normal">{c}</Chip>)}
      </div>
      <motion.div ref={host} role="list" aria-label="Gallery" className="relative" initial={false} animate={{ height }} transition={{ duration: 0.35, ease: 'easeOut' }}>
        <AnimatePresence>
          {cw > 0 && placed.map(({ it, x, y, imgH, delay }, k) => (
            <MasonryTile key={it.id} it={it} x={x} y={y} width={cw} imgH={imgH} delay={delay} saved={saved.has(it.id)}
              imgRef={el => { if (el) imgs.current.set(it.id, el); else imgs.current.delete(it.id) }}
              onOpen={() => setOpen(k)}
              onSave={() => {
                const was = saved.has(it.id)
                setSaved(s => { const n = new Set(s); if (was) n.delete(it.id); else n.add(it.id); return n })
                if (!was) toast({ title: 'Saved to board', description: it.title, tone: 'ok' })
              }} />
          ))}
        </AnimatePresence>
      </motion.div>
      {onLoadMore && <Button className="self-center" disabled={!hasMore} onClick={onLoadMore}>{hasMore ? 'Load more' : 'That’s everything'}</Button>}
      {open != null && lbItems[open] && <Lightbox items={lbItems} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} originFor={id => imgs.current.get(id)} />}
    </div>
  )
}

/* ── Media card ────────────────────────────────────────────────────────────── */

/** Loading placeholder for MediaCard. The shimmer only animates while the card is on screen. */
function MediaCardSkeleton({ className }: { className: string }) {
  const { ref, visible: onScreen } = useViewport<HTMLDivElement>(null, { amount: 0 })
  const bone = cn('rounded-md bg-[var(--muted)]', onScreen && 'ui-shimmer')
  return (
    <div ref={ref} className={className} aria-busy="true" aria-label="Loading">
      <div className={cn(bone, 'aspect-[4/3] !rounded-none')} />
      <div className="flex flex-col gap-2 p-3"><div className={cn(bone, 'h-3 w-2/5')} /><div className={cn(bone, 'h-3.5 w-[85%]')} /><div className={cn(bone, 'h-2.5 w-[95%]')} /><div className={cn(bone, 'h-2.5 w-3/5')} /></div>
    </div>
  )
}

/**
 * Article / video card: image with a tag and duration badge, date line, title, description, author and a
 * bookmark toggle. `loading` shows a matching skeleton; content fades up (staggered by `index`) and the
 * card lifts on hover. The card itself is not a control (only the bookmark is); wrap the title in a link to make it open something.
 */
export function MediaCard({ image, title, description, tag, duration, date, author, loading, index = 0, bookmarked, defaultBookmarked = false, onBookmarkChange, className }:
  { image?: string; title?: string; description?: string; tag?: string; duration?: string; date?: string; author?: string; loading?: boolean; index?: number; bookmarked?: boolean; defaultBookmarked?: boolean; onBookmarkChange?: (v: boolean) => void; className?: string }) {
  const [ownMark, setOwnMark] = useState(defaultBookmarked)
  const mark = bookmarked ?? ownMark
  const [pops, setPops] = useState(0)
  const shell = cn(surface.card, 'flex flex-col overflow-hidden')
  if (loading) return <MediaCardSkeleton className={cn(shell, className)} />
  return (
    <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -4 }} transition={{ opacity: { duration: 0.4, delay: index * 0.07 }, y: spring(0.3, 0.35) }}
      className={cn(shell, 'transition-shadow hover:shadow-[var(--shadow)]', className)}>
      <div className="relative aspect-[4/3] overflow-hidden bg-[var(--muted)]">
        {image && <img src={image} alt={title} className="block h-full w-full object-cover" />}
        {tag && <span className="absolute top-2.5 left-2.5 rounded-full bg-black/50 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">{tag}</span>}
        {duration && <span className="absolute right-2.5 bottom-2.5 rounded-[5px] bg-black/65 px-1.5 py-0.5 font-[family-name:var(--mono)] text-[11px] font-medium text-white">{duration}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        {date && <span className="text-[11px] text-[var(--fg3)]">{date}</span>}
        <div className="text-sm leading-tight font-semibold">{title}</div>
        {description && <div className="text-xs leading-[1.45] text-[var(--fg2)]">{description}</div>}
        <div className="mt-auto flex items-center gap-2 pt-1.5 text-xs leading-none text-[var(--fg3)]">
          {author && <><Avatar name={author} size={22} className="!border-0 [@media(pointer:coarse)]:!text-[11px]" />{author}</>}
          <span className="flex-1" />
          <IconButton label={title ? `Bookmark ${title}` : 'Bookmark'} aria-pressed={mark} tone={mark ? 'default' : 'muted'} className={cn('-my-1 !h-6 !w-6 [@media(pointer:coarse)]:-mr-1.5', TOUCH.tap36)}
            onClick={() => { const n = !mark; setOwnMark(n); onBookmarkChange?.(n); setPops(p => p + 1) }}
            icon={<motion.span key={pops} className="grid" initial={pops ? { scale: 0.7 } : false} animate={{ scale: [0.7, 1.15, 1] }} transition={spring(0.5, 0.4)}><Icon name="bookmark" size={15} filled={mark} /></motion.span>} />
        </div>
      </div>
    </motion.article>
  )
}

/* ── Image with states ─────────────────────────────────────────────────────── */

/**
 * Image that blurs up: a tiny placeholder shows blurred, then the full image crossfades in.
 * If loading fails, a fallback with Retry appears (`onRetry` lets you swap the src first).
 */
export function ProgressiveImage({ src, placeholder, alt, aspect = '4/3', delay = 0, onRetry, className }:
  { src: string; placeholder?: string; alt: string; aspect?: string; delay?: number; onRetry?: () => void; className?: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    setState('loading'); let live = true
    const t = setTimeout(() => { const im = new Image(); im.onload = () => live && setState('loaded'); im.onerror = () => live && setState('error'); im.src = src }, delay)
    return () => { live = false; clearTimeout(t) }
  }, [src, attempt, delay])
  return (
    <div className={cn('relative overflow-hidden rounded-[var(--r-lg)] bg-[var(--muted)]', className)} style={{ aspectRatio: aspect }} aria-busy={state === 'loading'}>
      {state !== 'error' && placeholder && <img src={placeholder} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover blur-[14px]" />}
      {state === 'loaded' && <motion.img key={`${src}-${attempt}`} src={src} alt={alt} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} className="absolute inset-0 h-full w-full object-cover" />}
      <AnimatePresence>
        {state === 'error' && (
          <motion.div role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-[var(--fg3)]">
            <Icon name="imageOff" size={26} strokeWidth={1.6} />Image couldn’t load
            <Button size="sm" onClick={() => { onRetry?.(); setAttempt(a => a + 1) }}>Retry</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Avatar upload ─────────────────────────────────────────────────────────── */

const CROP_BOX = 160, CROP_CIRCLE = 140
/**
 * Avatar cropper: the photo sits under a circular mask; drag (or arrow keys) to reposition, clamped so the
 * circle stays covered; zoom with the slider, the wheel, a two-finger pinch or + / −. "Choose photo" loads a local file and
 * 48 / 32 / 22 px previews update live. `onChange` receives the 256 px circle crop as a PNG data URL once the crop
 * settles (not on every pointer move).
 */
export function AvatarCropper({ src: initial, defaultZoom = 1.2, onChange, className }: { src: string; defaultZoom?: number; onChange?: (dataUrl: string) => void; className?: string }) {
  const [src, setSrc] = useState(initial)
  const [z, setZ] = useState(defaultZoom)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [loads, setLoads] = useState(0)
  const box = useRef<HTMLDivElement>(null), img = useRef<HTMLImageElement>(null), outs = useRef<(HTMLCanvasElement | null)[]>([])
  const from = useRef({ x: 0, y: 0 }), emit = useRef(onChange); emit.current = onChange
  useEffect(() => setSrc(initial), [initial])
  const base = nat ? CROP_BOX / Math.min(nat.w, nat.h) : 1
  const w = nat ? nat.w * base * z : CROP_BOX, h = nat ? nat.h * base * z : CROP_BOX
  const clampOff = (o: { x: number; y: number }, ww = w, hh = h) => { const mx = Math.max(0, (ww - CROP_CIRCLE) / 2), my = Math.max(0, (hh - CROP_CIRCLE) / 2); return { x: clamp(o.x, -mx, mx), y: clamp(o.y, -my, my) } }
  const o = clampOff(off)
  const zoomTo = (nz: number) => setZ(clamp(nz, 1, 3))
  useEffect(() => {
    const im = img.current; if (!im || !nat) return
    const draw = (c: HTMLCanvasElement | null, size: number) => { if (!c) return; const g = c.getContext('2d')!; g.clearRect(0, 0, size, size); const s = size / CROP_CIRCLE; g.drawImage(im, size / 2 - w * s / 2 + o.x * s, size / 2 - h * s / 2 + o.y * s, w * s, h * s) }
    outs.current.forEach(c => draw(c, 96)) // the small previews follow every move (cheap)
    if (!emit.current) return
    // the PNG export is expensive: only once the crop has stopped changing for a moment
    const t = setTimeout(() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!; g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.clip(); draw(c, 256); emit.current?.(c.toDataURL('image/png')) }, 250)
    return () => clearTimeout(t)
  }, [nat, w, h, o.x, o.y, src])
  const gesture = usePinchPan({ getZoom: () => z, onZoom: setZ, min: 1, max: 3, wheel: box, wheelStep: 0.06,
    onPanStart: () => { from.current = o }, onPan: ({ dx, dy }) => setOff(clampOff({ x: from.current.x + dx, y: from.current.y + dy })) })
  return (
    <div className={cn('flex flex-wrap items-center gap-4', className)}>
      <motion.div ref={box} key={loads} initial={loads ? { scale: 0.96 } : false} animate={{ scale: 1 }} transition={spring(0.4, 0.35)}
        tabIndex={0} role="group" aria-label="Crop area. Drag or use arrow keys to reposition, + and − to zoom"
        className="relative flex-none cursor-grab touch-none overflow-hidden rounded-[var(--r-lg)] bg-[var(--muted)] outline-none select-none focus-visible:shadow-[0_0_0_2px_var(--accent)] active:cursor-grabbing"
        style={{ width: CROP_BOX, height: CROP_BOX }} {...gesture.bind}
        onKeyDown={e => {
          const step = e.shiftKey ? 20 : 6, mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
          if (mv[e.key]) { e.preventDefault(); setOff(clampOff({ x: o.x + mv[e.key][0], y: o.y + mv[e.key][1] })) }
          if (e.key === '+' || e.key === '=') zoomTo(z + 0.1)
          if (e.key === '-') zoomTo(z - 0.1)
        }}>
        <img ref={img} src={src} alt="Crop preview" draggable={false} onLoad={e => { setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); setOff({ x: 0, y: 0 }) }}
          className="pointer-events-none absolute top-1/2 left-1/2 max-w-none select-none" style={{ width: w, transform: `translate(calc(-50% + ${o.x}px), calc(-50% + ${o.y}px))` }} />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_69px,rgba(0,0,0,.5)_70px)]" />
        <div className="pointer-events-none absolute inset-2.5 rounded-full shadow-[0_0_0_1.5px_rgba(255,255,255,.85)]" />
      </motion.div>
      <div className="min-w-[180px] flex-1">
        <div className="mb-3 flex items-center gap-3">
          {[48, 32, 22].map((s, i) => <canvas key={s} ref={el => { outs.current[i] = el }} width={96} height={96} aria-label={`${s} px preview`} role="img" className="flex-none rounded-full bg-[var(--muted)]" style={{ width: s, height: s }} />)}
        </div>
        <Slider label="Zoom" min={1} max={3} step={0.01} value={z} onChange={zoomTo} format={v => `${v.toFixed(1)}×`} />
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <label className={cn(surface.md, 'inline-flex h-[30px] cursor-pointer items-center px-3 text-xs font-medium hover:bg-[var(--muted)] focus-within:shadow-[0_0_0_2px_var(--accent)] [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:px-4')}>
            Choose photo
            <input type="file" accept="image/*" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { setSrc(String(r.result)); setZ(defaultZoom); setLoads(n => n + 1) }; r.readAsDataURL(f); e.target.value = '' }} />
          </label>
          <span className="text-[11px] text-[var(--fg3)]"><span className="[@media(pointer:coarse)]:hidden">Drag the image to reposition</span><span className="hidden [@media(pointer:coarse)]:inline">Drag to move, pinch to zoom</span></span>
        </div>
      </div>
    </div>
  )
}

/* ── Carousel ──────────────────────────────────────────────────────────────── */

/**
 * Scroll-snap carousel with arrows, dots, swipe and ← / → (all wrap around). Each slide's caption fades up
 * as it becomes the current slide. Slides can be any content.
 */
export function Carousel({ slides, aspect = '16/8', className }: { slides: { content: ReactNode; title?: ReactNode; caption?: ReactNode }[]; aspect?: string; className?: string }) {
  const track = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const [i, setI] = useState(0)
  const n = slides.length
  const go = (k: number) => { const t = track.current, el = t?.children[((k % n) + n) % n] as HTMLElement | undefined; if (t && el) t.scrollTo({ left: el.offsetLeft, behavior: reduce ? 'auto' : 'smooth' }) }
  const arrow = 'absolute top-1/2 grid h-9 w-9 -translate-y-1/2 max-sm:h-8 max-sm:w-8 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9 cursor-pointer place-items-center rounded-full border-0 bg-white/90 text-[#111] shadow-[0_2px_8px_rgba(0,0,0,.2)] hover:bg-white focus-visible:outline-2 focus-visible:outline-[var(--accent)]'
  return (
    <div className={cn('flex w-full min-w-0 max-w-full flex-col gap-2.5', className)} role="region" aria-roledescription="carousel" aria-label="Carousel"
      onKeyDown={e => { if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1) } if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1) } }}>
      {/* contain: inline-size keeps the slides (and their images' natural width) out of the card's min-content width,
          so the carousel can never stretch its card or the page sideways */}
      <div className="relative min-w-0 overflow-hidden rounded-[var(--r-lg)]">
        <div ref={track} tabIndex={0} aria-live="polite"
          onScroll={e => { const t = e.currentTarget, first = t.children[0] as HTMLElement | undefined; if (first) setI(clamp(Math.round(t.scrollLeft / (first.offsetWidth + 12)), 0, n - 1)) }}
          className="flex w-full min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain rounded-[var(--r-lg)] outline-none [contain:inline-size] [scrollbar-width:none] focus-visible:shadow-[0_0_0_2px_var(--accent)] [&::-webkit-scrollbar]:hidden">
          {slides.map((s, k) => (
            <div key={k} role="group" aria-roledescription="slide" aria-label={`${k + 1} of ${n}`} className="relative min-w-0 flex-[0_0_100%] snap-center overflow-hidden rounded-[var(--r-lg)]" style={{ aspectRatio: aspect }}>
              {s.content}
              {(s.title || s.caption) && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={k === i ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }} transition={{ duration: 0.4 }}
                  className="absolute inset-x-0 bottom-0 bg-gradient-to-b from-transparent to-black/60 px-4 pt-10 pb-4 text-white max-sm:px-3 max-sm:pt-8 max-sm:pb-2.5">
                  <b className="block text-[17px] font-semibold max-sm:text-[15px]">{s.title}</b><span className="text-xs opacity-80">{s.caption}</span>
                </motion.div>
              )}
            </div>
          ))}
        </div>
        <button type="button" className={cn(arrow, 'left-2.5')} aria-label="Previous slide" onClick={() => go(i - 1)}><Icon name="chevronLeft" /></button>
        <button type="button" className={cn(arrow, 'right-2.5')} aria-label="Next slide" onClick={() => go(i + 1)}><Icon name="chevronRight" /></button>
      </div>
      {/* each dot is a 24px (32px on touch) button around the small visible pill */}
      <div className="-mt-1.5 flex justify-center">
        {slides.map((_, k) => (
          <button key={k} type="button" aria-label={`Go to slide ${k + 1}`} aria-current={k === i} onClick={() => go(k)}
            className="group/dot grid h-6 min-w-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent px-[3px] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)] [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:min-w-8">
            <motion.span initial={false} animate={{ width: k === i ? 22 : 7 }} transition={spring(0.2, 0.35)}
              className={cn('block h-[7px] rounded transition-colors', k === i ? 'bg-[var(--primary)]' : 'bg-[var(--line2)] group-hover/dot:bg-[var(--fg3)]')} />
          </button>
        ))}
      </div>
    </div>
  )
}

/* ── Before / after ────────────────────────────────────────────────────────── */

/**
 * Before / after comparison: drag anywhere (or arrow keys / Home / End on the handle). Wiggles once when scrolled into
 * view to show it moves. On touch, a sideways drag (or any drag on the handle) moves the divider and a tap jumps it,
 * while a vertical swipe over the image still scrolls the page.
 */
export function ImageCompare({ before, after, aspect = '4/3', className }: { before: ReactNode; after: ReactNode; aspect?: string; className?: string }) {
  const [pos, setPos] = useState(50)
  const box = useRef<HTMLDivElement>(null)
  const dragging = useRef(false), touched = useRef(false), start = useRef<{ x: number; y: number } | null>(null)
  const inView = useInView(box, { once: true, amount: 0.5 })
  const reduce = useReducedMotion()
  const set = (clientX: number) => { const r = box.current!.getBoundingClientRect(); setPos(clamp(((clientX - r.left) / r.width) * 100, 0, 100)) }
  useEffect(() => { // one damped wiggle to show it moves; any touch stops it
    if (!inView || reduce) return
    const run = animate(0, 1, { duration: 1.4, ease: 'linear', onUpdate: k => { if (touched.current) run.stop(); else setPos(50 + Math.sin(k * Math.PI * 2) * 22 * (1 - k)) } })
    return () => run.stop()
  }, [inView, reduce])
  return (
    <div ref={box} className={cn('relative cursor-ew-resize touch-pan-y overflow-hidden rounded-[var(--r-lg)] bg-[var(--muted)] select-none', className)} style={{ aspectRatio: aspect }}
      onPointerDown={e => {
        touched.current = true
        const onHandle = !!(e.target as Element).closest('[role=slider]')
        if (e.pointerType === 'mouse' || onHandle) { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); set(e.clientX) }
        else start.current = { x: e.clientX, y: e.clientY } // touch on the image: wait to see if it's a sideways drag or a scroll
      }}
      onPointerMove={e => {
        if (dragging.current) { set(e.clientX); return }
        const s0 = start.current; if (!s0) return
        const dx = Math.abs(e.clientX - s0.x), dy = Math.abs(e.clientY - s0.y)
        if (dx > 6 && dx > dy) { dragging.current = true; start.current = null; try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* gone */ } set(e.clientX) }
      }}
      onPointerUp={e => { if (start.current) set(e.clientX); start.current = null; dragging.current = false }} onPointerCancel={() => { start.current = null; dragging.current = false }}>
      <div className="absolute inset-0">{after}</div>
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>{before}</div>
      <span className="pointer-events-none absolute top-2.5 left-2.5 rounded-full bg-black/45 px-2 py-1 text-[11px] font-semibold text-white">Before</span>
      <span className="pointer-events-none absolute top-2.5 right-2.5 rounded-full bg-black/45 px-2 py-1 text-[11px] font-semibold text-white">After</span>
      <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_8px_rgba(0,0,0,.4)]" style={{ left: `${pos}%` }}>
        <button type="button" role="slider" aria-label="Comparison position" aria-valuenow={Math.round(pos)} aria-valuemin={0} aria-valuemax={100}
          onKeyDown={e => {
            const k: Record<string, (p: number) => number> = { ArrowLeft: p => p - 5, ArrowRight: p => p + 5, Home: () => 0, End: () => 100 }
            if (k[e.key]) { e.preventDefault(); touched.current = true; setPos(p => clamp(k[e.key](p), 0, 100)) }
          }}
          className="absolute top-1/2 left-1/2 flex h-[34px] w-[34px] -translate-1/2 cursor-ew-resize touch-none items-center justify-center rounded-full border-0 bg-white text-[#111] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 shadow-[0_2px_8px_rgba(0,0,0,.3)] focus-visible:shadow-[0_0_0_3px_var(--accent)] focus-visible:outline-none">
          <Icon name="chevronsLeftRight" size={14} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}
