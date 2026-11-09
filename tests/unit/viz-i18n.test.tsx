// i18n and RTL of the visual modules (0.4 wave 2): charts, diagrams (Gantt, statecharts, trace, flows), geo, media and
// collaboration. Catalog completeness, Arabic and German rendering, the LTR-plot convention (dir="ltr" plot boxes,
// arrows follow the plot) and the mirrored widgets (lists, carousel, lightbox). Queried by role and accessible name.
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../src/lib/core'
import { UI_MESSAGES_AR, UI_MESSAGES_DE } from '../../src/lib/provider'
import * as lib from '../../src/lib'
import {
  BarList, Carousel, Chart, CommentThread, Gantt, Lightbox, MiniAudioPlayer, StateDiagram, TraceWaterfall, createAudioTrack, type MessageDefs,
} from '../../src/lib'
import { DG_MESSAGES } from '../../src/lib/diagramkit'
import { PLAYGROUND_MESSAGES } from '../../src/examples/playground'

const ar = (ui: ReactNode) => render(<LocaleProvider locale="ar-EG" messages={UI_MESSAGES_AR}>{ui}</LocaleProvider>)
const de = (ui: ReactNode) => render(<LocaleProvider locale="de-DE" messages={UI_MESSAGES_DE}>{ui}</LocaleProvider>)
afterEach(() => vi.restoreAllMocks())

/** The top-level {placeholders} of an ICU-lite message (plural/select bodies skipped). */
const vars = (s: string) => {
  const out = new Set<string>(); let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') { if (depth === 0) { const m = /^\{\s*([\w.-]+)/.exec(s.slice(i)); if (m) out.add(m[1]) } depth++ }
    else if (s[i] === '}') depth--
  }
  return [...out].sort()
}

describe('module catalogs', () => {
  const NS = new Set(['chart', 'collab', 'diagram', 'gantt', 'geo', 'media', 'network', 'statechart', 'trace', 'playground'])
  const all: Record<string, MessageDefs> = { DG_MESSAGES, PLAYGROUND_MESSAGES }
  for (const [k, v] of Object.entries(lib)) if (k.endsWith('_MESSAGES') && NS.has((v as MessageDefs).namespace)) all[k] = v as MessageDefs
  it('finds every catalog of these modules', () => expect(Object.keys(all).length).toBeGreaterThanOrEqual(26))
  for (const [name, defs] of Object.entries(all)) {
    it(`${name}: de and ar translate every key with the same placeholders`, () => {
      const en = defs.en as Record<string, string>
      for (const lang of ['de', 'ar']) {
        const cat = defs.catalogs[lang] as Record<string, string> | undefined
        expect(cat, `${name}.${lang}`).toBeDefined()
        expect(Object.keys(cat!).sort(), `${name}.${lang} keys`).toEqual(Object.keys(en).sort())
        for (const k of Object.keys(en)) expect(vars(cat![k]), `${defs.namespace}.${k} (${lang})`).toEqual(vars(en[k]))
      }
    })
  }
})

const ROWS = [{ m: 'Jan', v: 1200 }, { m: 'Feb', v: 3400 }, { m: 'Mar', v: 2800 }]

describe('charts', () => {
  it('Arabic: a translated chart name and summary with Arabic-Indic digits; the plot box is LTR', () => {
    ar(<Chart data={ROWS} x="m" series={[{ key: 'v', label: 'المبيعات' }]} />)
    const chart = screen.getByRole('group', { name: 'مخطط المبيعات' })
    expect(chart.getAttribute('aria-roledescription')).toBe('مخطط')
    expect(chart.getAttribute('dir')).toBe('ltr')
    expect(document.getElementById(chart.getAttribute('aria-describedby')!)!.textContent).toMatch(/٣ نقاط من Jan إلى Mar/)
  })

  it('RTL: arrows follow the plot (→ is the next point), not the reading direction', () => {
    ar(<Chart data={ROWS} x="m" series={[{ key: 'v', label: 'v' }]} />)
    const chart = screen.getByRole('group', { name: 'مخطط v' })
    fireEvent.keyDown(chart, { key: 'ArrowRight' }) // first press lands on the first point
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    expect(chart.textContent).toContain('Feb')
  })

  it('RTL: a BarList is a list, so ← moves forward', () => {
    ar(<BarList label="Top" items={[{ label: 'A', value: 3 }, { label: 'B', value: 2 }, { label: 'C', value: 1 }]} />)
    const list = screen.getByRole('group', { name: 'Top' })
    fireEvent.keyDown(list, { key: 'ArrowLeft' })
    fireEvent.keyDown(list, { key: 'ArrowLeft' })
    expect(list.textContent).toContain('٢ من ٣: B')
  })

  it('German: chart summaries and default number format follow the locale', () => {
    de(<Chart data={ROWS} x="m" series={[{ key: 'v', label: 'Umsatz' }]} />)
    const chart = screen.getByRole('group', { name: 'Diagramm Umsatz' })
    expect(document.getElementById(chart.getAttribute('aria-describedby')!)!.textContent).toMatch(/3 Punkte von Jan bis Mar\. Umsatz: 1200 bis 3400\./)
  })
})

describe('diagrams', () => {
  const phases = [{ id: 'p', name: 'Phase A', tasks: [{ id: 't', name: 'Task A', start: 0, duration: 3, progress: 0.5, owner: 'AL' }, { id: 'm', name: 'Go', start: 4, duration: 0, progress: 0, owner: 'AL' }] }]

  it('Gantt in Arabic: translated toolbar and bar labels; the grid is an LTR plot with locale-direction name cells', () => {
    ar(<Gantt phases={phases} dependencies={[['t', 'm']]} start={new Date(2026, 9, 19)} days={14} />)
    expect(screen.getByRole('button', { name: 'المسار الحرج' })).toBeTruthy()
    const bar = screen.getByRole('slider', { name: /^Task A، من .+ إلى .+، ٣ أيام\./ })
    expect(bar.closest('[dir="ltr"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'طي أو توسيع Phase A' }).closest('[dir]')!.getAttribute('dir')).toBe('rtl')
  })

  it('Gantt in RTL: → still moves a bar later (the timeline runs left to right)', () => {
    ar(<Gantt phases={phases} dependencies={[]} start={new Date(2026, 9, 19)} days={14} />)
    const bar = screen.getByRole('slider', { name: /^Task A/ })
    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    expect(bar.getAttribute('aria-valuenow')).toBe('1')
  })

  it('German state diagram and trace chrome', () => {
    de(<>
      <StateDiagram initial="a" states={{ a: { label: 'A', box: [0, 0, 80, 40] }, b: { label: 'B', box: [100, 0, 80, 40] } }}
        transitions={[{ event: 'go', from: 'a', to: 'b', d: 'M80 20H100', label: [90, 10, 'go'] }]} />
      <TraceWaterfall spans={[{ id: 'r', name: 'Run', kind: 'agent', start: 0, duration: 4 }]} total={4} />
    </>)
    expect(screen.getByText('Aktueller Zustand')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Zurücksetzen' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fehler simulieren' })).toBeTruthy()
    expect(screen.getByText('Dauer')).toBeTruthy()
  })
})

describe('media', () => {
  it('seek bars are LTR islands in RTL and → seeks forward', () => {
    const track = createAudioTrack('', 60)
    const seek = vi.spyOn(track, 'seek')
    ar(<MiniAudioPlayer track={track} title="حلقة" duration={60} />)
    const bar = screen.getByRole('slider', { name: 'التنقل' })
    expect(bar.getAttribute('dir')).toBe('ltr')
    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    expect(seek).toHaveBeenCalledWith(2)
    expect(screen.getByRole('button', { name: 'تشغيل حلقة' })).toBeTruthy()
  })

  it('carousel: in RTL ← goes to the next slide, which lies to the left (negative scrollLeft)', () => {
    const to = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: to })
    ar(<Carousel slides={[{ content: 'a' }, { content: 'b' }, { content: 'c' }]} />)
    const region = screen.getByRole('region', { name: 'عرض شرائح' })
    Object.defineProperty(region.querySelector('[aria-roledescription="slide"]')!, 'offsetWidth', { value: 300 })
    fireEvent.keyDown(region, { key: 'ArrowLeft' })
    expect(to).toHaveBeenCalledWith(expect.objectContaining({ left: -312 }))
    expect(screen.getByRole('button', { name: 'الشريحة التالية' })).toBeTruthy()
  })

  it('lightbox: in RTL ← shows the next image, and the counter uses Arabic digits', () => {
    const onIndex = vi.fn()
    ar(<Lightbox items={[1, 2, 3].map(i => ({ id: i, src: '', title: `P${i}`, ratio: 0.75 }))} index={0} onIndexChange={onIndex} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'عارض الصور' }).textContent).toContain('١ / ٣')
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })) })
    expect(onIndex).toHaveBeenCalledWith(1)
  })
})

describe('collaboration', () => {
  it('comments in Arabic: placeholders, button and new comments by the translated "you"', () => {
    const onChange = vi.fn()
    ar(<CommentThread comments={[]} onChange={onChange} />)
    const box = screen.getByPlaceholderText('أضف تعليقًا…')
    fireEvent.change(box, { target: { value: 'مرحبا' } })
    fireEvent.click(screen.getByRole('button', { name: 'إرسال' }))
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ author: 'أنت', time: 'الآن', text: 'مرحبا' })])
  })
})
