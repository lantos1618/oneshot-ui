import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, animate, motion, useMotionValue } from './motionkit'
import { Avatar, Badge, Button, Chip, EASE_OUT, EASE_OUT_CSS, Icon, IconButton, TOUCH, capturePointer, clamp, cn, cssUrl, safeMediaUrl, Spinner, spring, surface, useControllable, useElementSize, useGeneration, useFocusTrap, useWidth, uiShared, plural, fmt, useInView, useReducedMotion } from './core'
import { Slider } from './inputs'
import { useToast } from './feedback'
import { OverlayPortal, useScrollLock } from './overlay'
import { useFrameLoop, usePinchPan, useViewport } from './motion'
import { MagnetMarks, magnetKeyDirection, useMagnet } from './magnet'

export type AudioTrackState = { playing: boolean; time: number; duration: number; rate: number }
/** How a play attempt went: the browser's own error when it refused (NotAllowedError, NotSupportedError…). */
export type MediaPlayResult = { ok: true } | { ok: false; error: unknown }
export type AudioTrackHandle = {
  /** The audio element, created on first use (null on the server, where there is no Audio) */ readonly el: HTMLAudioElement | null
  subscribe: (f: () => void) => () => void; get: () => AudioTrackState
  /** Creates the audio element so its metadata (duration) loads; players call it when they come on screen. */
  load: () => void
  /** Re-reads the element's time (players call it every frame while playing on screen; the 4 Hz timeupdate covers the rest). */
  sync: () => void
  /** Stops playback and drops the element and its source (a later play creates a new one). */
  release: () => void
  play: () => Promise<MediaPlayResult>; pause: () => void; toggle: () => Promise<MediaPlayResult>; seek: (t: number) => void; skip: (d: number) => void; setRate: (r: number) => void
}
const mediaLive = uiShared('media-live', () => new Set<HTMLAudioElement>()) // page-wide: one player at a time across drop-in files
/**
 * A shared audio source that several players can render (e.g. the full player and the slim one stay in sync).
 * Only one track plays at a time: starting one pauses the others. Safe to call during render and on the server: the
 * audio element is only created when a player comes on screen or something is played (an inert handle where `Audio` doesn't exist).
 */
export function createAudioTrack(src: string, fallbackDuration = 0): AudioTrackHandle {
  let state: AudioTrackState = { playing: false, time: 0, duration: fallbackDuration, rate: 1 }
  const subs = new Set<() => void>()
  let el: HTMLAudioElement | null = null
  const set = (n: AudioTrackState) => {
    if (n.playing === state.playing && n.time === state.time && n.duration === state.duration && n.rate === state.rate) return
    state = n; subs.forEach(f => f())
  }
  const emit = () => { if (el) set({ playing: !el.paused, time: el.currentTime, duration: Number.isFinite(el.duration) && el.duration ? el.duration : fallbackDuration, rate: el.playbackRate }) }
  const audio = () => {
    if (el || typeof Audio === 'undefined') return el
    const a = el = new Audio(); a.preload = 'metadata'; a.src = safeMediaUrl(src, 'audio'); a.playbackRate = state.rate
    a.addEventListener('play', () => { mediaLive.forEach(o => { if (o !== a) o.pause() }); mediaLive.add(a); emit() })
    a.addEventListener('pause', () => { mediaLive.delete(a); emit() })
    a.addEventListener('ended', () => { a.currentTime = 0; emit() })
    for (const ev of ['loadedmetadata', 'timeupdate', 'ratechange', 'seeked']) a.addEventListener(ev, emit)
    return a
  }
  const dur = () => state.duration || fallbackDuration
  const play = (): Promise<MediaPlayResult> => {
    const a = audio()
    if (!a) return Promise.resolve({ ok: false, error: new Error('Audio isn’t available here') })
    return Promise.resolve().then(() => a.play()).then(() => ({ ok: true }) as const, error => ({ ok: false, error }))
  }
  return {
    get el() { return audio() },
    get: () => state, subscribe: f => { subs.add(f); return () => { subs.delete(f) } },
    load: () => { audio() }, sync: emit,
    release: () => {
      const a = el; if (!a) return
      el = null; mediaLive.delete(a); a.pause(); a.removeAttribute('src')
      set({ ...state, playing: false, time: 0 })
    },
    play, pause: () => el?.pause(), toggle: () => !el || el.paused ? play() : (el.pause(), Promise.resolve({ ok: true } as const)),
    seek: t => { const a = audio(); if (a) { a.currentTime = clamp(t, 0, dur()); emit() } },
    skip: d => { const a = audio(); if (a) { a.currentTime = clamp(a.currentTime + d, 0, dur()); emit() } },
    setRate: r => { const a = audio(); if (a) { a.playbackRate = r; emit() } },
  }
}
/** Subscribe to a track's state (playing, time, duration, rate). Server-safe. */
export function useAudioTrack(track: AudioTrackHandle) { return useSyncExternalStore(track.subscribe, track.get, track.get) }
/** Why a play attempt failed, in words (the browser's error is kept for `onError`-style callers). */
function mediaPlayError(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : ''
  if (name === 'NotAllowedError') return 'Your browser blocked playback. Press play again.'
  if (name === 'NotSupportedError') return 'This format isn’t supported, or the file couldn’t be loaded.'
  if (name === 'AbortError') return 'Playback was interrupted.'
  return err instanceof Error && err.message ? err.message : 'It couldn’t be played.'
}
/** A toggle that reports a refused play() as a toast, unless a later toggle superseded it (pausing aborts a pending play()). */
function usePlayToggle(toggle: () => Promise<MediaPlayResult>, what: 'audio' | 'video') {
  const toast = useToast(), gen = useGeneration()
  return () => {
    const current = gen.next()
    void toggle().then(r => { if (!r.ok && current()) toast({ title: `Couldn’t play ${what}`, description: mediaPlayError(r.error), tone: 'bad' }) })
  }
}
/** The next item of a list after `cur` (wrapping; the first when `cur` isn't in it). */
const cycleNext = <T,>(list: readonly T[], cur: T) => list[(list.indexOf(cur) + 1) % list.length]
/**
 * A player's track: `shared`, or one of its own for `src` (a new one when `src` or `duration` changes; the old one is
 * released). Loads when on screen and re-reads the time every frame while playing there.
 */
function usePlayerTrack(shared: AudioTrackHandle | undefined, src: string | undefined, duration: number, box: RefObject<Element | null>) {
  const track = useMemo(() => shared ?? createAudioTrack(src ?? '', duration), [shared, src, duration])
  useEffect(() => { if (track !== shared) return () => track.release() }, [track, shared])
  const s = useAudioTrack(track)
  const onScreen = useInView(box)
  useEffect(() => { if (onScreen) track.load() }, [onScreen, track])
  useFrameLoop(s.playing && onScreen, track.sync)
  return { track, s, toggle: usePlayToggle(track.toggle, 'audio') }
}

/**
 * "A sideways drag scrubs, a vertical swipe scrolls" for touch and pen: `wait` a press, and `sideways(e)` turns true
 * once it has moved more than `slop` px mostly sideways (begin scrubbing then); `tap()` is true when the press ended
 * without becoming a scrub.
 */
function useScrubIntent(slop = 6) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return {
    wait: (e: RPointerEvent) => { start.current = { x: e.clientX, y: e.clientY } },
    sideways: (e: RPointerEvent) => {
      const s = start.current; if (!s) return false
      const dx = Math.abs(e.clientX - s.x), dy = Math.abs(e.clientY - s.y)
      if (!(dx > slop && dx > dy)) return false
      start.current = null; return true
    },
    tap: () => { const was = start.current !== null; start.current = null; return was },
    cancel: () => { start.current = null },
  }
}

/** A chapter of a video or audio track: where it starts (seconds) and its title. */
export type MediaChapter = { start: number; title: string }
/** The chapter playing at `t` (the last one that has started), or undefined. */
export const mediaChapterAt = (chapters: readonly MediaChapter[] | undefined, t: number) => chapters?.reduce<MediaChapter | undefined>((cur, c) => c.start <= t + 1e-6 && (!cur || c.start >= cur.start) ? c : cur, undefined)

/**
 * A seek bar for media players: returns `bind` (role=slider props: value, ARIA text, pointer and keyboard handlers) to
 * spread on the bar, plus `drag` (scrubbing) and `hover` (0..1 under the mouse, or under the finger while scrubbing).
 * Mouse seeks on press and while dragging; touch and pen use `touch-action: pan-y` (give the bar `touch-pan-y`), so a
 * vertical swipe still scrolls the page, a sideways drag scrubs and a tap seeks to where it landed. Keys: ← / → move
 * `step` seconds, Home / End jump, Space calls `onToggle`. The pointer is captured, so drags keep working outside the bar.
 * `chapters`: their starts become magnets while scrubbing (useMagnet: the thumb sticks to a chapter start for a few px,
 * Alt drags freely), PageUp / PageDown and Ctrl/⌘ + ← / → jump between them, the ARIA text names the chapter, and
 * `chapter` is the one under the hover point or playing now.
 */
export function useSeekSlider({ time, duration, onSeek, step = 2, onToggle, label, valueText, focusable = true, chapters }:
  { time: number; duration: number; onSeek: (t: number) => void; step?: number; onToggle?: () => void; label?: string; valueText?: (t: number, d: number) => string; focusable?: boolean
    chapters?: readonly MediaChapter[] }) {
  const [drag, setDrag] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const text = valueText ?? ((t: number, dd: number) => `${fmt.clock(t)} of ${fmt.clock(dd)}`)
  const intent = useScrubIntent()
  const d = duration || 1
  const marks = useMemo(() => chapters?.length ? chapters.map(c => ({ value: c.start, label: c.title })) : null, [chapters])
  const mg = useMagnet({ magnets: marks, min: 0, max: d, describe: fmt.clock })
  const frac = (e: RPointerEvent) => { const r = e.currentTarget.getBoundingClientRect(); return clamp((e.clientX - r.left) / (r.width || 1), 0, 1) }
  // with chapters the raw position goes through the magnets (the hover preview shows where it actually lands)
  const seekAt = (e: RPointerEvent) => {
    const f = frac(e)
    if (!mg.enabled) { onSeek(f * d); return f }
    const at = mg.apply(f * d, { px: e.currentTarget.getBoundingClientRect().width, event: e.nativeEvent }).value
    onSeek(at); return at / d
  }
  const begin = (e: RPointerEvent) => { capturePointer(e.currentTarget, e.pointerId); setDrag(true); mg.reset(); seekAt(e) }
  const end = () => { setDrag(false); mg.reset() }
  const chapterNow = mediaChapterAt(chapters, time)
  const bind = {
    role: 'slider', tabIndex: focusable ? 0 : -1, 'aria-label': label ?? 'Seek', 'aria-valuemin': 0, 'aria-valuemax': Math.round(d), 'aria-valuenow': Math.round(time),
    'aria-valuetext': chapterNow ? `${text(time, d)}, ${chapterNow.title}` : text(time, d), 'aria-keyshortcuts': mg.enabled ? 'PageUp PageDown' : undefined,
    onPointerDown: (e: RPointerEvent) => { if (e.pointerType === 'mouse') begin(e); else intent.wait(e) },
    onPointerMove: (e: RPointerEvent) => {
      if (drag) { setHover(seekAt(e)); return }
      if (e.pointerType === 'mouse') setHover(frac(e))
      if (intent.sideways(e)) begin(e)
    },
    onPointerUp: (e: RPointerEvent) => { if (intent.tap()) { mg.reset(); seekAt(e) } end(); if (e.pointerType !== 'mouse') setHover(null) },
    onPointerCancel: () => { intent.cancel(); end(); setHover(null) },
    onPointerLeave: (e: RPointerEvent) => { if (e.pointerType === 'mouse' && !drag) setHover(null) },
    onKeyDown: (e: RKeyboardEvent) => {
      const jump = mg.enabled ? magnetKeyDirection(e) : 0
      if (jump) {
        // back from inside a chapter goes to its start first (like a CD player); from (near) its start, to the previous one
        const to = jump > 0 ? mg.next(time, 1) : mg.next(time - 0.75, -1) ?? 0
        e.preventDefault(); if (to !== null) onSeek(clamp(to, 0, d)); return
      }

      const to = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? time + step : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? time - step : e.key === 'Home' ? 0 : e.key === 'End' ? d - 0.1 : null
      if (to !== null) { e.preventDefault(); onSeek(clamp(to, 0, d)) }
      else if (e.key === ' ' && onToggle) { e.preventDefault(); onToggle() }
    },
  } as const
  return {
    bind, drag, hover,
    /** the chapter under the hover point (or playing now) */ chapter: mediaChapterAt(chapters, hover != null ? hover * d : time),
    /** chapter ticks for the bar: <MagnetMarks {...seek.marks} /> */ marks: { magnets: marks, min: 0, max: d },
    /** the polite "Snapped to {chapter}" region: render it next to the bar */ live: mg.live,
  }
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
          <motion.i key={i} className={cn('rounded-[var(--r-sm)] transition-colors', barWidth ? 'flex-none rounded-full' : 'min-w-px flex-1', i < on ? cPlayed : i < hov ? cHover : cRest)}
            style={{ width: barWidth, height: live ? undefined : `${h}%` }}
            initial={intro ? { scaleY: 0.1 } : false}
            animate={live ? { height: [`${minHeight}%`, `${h}%`, `${minHeight}%`] } : intro ? { scaleY: seen ? 1 : 0.1 } : { height: `${h}%` }}
            transition={live ? { duration: 0.5 + (i % 5) * 0.12, repeat: Infinity, ease: 'easeInOut' } : intro ? { duration: 0.4, delay: i * (4.8 / Math.max(48, n * 8)), ease: EASE_OUT } : { duration: 0.2 }} />
        )
      })}
    </div>
  )
}

const VIDEO_SPEEDS = [1, 1.5, 2, 0.5]
/** Control-bar icon buttons on the video: light on dark whatever the theme, 34px (40px on touch). */
const VIDEO_BTN = '!h-[34px] !w-[34px] [@media(pointer:coarse)]:!h-10 [@media(pointer:coarse)]:!w-10'

/**
 * Video player with custom controls: big play button, title that fades while playing, seek bar with buffer,
 * hover time and drag, back 5 s, mute + volume, time, speed cycle and fullscreen. Controls hide when idle.
 * Keys (when the player itself is focused): Space / K play, ← / → seek 2 s, M mute, F fullscreen. Its controls keep their
 * own keys (the seek bar: ← / → and Home / End), so nothing fires twice.
 * Touch: tap shows or hides the controls (tap while paused plays), double-tap the left or right half to seek ∓5 s,
 * and the seek bar and buttons grow to finger size. Clicking the picture toggles playback.
 * While `preparing` (no `src` yet) the poster shows with Play enabled: pressing it shows "Starting…" and playback
 * begins as soon as the source arrives (press again to cancel). With no `src` and not preparing it says `emptyLabel`.
 */
export function VideoPlayer({ src, poster, title, meta, duration: fallback = 0, preparing, chapters, emptyLabel = 'No video', className }:
  { src?: string | null; poster?: string; title?: ReactNode; meta?: ReactNode; duration?: number; preparing?: boolean; emptyLabel?: string
    /** chapter starts: gaps in the seek bar, magnets while scrubbing, titles in the hover time and PageUp / PageDown to jump */ chapters?: readonly MediaChapter[]; className?: string }) {
  const box = useRef<HTMLDivElement>(null), vid = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0), [dur, setDur] = useState(fallback), [buf, setBuf] = useState(0)
  const [muted, setMuted] = useState(false), [vol, setVol] = useState(0.8), [rate, setRate] = useState(1)
  const [idle, setIdle] = useState(false), [isFs, setFs] = useState(false)
  const idleT = useRef<ReturnType<typeof setTimeout>>(undefined)
  const fixing = useRef(false), wantPlay = useRef(false)
  const [pending, setPending] = useState(false) // Play pressed before the source was ready
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
  const want = (on: boolean) => { wantPlay.current = on; setPending(on) }
  const playVideo = usePlayToggle(() => {
    const v = vid.current
    if (!v) return Promise.resolve({ ok: true } as const)
    if (!v.paused) { v.pause(); return Promise.resolve({ ok: true } as const) }
    return Promise.resolve().then(() => v.play()).then(() => ({ ok: true }) as const, error => ({ ok: false, error }))
  }, 'video')
  const toggle = () => {
    if (!vid.current) return
    if (!src || fixing.current) { if (src || preparing) want(!wantPlay.current); return } // queue it until the source is ready
    want(false); playVideo()
  }
  const seek = useSeekSlider({ time: t, duration: d, onSeek: s => { seekTo(s); wake() }, onToggle: toggle, chapters })
  useEffect(() => () => { clearTimeout(idleT.current); clearTimeout(tapT.current) }, [])
  useEffect(() => { if (vid.current) vid.current.volume = 0.8 }, [])
  const { visible: onScreen } = useViewport(box, { amount: 0 })
  useFrameLoop(playing && onScreen, sync) // smooth progress while playing on screen
  useEffect(() => { const on = () => setFs(document.fullscreenElement === box.current); document.addEventListener('fullscreenchange', on); return () => document.removeEventListener('fullscreenchange', on) }, [])
  const seekBy = (s: number) => { const v = vid.current; if (v) seekTo(v.currentTime + s) }
  const toggleMute = () => { const v = vid.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted) }
  const setVolume = (n: number) => { const v = vid.current; setVol(n); if (v) { v.volume = n; v.muted = n === 0; setMuted(n === 0) } }
  const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else box.current?.requestFullscreen?.().catch(() => {}) }
  const cycleSpeed = () => { const n = cycleNext(VIDEO_SPEEDS, rate); setRate(n); if (vid.current) vid.current.playbackRate = n }
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
      <video ref={vid} src={safeMediaUrl(src, 'video') || undefined} poster={safeMediaUrl(poster) || undefined} playsInline preload="metadata" className="block h-full w-full object-cover"
        onPointerUp={onTouchTap} onClick={() => { if (!fromTouch()) toggle() }} onDoubleClick={() => { if (!fromTouch()) fullscreen() }}
        onPlay={() => { setPlaying(true); wake() }} onPause={() => { setPlaying(false); setIdle(false); sync() }} onEnded={e => { e.currentTarget.currentTime = 0 }}
        onTimeUpdate={sync} onProgress={sync} onDurationChange={sync}
        onLoadedMetadata={e => {
          const v = e.currentTarget; sync()
          // a recorded WebM reports Infinity until it has been seeked to the end once
          if (v.duration === Infinity) {
            fixing.current = true; v.currentTime = 1e6
            const back = () => { v.removeEventListener('timeupdate', back); v.currentTime = 0; fixing.current = false; sync(); if (wantPlay.current) toggle() }
            v.addEventListener('timeupdate', back)
          } else if (wantPlay.current) toggle()
        }} />
      <AnimatePresence>
        {seekFx && (
          <motion.span key={seekFx.n} aria-hidden initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: [0, 1, 1, 0], scale: 1 }} transition={{ duration: 0.7, times: [0, 0.15, 0.6, 1] }}
            onAnimationComplete={() => setSeekFx(f => f?.n === seekFx.n ? null : f)}
            className={cn('pointer-events-none absolute top-1/2 z-[3] -mt-7 grid h-14 w-14 place-items-center rounded-full bg-black/45 text-[11px] font-semibold text-white', seekFx.side < 0 ? 'left-[18%]' : 'right-[18%]')}>
            <span className="flex flex-col items-center leading-tight">{icon(seekFx.side < 0 ? 'replay' : 'forward', 18)}{fmt.number(seekFx.side * 5, { style: 'unit', unit: 'second', unitDisplay: 'narrow', signDisplay: 'always' })}</span>
          </motion.span>
        )}
      </AnimatePresence>
      {!src && !preparing && <Badge className="absolute top-3 end-3 z-[3] !bg-black/45 !text-white">{emptyLabel}</Badge>}
      <span className="sr-only" aria-live="polite">{pending ? 'Starting…' : ''}</span>
      <AnimatePresence>
        {!playing && (
          <motion.button key="big" type="button" aria-label={pending ? 'Starting… press to cancel' : 'Play'} aria-busy={pending || undefined} onClick={toggle} disabled={!src && !preparing}
            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1, transition: spring(0.4, 0.35) }} exit={{ opacity: 0, scale: 1.3, transition: { duration: 0.25 } }}
            className={cn('absolute top-1/2 start-1/2 -mt-8 -ms-8 grid h-16 w-16 cursor-pointer place-items-center rounded-full border-0 bg-white/20 text-white backdrop-blur-md hover:bg-white/30 disabled:cursor-default disabled:opacity-50', !pending && 'ps-1')}>
            {pending ? <Spinner size={24} label={'Starting'} className="!border-[3px]" /> : icon('play', 26, true)}
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
        <div {...seek.bind} className="group relative flex h-4 cursor-pointer touch-pan-y items-center rounded-[var(--r-sm)] outline-none focus-visible:shadow-[0_0_0_2px_#fff] [@media(pointer:coarse)]:h-8">
          <span className="absolute inset-x-0 h-1 rounded-[var(--r-sm)] bg-white/25 transition-[height] group-hover:h-1.5" />
          <span className="absolute start-0 h-1 rounded-[var(--r-sm)] bg-white/35 transition-[height] group-hover:h-1.5" style={{ width: `${Math.min(100, buf / d * 100)}%` }} />
          <span className="absolute start-0 h-1 rounded-[var(--r-sm)] bg-white transition-[height] group-hover:h-1.5" style={{ width: `${t / d * 100}%` }} />
          {chapters && <span className="absolute inset-x-0 h-1 transition-[height] group-hover:h-1.5"><MagnetMarks {...seek.marks} tone="onDark" /></span>}
          <span className={cn('absolute -ms-1.5 h-[13px] w-[13px] rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,.4)] transition-transform group-hover:scale-100 group-focus-visible:scale-100 [@media(pointer:coarse)]:scale-100', seek.drag ? 'scale-100 [@media(pointer:coarse)]:scale-125' : 'scale-0')} style={{ left: `${t / d * 100}%` }} />
          {seek.hover != null && <span className="pointer-events-none absolute bottom-5 -translate-x-1/2 rounded-[var(--r-sm)] bg-black/75 px-1.5 py-1 font-[family-name:var(--mono)] text-[11px] font-medium" style={{ left: `${seek.hover * 100}%` }}>{fmt.clock(seek.hover * d)}{seek.chapter && <span className="ms-1.5 font-[family-name:var(--font)] font-normal opacity-85"><bdi>{seek.chapter.title}</bdi></span>}</span>}
        </div>
        {seek.live}
        <div className="mt-0.5 flex items-center gap-0.5">
          <div className="flex items-center gap-0.5">
          <IconButton tone="onDark" size="icon" className={VIDEO_BTN} label={playing ? 'Pause' : 'Play'} onClick={toggle} icon={icon(playing ? 'pause' : 'play', 18, true)} />
          <IconButton tone="onDark" size="icon" className={VIDEO_BTN} label={'Back 5 seconds'} onClick={() => seekBy(-5)} icon={icon('replay')} />
          </div>
          <div className="group/vol flex items-center">{/* phones use the hardware volume: only the mute button shows on touch */}
            <IconButton tone="onDark" size="icon" className={VIDEO_BTN} label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute} icon={icon(muted || vol === 0 ? 'volumeX' : 'volume')} />
            {/* the shared Slider, re-tinted light for the video (its track and thumb follow --primary / --muted) */}
            <label className="flex w-0 items-center overflow-hidden opacity-0 transition-[width,opacity,margin] duration-200 [--muted:rgba(255,255,255,.3)] [--primary:#fff] [@media(pointer:coarse)]:hidden group-hover/vol:me-1.5 group-hover/vol:w-[70px] group-hover/vol:opacity-100 group-focus-within/vol:me-1.5 group-focus-within/vol:w-[70px] group-focus-within/vol:opacity-100">
              <span className="sr-only">{'Volume'}</span><Slider min={0} max={1} step={0.01} value={muted ? 0 : vol} onChange={setVolume} className="w-full" />
            </label>
          </div>
          <span className="ms-1.5 font-[family-name:var(--mono)] text-xs font-medium whitespace-nowrap opacity-90 max-sm:ms-0.5"><bdi>{fmt.clock(t)} / {fmt.clock(d)}</bdi></span>
          <span className="flex-1" />
          <IconButton tone="onDark" size="icon" className="!h-[34px] !w-auto min-w-[34px] !px-2 font-[family-name:var(--mono)] text-xs font-semibold [@media(pointer:coarse)]:!h-10 [@media(pointer:coarse)]:min-w-10" label={`Playback speed ${rate}×`} onClick={cycleSpeed}
            icon={<motion.span key={rate} initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={spring(0.5, 0.3)}>{`${rate}×`}</motion.span>} />
          <IconButton tone="onDark" size="icon" className={VIDEO_BTN} label={isFs ? 'Exit fullscreen' : 'Fullscreen'} onClick={fullscreen} icon={icon(isFs ? 'minimize' : 'maximize')} />
        </div>
      </motion.div>
    </div>
  )
}

const AUDIO_SPEEDS = [1, 1.25, 1.5, 2, 0.75]
/** Round primary play / pause button shared by the audio players. */
function MediaPlayButton({ playing, label, size, iconSize, className, onClick }: { playing: boolean; label: string; size: string; iconSize: number; className?: string; onClick: () => void }) {
  return (
    <motion.button type="button" whileTap={{ scale: 0.88 }} aria-label={label} onClick={onClick}
      className={cn('grid flex-none cursor-pointer place-items-center rounded-full border-0', size, !playing && 'ps-0.5', className ?? 'bg-[var(--primary)] text-[var(--on-primary)]')}>
      <Icon name={playing ? 'pause' : 'play'} size={iconSize} filled />
    </motion.button>
  )
}

/**
 * Audio player: cover, title, back / forward 10 s, speed cycle and a waveform you click or drag to seek
 * (hovering previews the jump; on touch, tap or swipe sideways along it, while a vertical swipe still scrolls the page). The waveform is a slider: ← / → seek 2 s, Home / End, Space plays.
 * Pass `track` (createAudioTrack) to share playback with other players, or just `src`.
 */
export function AudioPlayer({ track: shared, src, title, meta, cover, peaks, duration = 0, chapters, className }:
  { track?: AudioTrackHandle; src?: string; title: ReactNode; meta?: ReactNode; cover?: string | ReactNode; peaks: number[]; duration?: number
    /** chapter starts: gaps in the waveform, magnets while scrubbing, the current title under it and PageUp / PageDown to jump */ chapters?: readonly MediaChapter[]; className?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const { track, s, toggle } = usePlayerTrack(shared, src, duration, root)
  const d = s.duration || duration || 1
  const seek = useSeekSlider({ time: s.time, duration: d, onSeek: track.seek, onToggle: toggle, chapters })
  const [plays, setPlays] = useState(0)
  useEffect(() => { if (s.playing) setPlays(p => p + 1) }, [s.playing])
  return (
    <div ref={root} className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center gap-3">
        <motion.div key={plays} initial={plays ? { scale: 1 } : false} animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 0.5 }}
          className={cn(surface.muted, 'h-14 w-14 flex-none overflow-hidden')}>
          {typeof cover === 'string' ? <img src={safeMediaUrl(cover) || undefined} alt="" className="block h-full w-full object-cover" /> : cover}
        </motion.div>
        <div className="min-w-0 flex-1">
          <b className="block truncate font-semibold">{title}</b>
          {meta && <span className="text-xs text-[var(--fg3)]">{meta}</span>}
          <div className="mt-2 flex items-center gap-1">
            <div className="flex items-center gap-1">
            <IconButton icon="replay" label={'Back 10 seconds'} onClick={() => track.skip(-10)} tone="default" className="text-[var(--fg2)] hover:text-[var(--fg)]" />
            <MediaPlayButton playing={s.playing} label={s.playing ? 'Pause' : 'Play'} onClick={toggle} size="h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" iconSize={16} />
            <IconButton icon="forward" label={'Forward 10 seconds'} onClick={() => track.skip(10)} tone="default" className="text-[var(--fg2)] hover:text-[var(--fg)]" />
            </div>
            <span className="flex-1" />
            <Button variant="ghost" size="sm" aria-label={`Playback speed ${s.rate}×`} onClick={() => track.setRate(cycleNext(AUDIO_SPEEDS, s.rate))} className="ui-num [@media(pointer:coarse)]:min-w-11">{`${s.rate}×`}</Button>
          </div>
        </div>
      </div>
      <div {...seek.bind} className="relative h-12 cursor-pointer touch-pan-y rounded-[var(--r-md)] outline-none select-none focus-visible:shadow-[0_0_0_2px_var(--accent)]">
        <Waveform peaks={peaks} played={s.time / d} hover={seek.hover} className="h-full" />
        {chapters && <span className="pointer-events-none absolute inset-x-0 -bottom-2 h-1.5"><MagnetMarks {...seek.marks} value={seek.chapter?.start} tone="under" /></span>}
      </div>
      {seek.live}
      <div className="ui-num -mt-1 flex justify-between gap-3 text-[11px] text-[var(--fg3)]"><span>{fmt.clock(s.time)}</span>
        {chapters && <bdi className="min-w-0 truncate font-[family-name:var(--font)] font-medium text-[var(--fg2)]">{seek.chapter?.title}</bdi>}<span>{fmt.clock(d)}</span></div>
    </div>
  )
}

/** Slim pill player: play, title, a thin draggable progress bar (← / → when focused; a 32px touch band on phones) and the time. Share `track` to sync with a full player. */
export function MiniAudioPlayer({ track: shared, src, title, duration = 0, className }: { track?: AudioTrackHandle; src?: string; title: string; duration?: number; className?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const { track, s, toggle } = usePlayerTrack(shared, src, duration, root)
  const d = s.duration || duration || 1
  const seek = useSeekSlider({ time: s.time, duration: d, onSeek: track.seek, onToggle: toggle, valueText: t => fmt.clock(t) })
  return (
    <div ref={root} className={cn('flex items-center gap-2.5 rounded-full border border-[var(--line)] bg-[var(--card)] py-2 pe-3 ps-2 [@media(pointer:coarse)]:gap-3 [@media(pointer:coarse)]:pe-4', className)}>
      <MediaPlayButton playing={s.playing} label={(s.playing ? `Pause ${title}` : `Play ${title}`)} onClick={toggle} size="h-8 w-8 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9" iconSize={13} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <b className="truncate text-xs leading-none font-semibold">{title}</b>
        <motion.div {...seek.bind} animate={{ scaleY: seek.drag ? 1.6 : 1 }} transition={{ duration: 0.12 }}
          className="relative h-1 cursor-pointer touch-pan-y rounded-[var(--r-sm)] bg-[var(--muted)] outline-none before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] focus-visible:shadow-[0_0_0_2px_var(--accent)] [@media(pointer:coarse)]:before:-inset-y-3.5">
          <i className="absolute inset-y-0 start-0 rounded-[var(--r-sm)] bg-[var(--primary)]" style={{ width: `${s.time / d * 100}%` }} />
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
  const { track, s, toggle } = usePlayerTrack(shared, src, duration, box)
  const d = s.duration || duration || 1
  const seek = useSeekSlider({ time: s.time, duration: d, onSeek: track.seek, onToggle: toggle, label: 'Seek voice note' })
  return (
    <div ref={box} className={cn('flex w-full max-w-[280px] items-center gap-2 self-end rounded-[18px_18px_4px_18px] bg-[var(--primary)] py-2 pe-2.5 ps-2 text-[var(--on-primary)]', className)}>
      <MediaPlayButton playing={s.playing} label={s.playing ? 'Pause voice note' : 'Play voice note'} onClick={toggle} iconSize={12}
        size="h-7 w-7 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9" className="bg-[color-mix(in_srgb,var(--on-primary)_18%,transparent)] text-inherit" />
      <div {...seek.bind} className="h-[22px] min-w-0 flex-1 cursor-pointer touch-pan-y rounded-[var(--r-sm)] outline-none select-none focus-visible:shadow-[0_0_0_2px_var(--on-primary)] [@media(pointer:coarse)]:h-8">
        <Waveform peaks={peaks} bars={bars} played={s.time / d} tone="current" minHeight={14} className="h-full" />
      </div>
      <span className="ui-num flex-none text-[11px] opacity-80">{fmt.clock(s.time || d)}</span>
      <button type="button" aria-label={`Playback speed ${s.rate}×`} onClick={() => track.setRate(cycleNext(VOICE_SPEEDS, s.rate))}
        className="h-6 flex-none cursor-pointer rounded-full border-0 bg-[color-mix(in_srgb,var(--on-primary)_16%,transparent)] px-1.5 font-[family-name:var(--mono)] text-[11px] font-semibold text-inherit [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:min-w-9 [@media(pointer:coarse)]:text-[11px]">
        <motion.span key={s.rate} className="inline-block" initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={spring(0.5, 0.3)}>{`${s.rate}×`}</motion.span>
      </button>
    </div>
  )
}

export type LightboxItem = { id: string | number; src: string; full?: string | (() => string); title: string; meta?: string; ratio: number }
const lightboxFull = (it: LightboxItem) => typeof it.full === 'function' ? it.full() : it.full ?? it.src
/** Round chrome button on the dark lightbox backdrop (any theme). */
const LB_BTN = '!h-[38px] !w-[38px] !rounded-full !bg-white/10 text-white hover:!bg-white/20 aria-pressed:!bg-white/25'
const LB_NAV = '!h-12 !w-12 !rounded-full !bg-white/10 text-white hover:!bg-white/20'
/** Lightbox zoom: the most, the +/− step, a double tap or click, and below `snap` a pinch settles back to 1. */
const LB_ZOOM = { max: 4, step: 0.6, tap: 2.2, snap: 1.08 }
/** The top bar and the thumbnail strip around the stage (px, plus the safe areas). */
const LB_TOP = 64, LB_BOTTOM = 130

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
  const root = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null), thumbs = useRef<HTMLDivElement>(null)
  const [stage, stageSize] = useElementSize<HTMLDivElement>()
  const reduce = useReducedMotion()
  const fx = useMotionValue(0), fy = useMotionValue(0), fs = useMotionValue(1), fo = useMotionValue(1)
  const zs = useMotionValue(1), zx = useMotionValue(0), zy = useMotionValue(0)
  const [zoom, setZoomState] = useState(1)
  const [closing, setClosing] = useState(false)
  const [hiSrc, setHiSrc] = useState<string | null>(null)
  const lastTap = useRef(0), ptrType = useRef('mouse'), zoomRef = useRef(1), panFrom = useRef({ x: 0, y: 0 }), moved = useRef(false), bgDown = useRef(false)
  const it = items[index]
  useFocusTrap(root, true)
  // frame size from the image ratio, so it's known before the full image decodes (the window's size until the stage is measured)
  const vw = stageSize.width || document.documentElement.clientWidth || window.innerWidth, stageH = Math.max(120, stageSize.height || window.innerHeight - LB_TOP - LB_BOTTOM)
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
    if (!reduce) { fx.set((dir * 40)); fo.set(0); animate(fx, 0, spring(0.2, 0.4)); animate(fo, 1, { duration: 0.25 }) } else { fx.set(0); fo.set(1) }
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
      const L = latest.current, key = e.key
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); L.close() }
      else if (key === 'ArrowRight') L.go(L.index + 1)
      else if (key === 'ArrowLeft') L.go(L.index - 1)
      else if (e.key === '+' || e.key === '=') L.setZoom(Math.min(LB_ZOOM.max, zoomRef.current + LB_ZOOM.step))
      else if (e.key === '-') L.setZoom(Math.max(1, zoomRef.current - LB_ZOOM.step))
    }
    document.addEventListener('keydown', on, true); return () => document.removeEventListener('keydown', on, true)
  }, [])
  const gesture = usePinchPan({
    getZoom: () => zoomRef.current, onZoom: zoomNow, wheel: stage, max: LB_ZOOM.max,
    onPinchStart: () => { moved.current = true; animate(fx, 0, spring(0.3, 0.35)); animate(fy, 0, spring(0.3, 0.35)) }, // a second finger takes over from the swipe / pan
    onPinchEnd: () => { if (zoomRef.current < LB_ZOOM.snap) setZoom(1); setTimeout(() => { moved.current = false }, 0) },
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
        if (now - lastTap.current < 300) { lastTap.current = 0; setZoom(zoomRef.current > 1 ? 1 : LB_ZOOM.tap) } else lastTap.current = now
      }
      if (zoomRef.current === 1) {
        if (dy > 110 && dy > Math.abs(dx)) close()
        else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(index + (dx < 0 ? 1 : -1)) // swipe towards the start: next
        else settle()
      }
      setTimeout(() => { moved.current = false }, 0)
    },
    onCancel: () => { animate(fx, 0, spring(0.3, 0.35)); animate(fy, 0, spring(0.3, 0.35)); fo.set(1) },
  })
  const chrome = { initial: { opacity: 0 }, animate: { opacity: closing ? 0 : 1 }, transition: { duration: closing ? 0.15 : 0.3, delay: closing ? 0 : 0.1 } }
  return (
    <div ref={root} role="dialog" aria-modal="true" aria-label={'Image viewer'} className="fixed inset-0 z-[95] text-white">
      <motion.div className="absolute inset-0 bg-[rgba(8,8,10,.92)] backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: closing ? 0 : 1 }} transition={{ duration: 0.25 }} onClick={close} />
      <motion.div {...chrome} className="absolute inset-x-0 top-0 z-[2] flex items-center gap-1.5 p-3 pt-[max(12px,env(safe-area-inset-top))] text-[13px]">
        <span className="ui-num">{`${fmt.number(index + 1)} / ${fmt.number(items.length)}`}</span><span className="flex-1" />
        <IconButton tone="default" size="icon" className={LB_BTN} label={zoom > 1 ? 'Zoom out' : 'Zoom in'} aria-pressed={zoom > 1} onClick={() => setZoom(zoom > 1 ? 1 : LB_ZOOM.tap)} icon={<Icon name="zoomIn" size={18} />} />
        <IconButton tone="default" size="icon" className={LB_BTN} label={'Close'} data-autofocus onClick={close} icon={<Icon name="x" size={17} />} />
      </motion.div>
      <div ref={stage} className="absolute inset-x-0 top-[calc(64px+env(safe-area-inset-top))] bottom-[calc(130px+env(safe-area-inset-bottom))] flex touch-none items-center justify-center overflow-hidden"
        onClick={() => { if (bgDown.current && !moved.current) close(); bgDown.current = false }} {...gesture.bind}>
        <motion.div ref={frame} style={{ x: fx, y: fy, scale: fs, opacity: fo, width: w, height: h }} className="relative flex-none">
          <motion.img src={safeMediaUrl(hiSrc ?? it.src) || undefined} alt={it.title} draggable={false} style={{ x: zx, y: zy, scale: zs, backgroundImage: cssUrl(it.src) }}
            onClick={() => { if (ptrType.current === 'mouse' && zoomRef.current === 1 && !moved.current) setZoom(LB_ZOOM.tap) }} onDoubleClick={() => { if (ptrType.current === 'mouse') setZoom(zoomRef.current > 1 ? 1 : LB_ZOOM.tap) }}
            className={cn('block h-full w-full rounded-[var(--r-md)] bg-cover object-cover shadow-[0_20px_60px_rgba(0,0,0,.5)] select-none', zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in')} />
        </motion.div>
      </div>
      <motion.div {...chrome} className="absolute top-1/2 start-4 z-[2] -mt-6 max-sm:hidden"><IconButton tone="default" size="icon" className={LB_NAV} label={'Previous'} onClick={() => go(index - 1)} icon={<Icon name="chevronLeft" size={24} />} /></motion.div>
      <motion.div {...chrome} className="absolute top-1/2 end-4 z-[2] -mt-6 max-sm:hidden"><IconButton tone="default" size="icon" className={LB_NAV} label={'Next'} onClick={() => go(index + 1)} icon={<Icon name="chevronRight" size={24} />} /></motion.div>
      <motion.div {...chrome} className="pointer-events-none absolute inset-x-0 bottom-[calc(86px+env(safe-area-inset-bottom))] flex flex-col gap-0.5 text-center text-[13px]" aria-live="polite">
        <b className="font-semibold">{it.title}</b>{it.meta && <span className="text-xs opacity-65">{it.meta}</span>}
      </motion.div>
      <motion.div {...chrome} ref={thumbs} className="absolute inset-x-0 bottom-0 flex gap-1.5 overflow-x-auto overscroll-x-contain p-3 pb-[max(12px,env(safe-area-inset-bottom))] [scrollbar-width:none] [&>:first-child]:ms-auto [&>:last-child]:me-auto">
        {items.map((t, k) => (
          <button key={t.id} type="button" aria-label={t.title} aria-current={k === index} onClick={() => go(k)}
            className={cn('h-[52px] w-[52px] flex-none cursor-pointer overflow-hidden rounded-[var(--r-md)] border-0 bg-[#222] p-0 transition-[opacity,transform] duration-200', k === index ? '-translate-y-0.5 opacity-100 shadow-[0_0_0_2px_#fff]' : 'opacity-45 hover:opacity-80')}>
            <img src={safeMediaUrl(t.src) || undefined} alt="" className="block h-full w-full object-cover" />
          </button>
        ))}
      </motion.div>
    </div>
  )
}

export type GalleryItem = LightboxItem & { category: string; author?: string; likes?: number }

function MasonryTile({ it, x, y, width, imgH, delay, saved, saving, onSave, onOpen, imgRef }:
  { it: GalleryItem; x: number; y: number; width: number; imgH: number; delay: number; saved: boolean; saving: boolean; onSave?: () => void; onOpen: () => void; imgRef: (el: HTMLImageElement | null) => void }) {
  const [entered, setEntered] = useState(false)
  const likes = it.likes != null ? `, ${plural(it.likes, 'like')}` : '', by = it.author ? `, by ${it.author}` : ''
  // a list item holding two sibling controls: the picture opens the lightbox, Save toggles (never a button inside a button)
  return (
    <motion.div role="listitem"
      initial={{ x, y: y + 20, opacity: 0, scale: 0.96 }} animate={{ x, y, opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
      transition={entered ? spring(0.15, 0.55) : { duration: 0.45, delay, ease: EASE_OUT }} onAnimationComplete={() => setEntered(true)}
      className="group absolute top-0 start-0" style={{ width }}>
      <div className="relative overflow-hidden rounded-[var(--r-lg)] bg-[var(--muted)] has-[button:focus-visible]:shadow-[0_0_0_2px_var(--accent)]" style={{ height: imgH }}>
        {/* the name includes the like count: on touch the caption (title and ♥ count) is always visible, and a spoken
            command should match what's on screen (WCAG 2.5.3) */}
        <button type="button" onClick={onOpen} aria-label={`Open ${it.title}${likes}${by}`} className="absolute inset-0 block cursor-zoom-in border-0 bg-transparent p-0 outline-none">
          <img ref={imgRef} src={safeMediaUrl(it.src) || undefined} alt="" draggable={false} width={Math.round(width)} height={Math.round(imgH)} decoding="async" className="block h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" style={{ transitionTimingFunction: EASE_OUT_CSS }} />
          <span aria-hidden className="absolute inset-0 flex items-end justify-between gap-2 bg-gradient-to-b from-transparent from-55% to-black/55 p-2.5 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 max-sm:p-2">
            <span className="min-w-0 truncate">{it.title}</span>{it.likes != null && <span className="flex-none">♥ {fmt.number(it.likes)}</span>}
          </span>
        </button>
        {onSave && <motion.button type="button" aria-pressed={saved} aria-busy={saving || undefined} disabled={saving} aria-label={(saved ? `Unsave ${it.title}` : `Save ${it.title}`)} whileTap={{ scale: 0.85 }} onClick={onSave}
          className={cn('absolute top-2 end-2 h-[30px] cursor-pointer rounded-full border-0 px-3 text-xs font-semibold transition-[opacity,transform] duration-200 disabled:cursor-default [@media(pointer:coarse)]:h-[34px] max-sm:top-1.5 max-sm:end-1.5',
            // touch has no hover: the button is always shown there
            saved || saving ? 'bg-[var(--primary)] text-[var(--on-primary)] opacity-100' : '-translate-y-1 bg-[var(--bad)] text-[var(--card)] opacity-0 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100 [@media(pointer:coarse)]:translate-y-0 [@media(pointer:coarse)]:opacity-100')}>
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </motion.button>}
      </div>
      <div className="flex h-[30px] min-w-0 items-center gap-1.5 px-0.5 pt-2 text-xs text-[var(--fg2)]">{it.author && <><Avatar name={it.author} size={18} className="!border-0 [@media(pointer:coarse)]:!h-[22px] [@media(pointer:coarse)]:!w-[22px] [@media(pointer:coarse)]:!text-[11px]" /><span className="min-w-0 truncate">{it.author}</span></>}</div>
    </motion.div>
  )
}

/**
 * Pinterest-style masonry: each tile drops into the shortest column; columns follow the width (two on phones).
 * On touch screens the Save button and the title overlay are always visible (no hover there).
 * Category chips filter with a reflow, "Load more" staggers new tiles in (and says "That’s everything"
 * when `hasMore` is false), and clicking opens the Lightbox from the tile. With `onSave(item, saved)` each tile has a
 * Save toggle: the tile shows "Saving…" while a returned promise is pending, and only once it resolves does the tile
 * flip and a "Saved" toast appear (a rejection shows "Couldn’t save"). `saved` / `defaultSaved` are the saved ids.
 * The layout comes from each item's `ratio` (height / width), so the full height is reserved before any image loads
 * and nothing below moves; tiles fade in when the gallery scrolls into view.
 */
export function MasonryGallery({ items, categories, onLoadMore, hasMore = true, minColumn = 210, saved: savedProp, defaultSaved = [], onSave, className }:
  { items: GalleryItem[]; categories?: string[]; onLoadMore?: () => void; hasMore?: boolean; minColumn?: number
    saved?: readonly GalleryItem['id'][]; defaultSaved?: readonly GalleryItem['id'][]
    onSave?: (item: GalleryItem, saved: boolean) => void | Promise<void>; className?: string }) {
  const [host, W] = useWidth<HTMLDivElement>()
  const inView = useInView(host, { once: true, amount: 0.05 })
  const toast = useToast()
  const [filter, setFilter] = useState('All')
  const [saved, setSaved] = useControllable<readonly GalleryItem['id'][]>(savedProp, defaultSaved)
  const savedNow = useRef(saved); savedNow.current = saved
  const [saving, setSaving] = useState<ReadonlySet<GalleryItem['id']>>(() => new Set())
  const [open, setOpen] = useState<number | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const save = async (it: GalleryItem) => {
    if (!onSave || saving.has(it.id)) return
    const next = !saved.includes(it.id)
    const busy = (on: boolean) => setSaving(s => { const n = new Set(s); if (on) n.add(it.id); else n.delete(it.id); return n })
    busy(true)
    try { await onSave(it, next) } catch { if (alive.current) { busy(false); toast({ title: next ? 'Couldn’t save' : 'Couldn’t unsave', description: it.title, tone: 'bad' }) } return }
    if (!alive.current) return
    busy(false)
    const cur = savedNow.current
    setSaved(next ? (cur.includes(it.id) ? cur : [...cur, it.id]) : cur.filter(id => id !== it.id))
    if (next) toast({ title: 'Saved', description: it.title, tone: 'ok' })
  }
  const imgs = useRef(new Map<GalleryItem['id'], HTMLImageElement>())
  const prevIds = useRef(new Set<GalleryItem['id']>())
  const cats = categories ?? ['All', ...new Set(items.map(i => i.category))]
  const visible = items.filter(it => filter === 'All' || it.category === filter)
  const userResize = useRef(false) // only a filter or Load more animates the height; data arriving on its own just takes its place
  const gap = W < 480 ? 8 : 12, cols = Math.max(2, Math.min(5, Math.floor((W + gap) / minColumn))), cw = W ? (W - gap * (cols - 1)) / cols : 0
  const hs = new Array<number>(cols).fill(0)
  let fresh = 0
  const placed = visible.map(it => {
    let c = 0; for (let k = 1; k < hs.length; k++) if (hs[k] < hs[c]) c = k
    const x = c * (cw + gap), y = hs[c], imgH = cw * it.ratio
    hs[c] += imgH + 30 + gap
    const delay = prevIds.current.has(it.id) ? 0 : Math.min(12, fresh++) * 0.04
    return { it, x, y, imgH, delay }
  })
  useEffect(() => { if (inView) prevIds.current = new Set(visible.map(v => v.id)); userResize.current = false })
  let tallest = 0; for (const v of hs) if (v > tallest) tallest = v
  const height = visible.length ? tallest - gap : 240
  const lbItems = visible.map(it => ({ ...it, meta: [it.author, it.category, it.likes != null ? `♥ ${fmt.number(it.likes)}` : ''].filter(Boolean).join(' · ') }))
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={'Filter by category'}>
        {cats.map(c => <Chip key={c} pressed={c === filter} onClick={() => { userResize.current = true; setFilter(c) }} className="font-normal">{c}</Chip>)}
      </div>
      <motion.div ref={host} role="list" aria-label={'Gallery'} className="relative" initial={false} animate={{ height }} transition={userResize.current ? { duration: 0.35, ease: 'easeOut' } : { duration: 0 }}>
        <AnimatePresence>
          {cw > 0 && inView && placed.map(({ it, x, y, imgH, delay }, k) => (
            <MasonryTile key={it.id} it={it} x={x} y={y} width={cw} imgH={imgH} delay={delay} saved={saved.includes(it.id)} saving={saving.has(it.id)}
              imgRef={el => { if (el) imgs.current.set(it.id, el); else imgs.current.delete(it.id) }}
              onOpen={() => setOpen(k)} onSave={onSave && (() => { void save(it) })} />
          ))}
        </AnimatePresence>
      </motion.div>
      {onLoadMore && <Button className="self-center" disabled={!hasMore} onClick={() => { userResize.current = true; onLoadMore() }}>{hasMore ? 'Load more' : 'That’s everything'}</Button>}
      {open != null && lbItems[open] && <Lightbox items={lbItems} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} originFor={id => imgs.current.get(id)} />}
    </div>
  )
}

/** Loading placeholder for MediaCard. The shimmer only animates while the card is on screen. */
function MediaCardSkeleton({ className }: { className: string }) {
  const { ref, visible: onScreen } = useViewport<HTMLDivElement>(null, { amount: 0 })
  const bone = cn('rounded-[var(--r-sm)] bg-[var(--muted)]', onScreen && 'ui-shimmer')
  return (
    <div ref={ref} className={className} role="status" aria-busy="true" aria-label={'Loading'}>
      <div className={cn(bone, 'aspect-[4/3] !rounded-none')} />
      {/* the same line boxes as the loaded card (date, title, two lines of description, author row), so swapping in the content doesn't move anything */}
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex h-[16.5px] items-center"><div className={cn(bone, 'h-2.5 w-2/5')} /></div>
        <div className="flex h-[17.5px] items-center"><div className={cn(bone, 'h-3.5 w-[85%]')} /></div>
        <div className="flex h-[35px] flex-col justify-around"><div className={cn(bone, 'h-2.5 w-[95%]')} /><div className={cn(bone, 'h-2.5 w-3/5')} /></div>
        <div className="mt-auto flex items-center gap-2 pt-1.5"><div className={cn(bone, 'h-[22px] w-[22px] !rounded-full')} /><div className={cn(bone, 'h-2.5 w-1/3')} /></div>
      </div>
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
        {image && <img src={safeMediaUrl(image) || undefined} alt={title} className="block h-full w-full object-cover" />}
        {tag && <Badge size="sm" className="absolute top-2.5 start-2.5 !bg-black/50 !text-white backdrop-blur-sm">{tag}</Badge>}
        {duration && <span className="absolute end-2.5 bottom-2.5 rounded-[var(--r-sm)] bg-black/65 px-1.5 py-0.5 font-[family-name:var(--mono)] text-[11px] font-medium text-white">{duration}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        {date && <span className="text-[11px] text-[var(--fg3)]">{date}</span>}
        <div className="text-sm leading-tight font-semibold">{title}</div>
        {description && <div className="text-xs leading-[1.45] text-[var(--fg2)]">{description}</div>}
        <div className="mt-auto flex items-center gap-2 pt-1.5 text-xs leading-none text-[var(--fg3)]">
          {author && <><Avatar name={author} size={22} className="!border-0 [@media(pointer:coarse)]:!text-[11px]" />{author}</>}
          <span className="flex-1" />
          <IconButton label={title ? `Bookmark ${title}` : 'Bookmark'} aria-pressed={mark} tone={mark ? 'default' : 'muted'} className={cn('-my-1 !h-6 !w-6 [@media(pointer:coarse)]:-me-1.5', TOUCH.tap36)}
            onClick={() => { const n = !mark; setOwnMark(n); onBookmarkChange?.(n); setPops(p => p + 1) }}
            icon={<motion.span key={pops} className="grid" initial={pops ? { scale: 0.7 } : false} animate={{ scale: [0.7, 1.15, 1] }} transition={spring(0.5, 0.4)}><Icon name="bookmark" size={15} filled={mark} /></motion.span>} />
        </div>
      </div>
    </motion.article>
  )
}

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
    const t = setTimeout(() => { const im = new Image(); im.onload = () => live && setState('loaded'); im.onerror = () => live && setState('error'); im.src = safeMediaUrl(src) }, delay)
    return () => { live = false; clearTimeout(t) }
  }, [src, attempt, delay])
  return (
    <div className={cn('relative overflow-hidden rounded-[var(--r-lg)] bg-[var(--muted)]', className)} style={{ aspectRatio: aspect }} aria-busy={state === 'loading'}>
      {state !== 'error' && placeholder && <img src={safeMediaUrl(placeholder) || undefined} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover blur-[14px]" />}
      {state === 'loaded' && <motion.img key={`${src}-${attempt}`} src={safeMediaUrl(src) || undefined} alt={alt} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} className="absolute inset-0 h-full w-full object-cover" />}
      <AnimatePresence>
        {state === 'error' && (
          <motion.div role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-[var(--fg3)]">
            <Icon name="imageOff" size={26} strokeWidth={1.6} />{'Image couldn’t load'}
            <Button size="sm" onClick={() => { onRetry?.(); setAttempt(a => a + 1) }}>{'Retry'}</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const CROP_BOX = 160, CROP_CIRCLE = 140
const CROP_ZOOM = { min: 1, max: 3 }
/**
 * Avatar cropper: the photo sits under a circular mask; drag (or arrow keys) to reposition, clamped so the
 * circle stays covered; zoom with the slider, the wheel, a two-finger pinch or + / −. "Choose photo" loads a local file and
 * 48 / 32 / 22 px previews update live. `onChange` receives the 256 px circle crop as a PNG data URL once the crop
 * settles (not on every pointer move). Chosen files must be images of at most `maxBytes` (15 MB) and `maxPixels`
 * (40 megapixels, checked from the header before anything is drawn); they load as object URLs, revoked when replaced
 * or on unmount. A rejected file shows why (and calls `onError`).
 */
export function AvatarCropper({ src: initial, defaultZoom = 1.2, onChange, onError, maxBytes = 15 * 1024 * 1024, maxPixels = 40e6, className }:
  { src: string; defaultZoom?: number; onChange?: (dataUrl: string) => void; onError?: (message: string) => void; maxBytes?: number; maxPixels?: number; className?: string }) {
  const [src, setSrc] = useState(() => safeMediaUrl(initial))
  const [err, setErr] = useState<string | null>(null)
  const ownUrl = useRef<string | null>(null) // object URL of the chosen file (ours to revoke)
  const [z, setZ] = useState(defaultZoom)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [loads, setLoads] = useState(0)
  const box = useRef<HTMLDivElement>(null), img = useRef<HTMLImageElement>(null), outs = useRef<(HTMLCanvasElement | null)[]>([])
  const from = useRef({ x: 0, y: 0 }), emit = useRef(onChange); emit.current = onChange
  const alive = useRef(true)
  const adopt = (url: string, own: boolean) => { if (ownUrl.current && ownUrl.current !== url) URL.revokeObjectURL(ownUrl.current); ownUrl.current = own ? url : null; setSrc(url) }
  useEffect(() => adopt(safeMediaUrl(initial), false), [initial]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (ownUrl.current) URL.revokeObjectURL(ownUrl.current) } }, [])
  const fail = (m: string) => { setErr(m); onError?.(m) }
  const choose = (f: File) => {
    if (!/^image\//.test(f.type)) return fail('Choose an image file (JPEG, PNG, WebP…).')
    if (f.size > maxBytes) return fail(`That photo is ${fmt.bytes(f.size)}; the limit is ${fmt.bytes(maxBytes)}.`)
    const url = URL.createObjectURL(f), probe = new Image()
    probe.onload = () => { // the size comes from the header, before the image is decoded or drawn
      if (!alive.current) { URL.revokeObjectURL(url); return }
      const pw = probe.naturalWidth, ph = probe.naturalHeight
      if (!pw || !ph || pw * ph > maxPixels || Math.max(pw, ph) > 16384) { URL.revokeObjectURL(url); return fail(`That photo is ${pw} × ${ph} px; the limit is ${Math.round(maxPixels / 1e6)} megapixels.`) }
      setErr(null); adopt(url, true); setZ(defaultZoom); setLoads(n => n + 1)
    }
    probe.onerror = () => { URL.revokeObjectURL(url); if (alive.current) fail('That file couldn’t be read as an image.') }
    probe.src = url
  }
  const base = nat ? CROP_BOX / Math.min(nat.w, nat.h) : 1
  const w = nat ? nat.w * base * z : CROP_BOX, h = nat ? nat.h * base * z : CROP_BOX
  const clampOff = (o: { x: number; y: number }, ww = w, hh = h) => { const mx = Math.max(0, (ww - CROP_CIRCLE) / 2), my = Math.max(0, (hh - CROP_CIRCLE) / 2); return { x: clamp(o.x, -mx, mx), y: clamp(o.y, -my, my) } }
  const o = clampOff(off)
  const zoomTo = (nz: number) => setZ(clamp(nz, CROP_ZOOM.min, CROP_ZOOM.max))
  useEffect(() => {
    const im = img.current; if (!im || !nat) return
    const draw = (c: HTMLCanvasElement | null, size: number) => { if (!c) return; const g = c.getContext('2d')!; g.clearRect(0, 0, size, size); const s = size / CROP_CIRCLE; g.drawImage(im, size / 2 - w * s / 2 + o.x * s, size / 2 - h * s / 2 + o.y * s, w * s, h * s) }
    outs.current.forEach(c => draw(c, 96)) // the small previews follow every move (cheap)
    if (!emit.current) return
    // the PNG export is expensive: only once the crop has stopped changing for a moment
    const t = setTimeout(() => {
      const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!; g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.clip(); draw(c, 256)
      try { emit.current?.(c.toDataURL('image/png')) } catch { /* a cross-origin src taints the canvas: previews still work, there's just no export */ }
    }, 250)
    return () => clearTimeout(t)
  }, [nat, w, h, o.x, o.y, src])
  const gesture = usePinchPan({ getZoom: () => z, onZoom: setZ, ...CROP_ZOOM, wheel: box, wheelStep: 0.06,
    onPanStart: () => { from.current = o }, onPan: ({ dx, dy }) => setOff(clampOff({ x: from.current.x + dx, y: from.current.y + dy })) })
  return (
    <div className={cn('flex flex-wrap items-center gap-4', className)}>
      <motion.div ref={box} key={loads} initial={loads ? { scale: 0.96 } : false} animate={{ scale: 1 }} transition={spring(0.4, 0.35)}
        tabIndex={0} role="group" aria-label={'Crop area. Drag or use arrow keys to reposition, + and − to zoom'}
        className="relative flex-none cursor-grab touch-none overflow-hidden rounded-[var(--r-lg)] bg-[var(--muted)] outline-none select-none focus-visible:shadow-[0_0_0_2px_var(--accent)] active:cursor-grabbing"
        style={{ width: CROP_BOX, height: CROP_BOX }} {...gesture.bind}
        onKeyDown={e => {
          // the arrows move the picture physically (it is an image, not text)
          const step = e.shiftKey ? 20 : 6, mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
          if (mv[e.key]) { e.preventDefault(); setOff(clampOff({ x: o.x + mv[e.key][0], y: o.y + mv[e.key][1] })) }
          if (e.key === '+' || e.key === '=') zoomTo(z + 0.1)
          if (e.key === '-') zoomTo(z - 0.1)
        }}>
        <img ref={img} src={src} alt={'Crop preview'} draggable={false} onLoad={e => { setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); setOff({ x: 0, y: 0 }) }}
          className="pointer-events-none absolute top-1/2 left-1/2 max-w-none select-none" style={{ width: w, transform: `translate(calc(-50% + ${o.x}px), calc(-50% + ${o.y}px))` }} />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_69px,rgba(0,0,0,.5)_70px)]" />
        <div className="pointer-events-none absolute inset-2.5 rounded-full shadow-[0_0_0_1.5px_rgba(255,255,255,.85)]" />
      </motion.div>
      <div className="min-w-[180px] flex-1">
        <div className="mb-3 flex items-center gap-3">
          {[48, 32, 22].map((s, i) => <canvas key={s} ref={el => { outs.current[i] = el }} width={96} height={96} aria-label={`${s} px preview`} role="img" className="flex-none rounded-full bg-[var(--muted)]" style={{ width: s, height: s }} />)}
        </div>
        <Slider label={'Zoom'} {...CROP_ZOOM} step={0.01} value={z} onChange={zoomTo} format={v => `${fmt.number(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`} />
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <label className={cn(surface.md, 'inline-flex h-[30px] cursor-pointer items-center px-3 text-xs font-medium hover:bg-[var(--muted)] focus-within:shadow-[0_0_0_2px_var(--accent)] [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:px-4')}>
            {'Choose photo'}
            <input type="file" accept="image/*" className="sr-only" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) choose(f) }} />
          </label>
          <span className="text-[11px] text-[var(--fg3)]"><span className="[@media(pointer:coarse)]:hidden">{'Drag the image to reposition'}</span><span className="hidden [@media(pointer:coarse)]:inline">{'Drag to move, pinch to zoom'}</span></span>
        </div>
        {err && <p role="alert" className="m-0 mt-2 text-xs text-[var(--bad)]">{err}</p>}
      </div>
    </div>
  )
}

/**
 * Scroll-snap carousel with arrows, dots, swipe and ← / → (all wrap around). Each slide's caption fades up
 * as it becomes the current slide. Slides can be any content.
 */
export function Carousel({ slides, aspect = '16/8', className }: { slides: { content: ReactNode; title?: ReactNode; caption?: ReactNode }[]; aspect?: string; className?: string }) {
  const track = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const [i, setI] = useState(0)
  const n = slides.length
  // slides run left to right
  const pitch = (t: HTMLElement) => ((t.children[0] as HTMLElement | undefined)?.offsetWidth ?? 0) + 12
  const go = (k: number) => { const t = track.current; if (t && n) t.scrollTo({ left: ((((k % n) + n) % n) * pitch(t)), behavior: reduce ? 'auto' : 'smooth' }) }
  const arrow = 'absolute top-1/2 grid h-9 w-9 -translate-y-1/2 max-sm:h-8 max-sm:w-8 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9 cursor-pointer place-items-center rounded-full border-0 bg-white/90 text-[#111] shadow-[0_2px_8px_rgba(0,0,0,.2)] hover:bg-white focus-visible:outline-2 focus-visible:outline-[var(--accent)]'
  return (
    <div className={cn('flex w-full min-w-0 max-w-full flex-col gap-2.5', className)} role="region" aria-roledescription="carousel" aria-label={'Carousel'}
      onKeyDown={e => { const k = e.key; if (k === 'ArrowRight') { e.preventDefault(); go(i + 1) } if (k === 'ArrowLeft') { e.preventDefault(); go(i - 1) } }}>
      {/* contain: inline-size keeps the slides (and their images' natural width) out of the card's min-content width,
          so the carousel can never stretch its card or the page sideways */}
      <div className="relative min-w-0 overflow-hidden rounded-[var(--r-lg)]">
        <div ref={track} tabIndex={0} aria-live="polite"
          onScroll={e => { const t = e.currentTarget; if (t.children[0]) setI(clamp(Math.round(t.scrollLeft / pitch(t)), 0, n - 1)) }}
          className="flex w-full min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain rounded-[var(--r-lg)] outline-none [contain:inline-size] [scrollbar-width:none] focus-visible:shadow-[0_0_0_2px_var(--accent)] [&::-webkit-scrollbar]:hidden">
          {slides.map((s, k) => (
            <div key={k} role="group" aria-roledescription="slide" aria-label={`${k + 1} of ${n}`} className="relative min-w-0 flex-[0_0_100%] snap-center overflow-hidden rounded-[var(--r-lg)]" style={{ aspectRatio: aspect }}>
              {s.content}
              {(s.title || s.caption) && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={k === i ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }} transition={{ duration: 0.4 }}
                  className="absolute inset-x-0 bottom-0 bg-gradient-to-b from-transparent to-black/60 px-4 pt-10 pb-4 text-white max-sm:px-3 max-sm:pt-8 max-sm:pb-2.5">
                  <b className="block text-base font-semibold max-sm:text-sm">{s.title}</b><span className="text-xs opacity-80">{s.caption}</span>
                </motion.div>
              )}
            </div>
          ))}
        </div>
        <button type="button" className={cn(arrow, 'start-2.5')} aria-label={'Previous slide'} onClick={() => go(i - 1)}><Icon name="chevronLeft" /></button>
        <button type="button" className={cn(arrow, 'end-2.5')} aria-label={'Next slide'} onClick={() => go(i + 1)}><Icon name="chevronRight" /></button>
      </div>
      {/* each dot is a 24px (32px on touch) button around the small visible pill */}
      <div className="-mt-1.5 flex justify-center">
        {slides.map((_, k) => (
          <button key={k} type="button" aria-label={`Go to slide ${k + 1}`} aria-current={k === i} onClick={() => go(k)}
            className="group/dot grid h-6 min-w-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent px-1 outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)] [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:min-w-8">
            <motion.span initial={false} animate={{ width: k === i ? 22 : 7 }} transition={spring(0.2, 0.35)}
              className={cn('block h-[7px] rounded-[var(--r-sm)] transition-colors', k === i ? 'bg-[var(--primary)]' : 'bg-[var(--line2)] group-hover/dot:bg-[var(--fg3)]')} />
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Before / after comparison: drag anywhere (or arrow keys / Home / End on the handle). Wiggles once when scrolled into
 * view to show it moves. On touch, a sideways drag (or any drag on the handle) moves the divider and a tap jumps it,
 * while a vertical swipe over the image still scrolls the page.
 */
export function ImageCompare({ before, after, aspect = '4/3', className }: { before: ReactNode; after: ReactNode; aspect?: string; className?: string }) {
  const [pos, setPos] = useState(50)
  const box = useRef<HTMLDivElement>(null)
  const dragging = useRef(false), touched = useRef(false)
  const intent = useScrubIntent()
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
        if (e.pointerType === 'mouse' || onHandle) { dragging.current = true; capturePointer(e.currentTarget, e.pointerId); set(e.clientX) }
        else intent.wait(e) // touch on the image: wait to see if it's a sideways drag or a scroll
      }}
      onPointerMove={e => {
        if (dragging.current) { set(e.clientX); return }
        if (intent.sideways(e)) { dragging.current = true; capturePointer(e.currentTarget, e.pointerId); set(e.clientX) }
      }}
      onPointerUp={e => { if (intent.tap()) set(e.clientX); dragging.current = false }} onPointerCancel={() => { intent.cancel(); dragging.current = false }}>
      <div className="absolute inset-0">{after}</div>
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>{before}</div>
      <Badge size="sm" className="pointer-events-none absolute top-2.5 start-2.5 !bg-black/45 font-semibold !text-white">{'Before'}</Badge>
      <Badge size="sm" className="pointer-events-none absolute top-2.5 end-2.5 !bg-black/45 font-semibold !text-white">{'After'}</Badge>
      {/* the divider moves by transform (a full-width layer shifted by pos%), never by `left`, so dragging and the intro sweep skip layout */}
      <div className="pointer-events-none absolute inset-0" style={{ transform: `translateX(${pos}%)` }}>
      <div className="pointer-events-auto absolute inset-y-0 left-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_8px_rgba(0,0,0,.4)]">
        <button type="button" role="slider" aria-label={'Comparison position'} aria-valuenow={Math.round(pos)} aria-valuemin={0} aria-valuemax={100}
          onKeyDown={e => {
            const k: Record<string, (p: number) => number> = { ArrowLeft: p => p - 5, ArrowRight: p => p + 5, Home: () => 0, End: () => 100 }
            if (k[e.key]) { e.preventDefault(); touched.current = true; setPos(p => clamp(k[e.key](p), 0, 100)) }
          }}
 className="absolute top-1/2 left-1/2 flex h-[34px] w-[34px] -translate-1/2 cursor-ew-resize touch-none items-center justify-center rounded-full border-0 bg-white text-[#111] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 shadow-[0_2px_8px_rgba(0,0,0,.3)] focus-visible:shadow-[0_0_0_3px_var(--accent)] focus-visible:outline-none">
          <Icon name="chevronsLeftRight" size={14} strokeWidth={2.5} />
        </button>
      </div>
      </div>
    </div>
  )
}
