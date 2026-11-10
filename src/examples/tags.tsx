/* Demo-only sample: one "Nudge" workday (9:00 to 17:30) with a points line, logged habits and posture states, in a
 * light and a busy variant. Used by the "Tags over time" cards (Chart annotations, Swimlanes, StateRibbon, journal).
 * Deterministic: the same times on server and client (local wall-clock times on a fixed date). */
import type { TimeTag, TimeTagKind } from '../lib/annotate'
import { seeded } from './random'

/** Which sample day: a handful of logged events, or about five times as many with clusters a few minutes apart. */
export type TagsDayVariant = 'light' | 'busy'

/** Every tag kind in the sample: logged habits (points), lunch (a span) and the four posture states. */
export const TAGS_KINDS: TimeTagKind[] = [
  { kind: 'water', label: 'Water', icon: '💧', color: 'var(--c2)' },
  { kind: 'snack', label: 'Snack', icon: '🍎', color: 'var(--bad)' },
  { kind: 'pushups', label: 'Push-ups', icon: '💪', color: 'var(--c3)' },
  { kind: 'smoke', label: 'Smoke', icon: '🚬', color: 'var(--fg3)' },
  { kind: 'lunch', label: 'Lunch', icon: '🍽️', color: 'var(--warn)' },
  { kind: 'posture', label: 'Good posture', icon: '🧍', color: 'var(--ok)' },
  { kind: 'slouching', label: 'Slouching', icon: '🙇', color: 'var(--bad)' },
  { kind: 'moving', label: 'Moving', icon: '🚶', color: 'var(--c3)' },
  { kind: 'lying', label: 'Lying down', icon: '🛌', color: 'var(--accent)' },
]
/** The kinds that are logged as events (lanes in a swimlane view): habits and lunch, not posture. */
export const TAGS_EVENT_KINDS = TAGS_KINDS.filter(k => ['water', 'snack', 'pushups', 'smoke', 'lunch'].includes(k.kind))
/** The posture kinds (a state ribbon's colours). */
export const TAGS_POSTURE_KINDS = TAGS_KINDS.filter(k => ['posture', 'slouching', 'moving', 'lying'].includes(k.kind))

/** The sample date: Monday 9 November 2026, local time. */
const tagsBase = new Date(2026, 10, 9).getTime()
/** Epoch ms of hh:mm on the sample day (local wall-clock time). */
export const tagsAt = (h: number, m = 0) => new Date(new Date(tagsBase).setHours(h, m, 0, 0)).getTime()
/** Workday bounds: 9:00 to 17:30. */
export const TAGS_DAY_START = tagsAt(9), TAGS_DAY_END = tagsAt(17, 30)

const tagsKindOf = (kind: string) => TAGS_KINDS.find(k => k.kind === kind)!
type TagsRaw = [time: string, kind: string, label?: string, end?: string, detail?: string]
const tagsHm = (s: string) => { const [h, m] = s.split(':').map(Number); return tagsAt(h, m) }
const tagsBuild = (prefix: string, raw: TagsRaw[]): TimeTag[] => raw.map(([at, kind, label, end, detail], i) => ({
  id: `${prefix}-${i + 1}`, at: tagsHm(at), ...(end ? { end: tagsHm(end) } : {}), kind, label: label ?? tagsKindOf(kind).label,
  ...(detail ? { detail } : {}),
})).sort((a, b) => (a.at as number) - (b.at as number))

// Light day: the journal from the reference (eight logged events plus lunch) and a few posture spells
const TAGS_LIGHT_RAW: TagsRaw[] = [
  ['9:40', 'water', 'Water', undefined, '250 ml'], ['10:50', 'snack', 'Snack', undefined, 'Apple'], ['11:05', 'water', 'Water', undefined, '250 ml'],
  ['11:30', 'pushups', 'Push-ups ×15', undefined, '15 reps'], ['12:30', 'lunch', 'Lunch', '13:05', 'Salad at the canteen'], ['14:20', 'water', 'Water', undefined, '500 ml'],
  ['15:05', 'smoke', 'Smoke', undefined, 'Outside, 6 min'], ['15:30', 'snack', 'Snack', undefined, 'Banana'], ['16:10', 'water', 'Water', undefined, '250 ml'],
]
const TAGS_LIGHT_POSTURE: TagsRaw[] = [
  ['9:35', 'slouching', 'Slouching', '9:48'], ['10:27', 'slouching', 'Slouching', '10:45'], ['11:10', 'moving', 'Moving', '11:25'],
  ['11:55', 'lying', 'Lying down', '12:20'], ['14:00', 'moving', 'Moving', '14:16'], ['14:58', 'slouching', 'Slouching', '15:12'],
  ['15:50', 'moving', 'Moving', '16:06'],
]

// Busy day: ~5× the events, with clusters a minute or two apart (a water round, push-up sets, a snack run)
const TAGS_BUSY_RAW: TagsRaw[] = (() => {
  const r = seeded(17), out: TagsRaw[] = []
  const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`
  const detail: Record<string, () => string> = {
    water: () => `${[150, 250, 330, 500][Math.floor(r() * 4)]} ml`, snack: () => ['Apple', 'Banana', 'Nuts', 'Yoghurt', 'Crackers'][Math.floor(r() * 5)],
    pushups: () => `${10 + Math.floor(r() * 3) * 5} reps`, smoke: () => `Outside, ${4 + Math.floor(r() * 5)} min`,
  }
  const add = (min: number, kind: string) => {
    const d = detail[kind]?.()
    out.push([hm(min), kind, kind === 'pushups' ? `Push-ups ×${parseInt(d ?? '15')}` : undefined, undefined, d])
  }
  // clusters: [start minute after midnight, kind, how many, minutes apart]
  const clusters: [number, string, number, number][] = [
    [9 * 60 + 12, 'water', 3, 1], [9 * 60 + 47, 'snack', 2, 2], [10 * 60 + 3, 'pushups', 4, 2],
    [11 * 60 + 31, 'water', 3, 2], [11 * 60 + 44, 'pushups', 3, 1], [13 * 60 + 12, 'snack', 3, 1],
    [13 * 60 + 40, 'water', 4, 1], [14 * 60 + 9, 'smoke', 2, 2], [14 * 60 + 35, 'pushups', 3, 2], [15 * 60 + 2, 'water', 2, 1],
    [15 * 60 + 28, 'snack', 2, 3], [16 * 60 + 5, 'water', 3, 1], [17 * 60 + 5, 'smoke', 2, 4],
  ]
  for (const [start, kind, n, gap] of clusters) for (let i = 0; i < n; i++) add(start + i * gap, kind)
  // and singles spread through the day
  const kinds = ['water', 'water', 'snack', 'pushups', 'smoke']
  for (let min = 9 * 60 + 25; min < 17 * 60 + 25; min += 40 + Math.floor(r() * 20)) {
    if (min >= 12 * 60 + 25 && min <= 13 * 60 + 10) continue // lunch
    add(min, kinds[Math.floor(r() * kinds.length)])
  }
  out.push(['12:30', 'lunch', 'Lunch', '13:05', 'Burrito at the desk'], ['16:45', 'snack', 'Snack', undefined, 'Cake (birthday)'])
  return out
})()
const TAGS_BUSY_POSTURE: TagsRaw[] = [
  ['9:05', 'slouching', 'Slouching', '9:14'], ['9:30', 'moving', 'Moving', '9:38'], ['9:52', 'slouching', 'Slouching', '10:08'],
  ['10:20', 'moving', 'Moving', '10:26'], ['10:44', 'slouching', 'Slouching', '10:58'], ['11:15', 'moving', 'Moving', '11:24'],
  ['11:50', 'lying', 'Lying down', '12:10'], ['12:15', 'slouching', 'Slouching', '12:28'], ['13:15', 'slouching', 'Slouching', '13:40'],
  ['13:52', 'moving', 'Moving', '14:02'], ['14:20', 'slouching', 'Slouching', '14:31'], ['14:48', 'moving', 'Moving', '14:57'],
  ['15:10', 'slouching', 'Slouching', '15:26'], ['15:40', 'lying', 'Lying down', '15:55'], ['16:12', 'moving', 'Moving', '16:22'],
  ['16:40', 'slouching', 'Slouching', '16:58'], ['17:10', 'moving', 'Moving', '17:20'],
]

/** Light day: 8 logged events, lunch and 7 posture spells (slouching, moving, lying down) as tags. */
export const TAGS_LIGHT_DAY: TimeTag[] = tagsBuild('l', [...TAGS_LIGHT_RAW, ...TAGS_LIGHT_POSTURE])
/** Busy day: about five times as many events, many within a minute or two of each other, and more posture spells. */
export const TAGS_BUSY_DAY: TimeTag[] = tagsBuild('b', [...TAGS_BUSY_RAW, ...TAGS_BUSY_POSTURE])

/** Fill the gaps between posture spells with "good posture", so the states cover 9:00 to 17:30 without holes. */
function tagsStates(prefix: string, spells: TagsRaw[]): TimeTag[] {
  const sp = tagsBuild(prefix, spells), out: TimeTag[] = []
  let at = TAGS_DAY_START
  for (const s of sp) {
    if ((s.at as number) > at) out.push({ id: `${prefix}-g${out.length}`, at, end: s.at, kind: 'posture', label: 'Good posture' })
    out.push(s); at = s.end as number
  }
  if (at < TAGS_DAY_END) out.push({ id: `${prefix}-g${out.length}`, at, end: TAGS_DAY_END, kind: 'posture', label: 'Good posture' })
  return out
}
/** Contiguous posture states for the light day (9:00 to 17:30, no gaps): good posture, slouching, moving, lying down. */
export const POSTURE_STATES_DAY: TimeTag[] = tagsStates('ls', TAGS_LIGHT_POSTURE)
/** Contiguous posture states for the busy day. */
export const POSTURE_STATES_BUSY_DAY: TimeTag[] = tagsStates('bs', TAGS_BUSY_POSTURE)

/** One row of the points line: epoch ms and the running score. */
export type TagsPoint = { t: number; points: number }

/**
 * The points line, one row per minute from 9:00 to 17:30. It drifts up slowly, steps up a few minutes after good
 * events (water, push-ups, a snack, moving), dips after a smoke and sags while slouching; lying down and lunch are flat.
 */
function tagsPoints(tags: TimeTag[]): TagsPoint[] {
  const step: Record<string, number> = { water: 3, pushups: 4, snack: 1.5, smoke: -3.5 }
  const rows: TagsPoint[] = []
  let v = 10
  const span = (ms: number, kind: string) => tags.some(t => t.kind === kind && t.end !== undefined && ms >= (t.at as number) && ms < (t.end as number))
  for (let ms = TAGS_DAY_START; ms <= TAGS_DAY_END; ms += 60_000) {
    const flat = span(ms, 'lying') || span(ms, 'lunch')
    if (!flat) v += 0.035 + 0.05 * Math.sin(ms / 1_100_000)
    if (span(ms, 'slouching')) v -= 0.12
    if (span(ms, 'moving')) v += 0.2
    // a good event lifts the line over the next two minutes (a small step right after the tag)
    for (const t of tags) {
      const d = (ms - (t.at as number)) / 60_000
      if (t.end === undefined && step[t.kind] && d > 0 && d <= 2) v += step[t.kind] / 2
    }
    rows.push({ t: ms, points: Math.round(Math.max(0, v) * 10) / 10 })
  }
  return rows
}

/** Everything one sample day needs: bounds, the points line, tags (points and spans), posture states and kinds. */
export type TagsDay = { variant: TagsDayVariant; start: number; end: number; points: TagsPoint[]; tags: TimeTag[]; states: TimeTag[]; kinds: TimeTagKind[] }
const tagsDayCache: Partial<Record<TagsDayVariant, TagsDay>> = {}
/**
 * The sample workday: `tagsDay('light')` or `tagsDay('busy')`. Memoised, so the same arrays come back every call.
 * `tags` holds point events (`at` only) and spans (`at` → `end`: lunch, posture spells); `states` covers the whole day.
 */
export function tagsDay(variant: TagsDayVariant = 'light'): TagsDay {
  const tags = variant === 'busy' ? TAGS_BUSY_DAY : TAGS_LIGHT_DAY
  return tagsDayCache[variant] ??= {
    variant, start: TAGS_DAY_START, end: TAGS_DAY_END, points: tagsPoints(tags), tags,
    states: variant === 'busy' ? POSTURE_STATES_BUSY_DAY : POSTURE_STATES_DAY, kinds: TAGS_KINDS,
  }
}
