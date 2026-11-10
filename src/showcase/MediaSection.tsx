import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useInView } from 'motion/react'
import {
  Button, Skeleton,
} from '../lib'
import { AudioPlayer, AvatarCropper, Carousel, ImageCompare, MasonryGallery, MediaCard, MiniAudioPlayer, ProgressiveImage, VideoPlayer, VoiceNote, createAudioTrack, type GalleryItem, type MediaChapter } from '../lib/media'
import { mediaArt, mediaImage, mediaImageAsync, mediaRecordVideo, mediaSynthTrackAsync, type MediaArtKind } from '../examples'
import { Section, Spec } from './kit'

/* Everything below is generated in the page (canvas art, a synthesised WAV, a canvas recording), so it works offline.
   Canvas and blobs only exist in the browser, so each demo makes its media after mount; the server (and the first
   client render) shows placeholders of the same size (skeleton heights match the loaded players on mouse and touch). */

/** `make()` once, after mount, in a task of its own (cards that mount together don't add their canvases and WAVs up into
 * one long task); a promise is awaited. null until then (and on the server). */
function useClientValue<T>(make: () => T | Promise<T>): T | null {
  const [v, setV] = useState<T | null>(null)
  useEffect(() => {
    let live = true
    const t = setTimeout(() => { Promise.resolve(make()).then(x => { if (live) setV(() => x) }) })
    return () => { live = false; clearTimeout(t) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return v
}

/** Generate-once helper: the canvases are painted and encoded on first use only, never per render. */
const demoOnce = <T,>(make: () => T) => { let v: T | undefined; return () => (v ??= make()) }
/** demoOnce for a list of generated pictures: one item per task (a JPEG encode is tens of ms on a phone, and a card
 * of 16 in one go was a 250 ms task), resolved once all are made. */
const demoEach = <A, T>(list: readonly A[], make: (a: A, i: number) => T | Promise<T>) => {
  let all: Promise<T[]> | undefined
  return () => (all ??= (async () => {
    const out: T[] = []
    for (let i = 0; i < list.length; i++) { await new Promise(r => setTimeout(r)); out.push(await make(list[i], i)) }
    return out
  })())
}
const nightDriveCover = demoOnce(() => {
  const c = mediaArt('abstract', 112, 112, 3, 4), g = c.getContext('2d')!
  g.fillStyle = 'rgba(255,255,255,.9)'; g.font = '600 14px system-ui'; g.fillText('ND', 12, 98)
  return c.toDataURL('image/jpeg', 0.85)
})

const MEDIA_VIDEO_CHAPTERS: MediaChapter[] = [{ start: 0, title: 'Dusk' }, { start: 2.5, title: 'Aurora' }, { start: 5.5, title: 'Fade out' }]
const MEDIA_AUDIO_CHAPTERS: MediaChapter[] = [{ start: 0, title: 'Intro' }, { start: 6, title: 'Drive' }, { start: 14, title: 'Bridge' }, { start: 19, title: 'Outro' }]

function VideoDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const onScreen = useInView(ref)
  const video = useClientValue(() => mediaRecordVideo())
  const [src, setSrc] = useState<string | null | undefined>(undefined)
  useEffect(() => { if (!video) return; let live = true; video.ready.then(url => { if (live) setSrc(url) }); return () => { live = false } }, [video])
  // the recording (a canvas frame loop) only runs while the player is on screen
  useEffect(() => { if (!video) return; video.setActive(onScreen); return () => video.setActive(false) }, [video, onScreen])
  return <div ref={ref}><VideoPlayer src={src} poster={video?.poster} preparing={src === undefined} title="Aurora loop" meta="Generated · 0:08" duration={8} chapters={MEDIA_VIDEO_CHAPTERS} /></div>
}

const KINDS: MediaArtKind[] = ['mountains', 'sea', 'city', 'dunes', 'abstract']
const TITLES: Record<MediaArtKind, string[]> = { mountains: ['Alpine morning', 'Ridge line', 'High pass', 'Blue hour peaks', 'Valley light'], sea: ['Low tide', 'Harbour dusk', 'Open water', 'Coastline', 'Last light'], city: ['Night grid', 'Downtown', 'Rooftops', 'Skyline', 'Late shift'], dunes: ['Sand waves', 'Desert noon', 'Drift', 'Soft hills', 'Erg'], abstract: ['Bloom', 'Chroma', 'Haze', 'Glow study', 'Mood board'] }
const CAT: Record<MediaArtKind, string> = { mountains: 'Nature', sea: 'Nature', city: 'City', dunes: 'Travel', abstract: 'Abstract' }
const AUTHORS = ['Alex Lee', 'Bea Kim', 'Chris Moe', 'Dana Ng', 'Eli Park']

function makeGalleryItems(from: number, n: number): GalleryItem[] {
  return Array.from({ length: n }, (_, i) => galleryItem(from, i))
}
/** Item `i` of a batch of gallery items starting at `from`; `paint` false leaves the picture empty (made later). */
function galleryItem(from: number, i: number, paint = true): GalleryItem {
  const k = from + i, kind = KINDS[k % 5], ratio = [1.25, 0.75, 1.5, 1, 1.35, 0.9, 1.6, 1.1][(from + i * 3) % 8], seed = k + 1, pal = (from + i * 5) % 8
  return {
    id: k, title: TITLES[kind][k % 5], category: CAT[kind], ratio, author: AUTHORS[k % 5], likes: 20 + (k * 37) % 400,
    src: paint ? mediaImage(kind, 360, Math.round(360 * ratio), seed, pal, 0.8) : '', full: () => mediaImage(kind, 1100, Math.round(1100 * ratio), seed, pal, 0.88),
  }
}
const galleryStart = demoEach(Array.from({ length: 16 }, (_, i) => i), async i => {
  const it = galleryItem(0, i, false) // the same picture galleryItem(0, i) paints, encoded off the main thread
  return { ...it, src: await mediaImageAsync(KINDS[i % 5], 360, Math.round(360 * it.ratio), i + 1, (i * 5) % 8, 0.8) }
})
/** The first 16 tiles without pictures: their ratios are known up front, so the gallery has its final height from the
 * first render and the pictures fill in without moving anything (it was 240px tall until all 16 were painted). */
const galleryBlank = Array.from({ length: 16 }, (_, i) => galleryItem(0, i, false))
function GalleryDemo() {
  const [items, setItems] = useState<GalleryItem[]>(galleryBlank)
  useEffect(() => { let live = true; galleryStart().then(x => { if (live) setItems(x) }); return () => { live = false } }, [])
  return <MasonryGallery items={items} categories={['All', 'Nature', 'City', 'Travel', 'Abstract']} hasMore={items.length < 40} onLoadMore={() => setItems(x => [...x, ...makeGalleryItems(x.length, 8)])} />
}

const CARDS: [MediaArtKind, string, string, string, number, number][] = [
  ['mountains', 'Field notes from the Engadin', 'A week of early starts and very cold coffee above St. Moritz.', '12:40', 2, 0],
  ['city', 'Designing for night mode', 'What we learned shipping dark themes across four products.', '08:15', 3, 4],
  ['sea', 'The quiet harbour', 'Photo essay on slow mornings and working boats.', '05:02', 5, 1],
  ['abstract', 'Colour systems that scale', 'Tokens, contrast and why your palette needs fewer colours.', '18:30', 7, 7],
]
const cardImages = demoEach(CARDS, ([k, , , , seed, pal]) => mediaImageAsync(k, 480, 360, seed, pal))
function CardsDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.2 })
  const images = useClientValue(cardImages)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { if (!inView) return; const t = setTimeout(() => setLoaded(true), 900); return () => clearTimeout(t) }, [inView])
  return (
    <div ref={ref} className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr))]">
      {CARDS.map(([k, title, desc, dur], i) => (
        <MediaCard key={title} loading={!loaded || !images} index={i} image={images?.[i]} title={title} description={desc} tag={CAT[k]} duration={dur}
          date={`${['3 Nov', '29 Oct', '22 Oct', '14 Oct'][i]} · ${4 + i * 2} min read`} author={AUTHORS[i]} />
      ))}
    </div>
  )
}

const SLIDES: [MediaArtKind, string, string, number, number][] = [['mountains', 'Swiss Alps', 'Hiking guide · 6 routes', 11, 0], ['sea', 'Atlantic coast', 'Road trip · 9 days', 4, 1], ['city', 'Tokyo at night', 'Photo walk · 12 spots', 8, 4], ['dunes', 'Wadi Rum', 'Desert camp · 3 nights', 6, 5], ['abstract', 'Colour study', 'Gallery · 24 works', 9, 2]]
const demoImg = (src: string, alt: string) => <img src={src} alt={alt} draggable={false} className="block h-full w-full object-cover" />

const slideItems = demoEach(SLIDES, async ([k, title, caption, seed, pal]) => ({ content: demoImg(await mediaImageAsync(k, 900, 450, seed, pal, 0.85), title), title, caption }))

function CompareDemo() {
  const imgs = useClientValue(compareImages)
  return <ImageCompare before={imgs && demoImg(imgs[1], 'Before')} after={imgs && demoImg(imgs[0], 'After')} />
}
const compareImages = demoOnce(() => {
    const c = mediaArt('mountains', 600, 450, 21, 0), after = c.toDataURL('image/jpeg', 0.85), g = c.getContext('2d')!, d = g.getImageData(0, 0, 600, 450), p = d.data
    for (let i = 0; i < p.length; i += 4) { const y = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]; p[i] = p[i + 1] = p[i + 2] = Math.min(255, y * 0.9 + 10) }
    g.putImageData(d, 0, 0); return [after, c.toDataURL('image/jpeg', 0.85)]
})

function ImageStatesDemo() {
  const imgs = useClientValue(() => ({ lq: mediaImage('sea', 24, 18, 31, 1, 0.6), hq: mediaImage('sea', 640, 480, 31, 1, 0.88) })) // mediaImage is memoised
  const [run, setRun] = useState(0)
  const [broken, setBroken] = useState(false)
  return (
    <>
      {imgs ? <ProgressiveImage key={run} src={broken ? 'data:image/jpeg;base64,broken' : imgs.hq} placeholder={imgs.lq} alt="Harbour" delay={900} onRetry={() => setBroken(false)} />
        : <Skeleton className="aspect-[4/3] !rounded-[var(--r-lg)]" />}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => { setBroken(false); setRun(r => r + 1) }}>Reload</Button>
        <Button size="sm" onClick={() => { setBroken(true); setRun(r => r + 1) }}>Simulate error</Button>
      </div>
    </>
  )
}

const placeholderSlides = SLIDES.map(([, title, caption]) => ({ content: <div className="h-full w-full bg-[var(--muted)]" />, title, caption }))

/** The shared synth track (full and slim players stay in sync), its cover, and the avatar photo: made by the first
 * card that needs them, as it mounts near the viewport, not when the page loads; the WAV is synthesised in short
 * steps (it was a ~1 s main-thread task on a phone). */
type MediaDemoTrack = { track: Awaited<ReturnType<typeof mediaSynthTrackAsync>>; shared: ReturnType<typeof createAudioTrack>; cover: string }
let mediaDemoTrack: MediaDemoTrack | null = null, mediaDemoTrackP: Promise<MediaDemoTrack> | null = null
const mediaDemoShared = () => (mediaDemoTrackP ??= mediaSynthTrackAsync().then(track => (mediaDemoTrack = { track, shared: createAudioTrack(track.url, 24), cover: nightDriveCover() })))
const mediaDemoAvatar = demoOnce(() => mediaImage('city', 400, 400, 44, 2))
/** Renders `children(value)` with `make()`'s value once mounted (null on the server and in the first render). */
function MediaDemoLazy<T>({ make, children }: { make: () => T | Promise<T>; children: (v: T | null) => ReactNode }) {
  return <>{children(useClientValue(make))}</>
}

export function MediaSection() {
  useEffect(() => () => mediaDemoTrack?.shared.pause(), [])
  return (
    <Section id="media" title="Media" desc="Players, viewers and image layouts. Everything here is generated in the page, so it all works offline.">
      <Spec title="Video player" desc="Custom controls. Chapters cut the seek bar and pull the scrubber to their starts (hold Alt to scrub freely). On touch, tap shows the controls and double-tap seeks ±5 s." span={2}
        keys={[[['Space'], 'Play'], [['←', '→'], 'Seek'], [['PgUp', 'PgDn'], 'Next, previous chapter'], [['M'], 'Mute'], [['F'], 'Fullscreen']]}><VideoDemo /></Spec>
      <Spec title="Audio player" desc="Waveform you can click, tap or drag to seek. Scrubbing sticks to chapter starts; PgUp / PgDn jump between them">
        <MediaDemoLazy make={mediaDemoShared}>{demo => demo ? <AudioPlayer track={demo.shared} title="Night Drive" meta="Synth demo · 0:24" cover={demo.cover} peaks={demo.track.peaks} duration={24} chapters={MEDIA_AUDIO_CHAPTERS} /> : <Skeleton className="h-[171px] [@media(pointer:coarse)]:h-[179px]" />}</MediaDemoLazy>
      </Spec>
      <Spec title="Carousel" desc="Snap scrolling, arrows, dots, swipe on touch. Wraps around." span={2}><MediaDemoLazy make={slideItems}>{slides => <Carousel slides={slides ?? placeholderSlides} />}</MediaDemoLazy></Spec>
      <Spec title="Before / after" desc="Drag the handle, or use arrow keys"><CompareDemo /></Spec>
      <Spec title="Masonry gallery" desc="Pinterest-style columns. Filter and resize to watch tiles reflow. Click to open the lightbox; on touch, swipe, pinch to zoom and swipe down to close." span={3}><GalleryDemo /></Spec>
      <Spec title="Media cards" desc="Card grid with hover lift, save, and a skeleton while loading" span={3}><CardsDemo /></Spec>
      <Spec title="Image with states" desc="Blur-up loading, error fallback, retry"><ImageStatesDemo /></Spec>
      <Spec title="Compact audio" desc="Slim player and a chat-style voice note. The slim one stays in sync with the full player.">
        <MediaDemoLazy make={mediaDemoShared}>{demo => demo ? <>
          <MiniAudioPlayer track={demo.shared} title="Night Drive" duration={24} />
          <VoiceNote src={demo.track.url} peaks={demo.track.peaks} duration={24} />
        </> : <><Skeleton className="h-12 !rounded-full" /><Skeleton className="ms-auto h-[46px] w-full max-w-[280px] !rounded-[var(--r-lg)] [@media(pointer:coarse)]:h-[58px]" /></>}</MediaDemoLazy>
      </Spec>
      <Spec title="Avatar upload" desc="Pick a photo, crop it to a circle, zoom with the slider or a pinch"><MediaDemoLazy make={mediaDemoAvatar}>{src => src ? <AvatarCropper src={src} /> : <Skeleton className="h-[325px] [@media(pointer:coarse)]:h-[339px]" />}</MediaDemoLazy></Spec>
    </Section>
  )
}
