// Timeline annotations (0.5): layoutTimeTags (stacking, rug overflow, flags, rollup bins, auto thresholds), timeTicks,
// the useTagFocus keyboard model and tags on a Chart. Queried by role and accessible name.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../src/lib/core'
import { UI_MESSAGES_AR } from '../../src/lib/provider'
import { ANNOTATE_MESSAGES, Chart, layoutTimeTags, timeTicks, type TimeTag } from '../../src/lib'
import { TAGS_BUSY_DAY, TAGS_LIGHT_DAY, POSTURE_STATES_DAY, tagsDay } from '../../src/examples'

const at = (h: number, m = 0) => new Date(2026, 10, 9, h, m).getTime()
const T0 = at(9)
/** 1 px per minute from 9:00, times `k` */
const xOf = (k = 1) => (ms: number) => ((ms - T0) / 60_000) * k
const tag = (id: string, h: number, m: number, kind = 'water', end?: [number, number]): TimeTag =>
  ({ id, at: at(h, m), kind, label: kind[0].toUpperCase() + kind.slice(1), ...(end ? { end: at(...end) } : {}) })

describe('layoutTimeTags', () => {
  it('stacks colliding pins into rows and goes back to row 0 when there is room', () => {
    const l = layoutTimeTags([tag('c', 9, 10), tag('a', 9, 0), tag('b', 9, 5), tag('d', 9, 30)], { x: xOf(), width: 600, style: 'pins' })
    expect(l.style).toBe('pins')
    expect(l.points.map(p => [p.tag.id, p.row])).toEqual([['a', 0], ['b', 1], ['c', 2], ['d', 0]]) // time order
    expect(l.rows).toBe(3)
    expect(l.hidden).toBe(0)
  })
  it('folds what does not fit into the last row glyph as "+N" (rug overflow)', () => {
    const tags = [0, 1, 2, 3, 4].map(m => tag(`t${m}`, 9, m))
    const l = layoutTimeTags(tags, { x: xOf(), width: 600, style: 'rug', maxStack: 3 })
    expect(l.hidden).toBe(2)
    const host = l.points.find(p => p.more)!
    expect(host.row).toBe(2)
    expect(host.more).toEqual(['t3', 't4'])
    expect(l.points.filter(p => p.hidden).map(p => p.tag.id)).toEqual(['t3', 't4'])
  })
  it('keeps a "+N" badge clear of the next glyph in its row', () => {
    const l = layoutTimeTags([tag('a', 9, 0), tag('b', 9, 5), tag('c', 9, 30), tag('d', 9, 41)], { x: xOf(), width: 600, style: 'rug', maxStack: 1 })
    // without the badge, 'c' (30 px after 'a') would fit; the "+1" badge on 'a' ends at 28 px, so the next glyph starts at ≥ 40
    expect(l.points.find(p => p.tag.id === 'a')!.more).toEqual(['b', 'c'])
    expect(l.points.find(p => p.tag.id === 'd')!.hidden).toBeUndefined()
  })
  it('drops flag labels that would overlap the previous one, keeping every rule', () => {
    const l = layoutTimeTags([tag('a', 9, 0), tag('b', 9, 20), tag('c', 10, 0)], { x: xOf(), width: 600, style: 'flags', labelWidth: () => 50 })
    expect(l.points.map(p => p.flag)).toEqual([true, false, true])
    expect(l.points).toHaveLength(3)
  })
  it('returns spans with their px edges, apart from the points', () => {
    const l = layoutTimeTags([tag('lunch', 12, 30, 'lunch', [13, 5]), tag('w', 9, 40)], { x: xOf(), width: 600, style: 'pins' })
    expect(l.points.map(p => p.tag.id)).toEqual(['w'])
    expect(l.spans[0]).toMatchObject({ x0: 210, x1: 245, from: at(12, 30), to: at(13, 5) })
  })
  it('rolls points up into bins per kind, with the bin size chosen from the width', () => {
    const tags = [tag('w1', 9, 5), tag('w2', 9, 10), tag('s1', 9, 20, 'snack'), tag('w3', 9, 50), tag('w4', 10, 15)]
    // 1 px/min: 30 min bins are 30 px (< 34), so bins are an hour
    const l = layoutTimeTags(tags, { x: xOf(), width: 600, style: 'rollup' })
    expect(l.bins.map(b => [b.kind, b.count, b.from, b.to, b.row])).toEqual([
      ['water', 3, at(9), at(10), 0], ['snack', 1, at(9), at(10), 1], ['water', 1, at(10), at(11), 0],
    ])
    expect(l.bins[0].ids).toEqual(['w1', 'w2', 'w3'])
    expect(l.points.find(p => p.tag.id === 'w4')!.bin).toBe(2)
    // 4 px/min: 10 min bins (40 px)
    const wide = layoutTimeTags(tags, { x: xOf(4), width: 2400, style: 'rollup' })
    expect(wide.bins[0]).toMatchObject({ from: at(9), to: at(9, 10), count: 1 })
  })
  it('gathers kinds past maxStack into one "*" chip', () => {
    const tags = ['water', 'snack', 'smoke', 'pushups'].map((k, i) => tag(k, 9, i * 5, k))
    const l = layoutTimeTags(tags, { x: xOf(), width: 600, style: 'rollup', maxStack: 3 })
    expect(l.bins.map(b => b.kind)).toEqual(['water', 'snack', '*'])
    expect(l.bins[2]).toMatchObject({ count: 2, row: 2 })
  })
  it('auto: pins while they fit in 2 rows, then the rug (3 rows), then rollups, by width', () => {
    const three = [tag('a', 9, 0), tag('b', 9, 10), tag('c', 9, 20)]
    expect(layoutTimeTags(three, { x: xOf(3), width: 1600 }).style).toBe('pins') // 30 px apart: one row
    expect(layoutTimeTags(three, { x: xOf(1.5), width: 800 }).style).toBe('pins') // 15 px: two rows
    expect(layoutTimeTags(three, { x: xOf(0.5), width: 300 }).style).toBe('rug') // 5 px: three rows
    const four = [...three, tag('d', 9, 30)]
    expect(layoutTimeTags(four, { x: xOf(0.5), width: 300 }).style).toBe('rollup') // four rows needed
    expect(layoutTimeTags(four, { x: xOf(3), width: 1600 }).style).toBe('pins') // wider again: back to pins
  })
  it('auto on the sample days: pins for the light day on a desktop width, rollups for the busy day', () => {
    const k = 640 / 510
    expect(layoutTimeTags(TAGS_LIGHT_DAY.filter(t => !t.end), { x: xOf(k), width: 640 }).style).toBe('pins')
    expect(layoutTimeTags(TAGS_BUSY_DAY.filter(t => !t.end), { x: xOf(k), width: 640 }).style).toBe('rollup')
  })
})

describe('timeTicks', () => {
  const fmt = (ms: number) => { const d = new Date(ms); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }
  it('picks hourly ticks for a workday at 640 px', () => {
    expect(timeTicks(at(9), at(17, 30), 640, fmt).map(t => t.label)).toEqual(['9:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'])
  })
  it('steps up when narrow, aligned to the clock', () => {
    expect(timeTicks(at(9), at(17, 30), 200, fmt).map(t => t.label)).toEqual(['9:00', '12:00', '15:00'])
    expect(timeTicks(at(9, 7), at(11), 640, fmt).map(t => t.label)).toEqual(['9:15', '9:30', '9:45', '10:00', '10:15', '10:30', '10:45', '11:00'])
    const short = timeTicks(at(9, 7), at(11), 640, fmt)
    expect(short[0].ms).toBeGreaterThan(at(9, 7))
    expect(short.every(t => new Date(t.ms).getMinutes() % 15 === 0)).toBe(true)
    expect(timeTicks(at(9), at(9), 640, fmt)).toEqual([])
  })
})

describe('sample day', () => {
  it('is deterministic and covers the workday', () => {
    const d = tagsDay('light')
    expect(tagsDay('light')).toBe(d)
    expect(d.points).toHaveLength(511)
    expect(d.points[0].t).toBe(at(9))
    expect(POSTURE_STATES_DAY[0].at).toBe(at(9))
    expect(POSTURE_STATES_DAY.at(-1)!.end).toBe(at(17, 30))
    for (let i = 1; i < POSTURE_STATES_DAY.length; i++) expect(POSTURE_STATES_DAY[i].at).toBe(POSTURE_STATES_DAY[i - 1].end)
    expect(TAGS_BUSY_DAY.filter(t => !t.end).length).toBeGreaterThanOrEqual(TAGS_LIGHT_DAY.filter(t => !t.end).length * 4)
  })
})

describe('Chart annotations', () => {
  beforeEach(() => { vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640) })
  afterEach(() => vi.restoreAllMocks())
  const day = tagsDay('light')
  const tags = [tag('w', 10, 40), tag('s', 10, 50, 'snack'), tag('lunch', 12, 30, 'lunch', [13, 5])]
  const en = (ui: ReactNode) => render(<LocaleProvider locale="en-GB">{ui}</LocaleProvider>)
  const chart = (extra: object = {}) => <Chart data={day.points} x="t" series={[{ key: 'points', label: 'Points', type: 'area' }]} legend={false} annotations={{ tags, ...extra }} />

  it('renders the tags as a list with accessible names in time order', () => {
    en(chart())
    const list = screen.getByRole('listbox', { name: 'Tags' })
    expect(list).toHaveAttribute('tabindex', '0')
    expect(screen.getAllByRole('option').map(o => o.getAttribute('aria-label'))).toEqual(['Water at 10:40', 'Snack at 10:50', 'Lunch, 12:30 to 13:05'])
    expect(screen.getByRole('option', { name: 'Water at 10:40' })).toHaveAttribute('aria-selected', 'false')
  })
  it('spans: "none" leaves the spans out', () => {
    en(chart({ spans: 'none' }))
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })
  it('keyboard: arrows walk the tags, Enter selects, Escape clears; keys do not reach the series', () => {
    const onSelect = vi.fn(), onActiveChange = vi.fn()
    en(chart({ onSelect, onActiveChange }))
    const list = screen.getByRole('listbox', { name: 'Tags' })
    const active = () => document.getElementById(list.getAttribute('aria-activedescendant') ?? '')?.getAttribute('aria-label') ?? null
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(active()).toBe('Water at 10:40')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Water')
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(active()).toBe('Snack at 10:50')
    fireEvent.keyDown(list, { key: 'End' })
    expect(active()).toBe('Lunch, 12:30 to 13:05')
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(active()).toBe('Lunch, 12:30 to 13:05') // stays at the end
    fireEvent.keyDown(list, { key: 'Home' })
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'w' }))
    expect(onActiveChange).toHaveBeenLastCalledWith('w')
    // the series' own keyboard model (the chart group) didn't move: no series tooltip besides the tag's
    expect(screen.getAllByRole('tooltip')).toHaveLength(1)
    fireEvent.keyDown(list, { key: 'Escape' })
    expect(list).not.toHaveAttribute('aria-activedescendant')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
  it('End and Home use the time order across points and spans, whatever order the tags come in (light day)', () => {
    const light = [...TAGS_LIGHT_DAY].reverse().map((t, i) => (i % 2 ? { ...t, at: new Date(t.at) } : t)) // shuffled, some Dates
    const Linked = () => {
      const [id, setId] = useState<string | null>(null)
      return <Chart data={day.points} x="t" series={[{ key: 'points', type: 'area' }]} legend={false} annotations={{ tags: light, kinds: day.kinds, style: 'dots', activeId: id, onActiveChange: setId }} />
    }
    en(<Linked />)
    const list = screen.getByRole('listbox', { name: 'Tags' })
    const active = () => document.getElementById(list.getAttribute('aria-activedescendant') ?? '')?.getAttribute('aria-label')
    expect(screen.getAllByRole('option').map(o => o.getAttribute('aria-label'))[0]).toBe('Slouching, 9:35 to 9:48')
    fireEvent.keyDown(list, { key: 'End' })
    expect(active()).toBe('Water at 16:10')
    expect(screen.getByRole('tooltip')).toHaveTextContent('16:10')
    fireEvent.keyDown(list, { key: 'ArrowLeft' })
    expect(active()).toBe('Moving, 15:50 to 16:06')
    fireEvent.keyDown(list, { key: 'Home' })
    expect(active()).toBe('Slouching, 9:35 to 9:48')
    en(<Chart data={day.points} x="t" series={[{ key: 'points', type: 'area' }]} legend={false} annotations={{ tags: light, spans: 'none', label: 'Points only' }} />)
    const pts = screen.getByRole('listbox', { name: 'Points only' })
    fireEvent.keyDown(pts, { key: 'End' })
    expect(document.getElementById(pts.getAttribute('aria-activedescendant')!)).toHaveAccessibleName('Water at 16:10')
  })
  it('activeId is controllable from outside (a linked list)', () => {
    const { rerender } = en(chart({ activeId: null }))
    expect(screen.getByRole('option', { name: 'Snack at 10:50' })).toHaveAttribute('aria-selected', 'false')
    rerender(<LocaleProvider locale="en-GB">{chart({ activeId: 's' })}</LocaleProvider>)
    expect(screen.getByRole('option', { name: 'Snack at 10:50' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Snack')
  })
  it('hover shows the tooltip and reports the active tag', () => {
    const onActiveChange = vi.fn()
    en(chart({ onActiveChange, style: 'rug' }))
    act(() => { fireEvent.pointerEnter(screen.getByRole('option', { name: 'Snack at 10:50' }), { pointerType: 'mouse' }) })
    expect(onActiveChange).toHaveBeenLastCalledWith('s')
    expect(screen.getByRole('tooltip')).toHaveTextContent('10:50')
  })
  it("reserve: 'max' keeps the height for every auto style; 'current' takes only what the shown style needs", async () => {
    const box = () => screen.getByRole('listbox').closest('[dir="ltr"]') as HTMLElement
    const busy = TAGS_BUSY_DAY.filter(t => !t.end)
    const { rerender } = en(chart({ reserve: 'max' }))
    expect(box().style.height).toBe(`${220 + 3 * 23 + 6}px`) // auto: pins now, room for the rug and rollup band too
    rerender(<LocaleProvider locale="en-GB"><Chart data={day.points} x="t" series={[{ key: 'points', type: 'area' }]} legend={false} annotations={{ tags: busy, reserve: 'max' }} /></LocaleProvider>)
    expect(box().style.height).toBe(`${220 + 3 * 23 + 6}px`) // rollups: same height
    rerender(<LocaleProvider locale="en-GB">{chart({ style: 'rug', spans: 'none' })}</LocaleProvider>)
    expect(box().style.height).toBe(`${220 + 2 * 23 + 6}px`) // current (default): the two rug rows 10:40 and 10:50 need
    rerender(<LocaleProvider locale="en-GB">{chart({ spans: 'none' })}</LocaleProvider>)
    await waitFor(() => expect(box().style.height).toBe('220px'), { timeout: 4000 }) // auto resolved to pins: no band (eased over 250 ms)
  })
  it('rollups keep one option per tag', () => {
    en(chart({ style: 'rollup', spans: 'none' }))
    expect(screen.getAllByRole('option').map(o => o.getAttribute('aria-label'))).toEqual(['Water at 10:40', 'Snack at 10:50'])
  })
  it('the plot stays an LTR island and the names translate (Arabic)', () => {
    render(<LocaleProvider locale="ar-EG" messages={UI_MESSAGES_AR}>{chart()}</LocaleProvider>)
    const list = screen.getByRole('listbox', { name: 'الوسوم' })
    expect(list.closest('[dir]')).toHaveAttribute('dir', 'ltr')
    expect(screen.getAllByRole('option')[0].getAttribute('aria-label')).toMatch(/^Water عند /)
  })
  it('ANNOTATE_MESSAGES: de and ar translate every key', () => {
    for (const lang of ['de', 'ar']) expect(Object.keys(ANNOTATE_MESSAGES.catalogs[lang] ?? {}).sort()).toEqual(Object.keys(ANNOTATE_MESSAGES.en).sort())
  })
})
