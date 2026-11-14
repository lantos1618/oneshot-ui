// Package E (charts, timeline, annotate, vizkit): numeric regression tests for the chart scales, the stats charts, time
// axes, the chart shell's tooltip and the tag colours shared by charts and timelines.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BarList, BoxViolinChart, BulletChart, Chart, DensityHistogram, DonutChart, ForestPlot, FunnelChart, RegressionChart, Swimlanes, TickerTable,
  niceStep, tickDecimals, timeTicks, type TimeTag, type TimeTagKind,
} from '../../src/lib/all'
import { tagsDay } from '../../src/examples'

const W = 640
beforeEach(() => { vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(W) })
afterEach(() => vi.restoreAllMocks())

const texts = (root: ParentNode, sel = 'svg text') => [...root.querySelectorAll(sel)].map(t => t.textContent ?? '')
/** The data table of a chart (rendered for screen readers) as header names and rows of cell texts. */
function tableOf(name: RegExp | string) {
  const table = screen.getByRole('table', { name })
  const head = within(table).getAllByRole('columnheader').map(h => h.textContent ?? '')
  const rows = within(table).getAllByRole('row').slice(1).map(r => [...r.children].map(c => c.textContent ?? ''))
  return { head, rows, col: (h: string) => rows.map(r => r[head.indexOf(h)]) }
}
const pct = (s: string) => parseFloat(s.replace(/[^\d.-]/g, '')) / 100

describe('E-H1: Chart value axis', () => {
  it('all-negative data stays inside the plot (the top tick is 0)', () => {
    const data = [-87, -40, -5].map((v, i) => ({ m: `m${i}`, v }))
    const { container } = render(<Chart data={data} x="m" series={[{ key: 'v', type: 'bar' }]} legend={false} height={200} />)
    const ys = [...container.querySelectorAll('svg line')].map(l => Number(l.getAttribute('y1')))
    expect(ys.length).toBeGreaterThan(2)
    for (const y of ys) { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(200) }
  })
  it('`domain` ending at 0 keeps a usable scale', () => {
    const data = [-8, -3].map((v, i) => ({ m: `m${i}`, v }))
    const { container } = render(<Chart data={data} x="m" series={[{ key: 'v' }]} domain={[-10, 0]} zero={false} legend={false} height={200} />)
    // the value-axis labels span the domain, -10 at the bottom up to 0 at the top, on distinct rows inside the plot
    const ticks = [...container.querySelectorAll('svg text[text-anchor="end"]')].map(t => ({ v: Number(t.textContent), y: Number(t.getAttribute('y')) }))
    expect(ticks.length).toBeGreaterThanOrEqual(3)
    expect(ticks[0].v).toBe(-10)
    expect(ticks.at(-1)!.v).toBe(0)
    for (let i = 1; i < ticks.length; i++) { expect(ticks[i].v).toBeGreaterThan(ticks[i - 1].v); expect(ticks[i].y).toBeLessThan(ticks[i - 1].y) }
    for (const t of ticks) { expect(t.y).toBeGreaterThanOrEqual(0); expect(t.y).toBeLessThanOrEqual(200) }
  })
  it('`zero` puts 0 on the axis for all-negative data', () => {
    const data = [-87, -25].map((v, i) => ({ m: `m${i}`, v }))
    const { container } = render(<Chart data={data} x="m" series={[{ key: 'v' }]} legend={false} />)
    expect(texts(container, 'svg text[text-anchor="end"]')).toContain('0')
  })
})

describe('E-H2: FunnelChart', () => {
  it('an 8-step funnel still draws its last bar (opacity ≥ 0.4)', () => {
    const steps = Array.from({ length: 8 }, (_, i) => ({ label: `Step ${i + 1}`, value: 1000 - i * 100 }))
    const { container } = render(<FunnelChart steps={steps} />)
    const bars = [...container.querySelectorAll<HTMLElement>('[data-ci]')]
    expect(bars).toHaveLength(8)
    for (const b of bars) expect(Number(b.style.opacity)).toBeGreaterThanOrEqual(0.4)
  })
})

describe('E-H3: BoxViolinChart outliers', () => {
  const values = [...Array.from({ length: 90 }, (_, i) => i + 1), ...Array.from({ length: 10 }, (_, i) => 10_000 + i)]
  it('the table and the readout report every outlier, and the drawn dots say how many are left out', () => {
    const { container } = render(<BoxViolinChart groups={[{ label: 'A', values }]} label="Spread" />)
    expect(tableOf(/Spread/).col('Outliers')).toEqual(['10'])
    fireEvent.keyDown(screen.getByRole('group', { name: 'Spread' }), { key: 'ArrowRight' })
    expect(screen.getByRole('group', { name: 'Spread' })).toHaveTextContent('10 outliers')
    const shown = container.querySelectorAll('circle[fill="var(--bad)"]').length
    expect(shown).toBeLessThanOrEqual(10)
    if (shown < 10) expect(texts(container)).toContain(`+${10 - shown}`)
  })
  it('uses its `format` on the axis', () => {
    const { container } = render(<BoxViolinChart groups={[{ label: 'A', values: [1, 2, 3, 4, 5] }]} format={v => `${v}u`} />)
    const axis = texts(container, 'svg text[text-anchor="end"]')
    expect(axis.length).toBeGreaterThan(1)
    for (const l of axis) expect(l.endsWith('u')).toBe(true)
  })
})

describe('E-H4: DensityHistogram', () => {
  it('counts a value equal to the domain maximum', () => {
    render(<DensityHistogram values={[1, 4, 10]} domain={[0, 10]} bins={5} label="Scores" />)
    const counts = tableOf(/Scores/).col('Count').map(Number)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3)
    expect(counts.at(-1)).toBe(1)
  })
  it('without a domain the round maximum lands in the last bin', () => {
    render(<DensityHistogram values={[0, 20, 50, 100]} bins={10} label="Pct" />)
    expect(tableOf(/Pct/).col('Count').map(Number).reduce((a, b) => a + b, 0)).toBe(4)
  })
})

describe('E-H5: stats charts on fractional data', () => {
  it('Regression: y-axis labels on [0, 1] are distinct (decimals)', () => {
    const { container } = render(<RegressionChart points={[[0, 0.1], [0.25, 0.3], [0.5, 0.45], [0.75, 0.8], [1, 0.9]]} />)
    const y = texts(container, 'svg text[text-anchor="end"]')
    expect(y.length).toBeGreaterThan(2)
    expect(new Set(y).size).toBe(y.length)
  })
  it('Regression: the fitted band stays on the data (x in [0.001, 0.004])', () => {
    render(<RegressionChart label="Fit" points={[[0.001, 1], [0.002, 2], [0.003, 2.5], [0.004, 4]]} />)
    fireEvent.keyDown(screen.getByRole('group', { name: 'Fit' }), { key: 'ArrowRight' })
    const x = Number(/x = ([\d.]+)/.exec(screen.getByRole('tooltip').textContent ?? '')?.[1])
    expect(x).toBeGreaterThanOrEqual(0.001)
    expect(x).toBeLessThanOrEqual(0.004)
  })
  it('DensityHistogram: bin ranges on [0, 1] keep their decimals', () => {
    render(<DensityHistogram values={[0.05, 0.2, 0.22, 0.5, 0.9]} domain={[0, 1]} bins={5} label="Rates" />)
    const t = tableOf(/Rates/)
    expect(t.col('From')).toEqual(['0.0', '0.2', '0.4', '0.6', '0.8'])
    expect(t.col('Count').map(Number)).toEqual([1, 2, 1, 0, 1])
  })
})

describe('E-H6: ForestPlot domain', () => {
  const axis = (c: HTMLElement) => texts(c, 'svg text[text-anchor="middle"]').filter(s => s.endsWith('%')).map(pct)
  it('derives the domain from the 95% intervals, so [-5, 9] is covered by the ticks', () => {
    const { container } = render(<ForestPlot rows={[{ label: 'A', effect: 2, se: 7 / 1.96 }, { label: 'B', effect: 0.5, se: 0.5 }]} />)
    const ticks = axis(container)
    expect(Math.min(...ticks)).toBeLessThanOrEqual(-5)
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(9)
  })
  it('with only `domain`, the ticks lie inside it', () => {
    const { container } = render(<ForestPlot domain={[0, 0.05]} rows={[{ label: 'A', effect: 0.02, se: 0.005 }]} />)
    const ticks = axis(container)
    expect(ticks.length).toBeGreaterThan(1)
    for (const t of ticks) { expect(t).toBeGreaterThanOrEqual(0); expect(t).toBeLessThanOrEqual(0.05 + 1e-9) }
  })
  it('marks an interval that runs past the axis', () => {
    const { container } = render(<ForestPlot domain={[-0.1, 0.2]} rows={[{ label: 'A', effect: 0.5, se: 0.05 }, { label: 'B', effect: 0.05, se: 0.02 }]} />)
    expect(container.querySelectorAll('[data-clip]')).toHaveLength(1)
  })
})

describe('E-H7: day-step time axes', () => {
  const t0 = new Date(2026, 0, 5).getTime(), H = 3600e3
  it('a Chart spanning three days labels its ticks with dates', () => {
    const data = Array.from({ length: 13 }, (_, i) => ({ t: t0 + i * 6 * H, v: i }))
    const { container } = render(<Chart data={data} x="t" xTime series={[{ key: 'v' }]} legend={false} />)
    const labels = texts(container, 'svg text[text-anchor="middle"]')
    const dates = labels.filter(l => !/^\d{1,2}:\d{2}/.test(l))
    expect(dates.length).toBeGreaterThanOrEqual(2)
    expect(new Set(dates).size).toBe(dates.length)
  })
  it('timeTicks reports the unit and labels day ticks with the date', () => {
    const ticks = timeTicks(t0, t0 + 7 * 24 * H, 640)
    expect(ticks.length).toBeGreaterThan(1)
    expect(ticks.every(k => k.unit === 'day')).toBe(true)
    expect(new Set(ticks.map(k => k.label)).size).toBe(ticks.length)
  })
})

describe('E-H8: chart shell tooltip', () => {
  const rows = (v: number) => [{ label: 'A', value: v, target: 8 }, { label: 'B', value: 9, target: 7 }]
  it('the mouse leaving clears a keyboard tooltip', () => {
    render(<BulletChart rows={rows(5)} label="KPIs" />)
    const group = screen.getByRole('group', { name: 'KPIs' })
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(screen.getByRole('tooltip')).toHaveTextContent('A')
    fireEvent.pointerLeave(group, { pointerType: 'mouse' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
  it('the tooltip body follows live data, and goes when its point does', () => {
    const { rerender } = render(<BulletChart rows={rows(5)} label="KPIs" format={v => `${v} pts`} />)
    fireEvent.keyDown(screen.getByRole('group', { name: 'KPIs' }), { key: 'End' })
    expect(screen.getByRole('tooltip')).toHaveTextContent('9 pts')
    rerender(<BulletChart rows={[{ label: 'A', value: 5, target: 8 }, { label: 'B', value: 11, target: 7 }]} label="KPIs" format={v => `${v} pts`} />)
    expect(screen.getByRole('tooltip')).toHaveTextContent('11 pts')
    rerender(<BulletChart rows={rows(5).slice(0, 1)} label="KPIs" format={v => `${v} pts`} />)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

describe('E-H9: tag colours agree between Chart and Swimlanes', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 9, h, m).getTime()
  const kinds: TimeTagKind[] = [{ kind: 'water', label: 'Water' }, { kind: 'snack', label: 'Snack' }]
  const tags: TimeTag[] = [{ id: 'w', at: at(10, 40), kind: 'water', label: 'Water' }, { id: 's', at: at(14, 50), kind: 'snack', label: 'Snack' }]
  it('kinds without a colour get the same palette colour in both views', () => {
    const day = tagsDay('light')
    render(<>
      <Chart data={day.points} x="t" series={[{ key: 'points', type: 'area' }]} legend={false} annotations={{ tags, kinds, style: 'rug' }} />
      <Swimlanes tags={tags} kinds={kinds} start={at(9)} end={at(17, 30)} />
    </>)
    for (const [k, time] of [['Water', '10:40'], ['Snack', '14:50']]) {
      const glyph = screen.getByRole('option', { name: `${k} at ${time}` })
      const dot = screen.getByRole('button', { name: `${k}, ${time}` })
      expect(glyph.style.borderColor).toBe(dot.style.background)
    }
    expect(screen.getByRole('option', { name: 'Water at 10:40' }).style.borderColor).not.toBe(screen.getByRole('option', { name: 'Snack at 14:50' }).style.borderColor)
  })
})

describe('vizkit tick helpers', () => {
  it('tickDecimals follows the step', () => {
    expect([5, 1, 0.5, 0.2, 0.05, 0.001].map(tickDecimals)).toEqual([0, 0, 1, 1, 2, 3])
    expect(tickDecimals(niceStep(1, 5))).toBe(1)
  })
})

describe('E-M14 / E-M15: empty and zero data', () => {
  it('stats charts with no data say "No data." and draw no NaN', () => {
    const { container } = render(<>
      <RegressionChart points={[]} label="R" />
      <DensityHistogram values={[]} label="D" />
      <BoxViolinChart groups={[{ label: 'A', values: [] }]} label="B" />
    </>)
    for (const n of ['R', 'D', 'B']) expect(screen.getByRole('group', { name: n })).toHaveAccessibleDescription(/No data\./)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })
  it('a Donut of zeros shows a total of 0', () => {
    render(<DonutChart centerLabel="Traffic" data={[{ label: 'A', value: 0 }, { label: 'B', value: 0 }]} />)
    expect(screen.getByRole('group', { name: 'Traffic by share' })).toHaveAccessibleDescription(/total 0/)
  })
})

describe('E-M16: TickerTable', () => {
  it('has a header row, and every row owns only cells', () => {
    render(<TickerTable rows={[{ symbol: 'ACME', name: 'Acme Corp', data: [1, 2, 3] }, { symbol: 'INIT', name: 'Initech', data: [3, 2] }]} />)
    const table = screen.getByRole('table', { name: 'Prices' })
    const rows = within(table).getAllByRole('row')
    expect(within(rows[0]).getAllByRole('columnheader').length).toBe(5)
    for (const r of rows.slice(1)) for (const c of r.children) expect(c.getAttribute('role')).toBe('cell')
    expect(within(rows[1]).getAllByRole('cell')).toHaveLength(5)
  })
})

describe('E-M7 / E-M9: Swimlanes under a Chart', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 9, h, m).getTime()
  it('lines its lanes up with the gutter the Chart on top reports, and summarises with plural', () => {
    const data = [at(9), at(12), at(17)].map((t, i) => ({ t, v: [1250, 40, 900][i] }))
    const money = (v: number) => `USD ${v.toLocaleString('en')}.00`
    const { container } = render(<Swimlanes start={at(9)} end={at(17)} tags={[{ id: 'a', at: at(10), kind: 'water', label: 'Water' }]}
      top={<Chart data={data} x="t" xTime series={[{ key: 'v' }]} format={money} legend={false} />} />)
    const box = container.querySelector('[data-plot-inset]')!
    const inset = box.getAttribute('data-plot-inset')!.split(' ').map(Number)
    expect(inset[0]).toBeGreaterThan(40)
    const top = box.closest('[style*="margin-left"]') as HTMLElement
    expect(top.style.marginLeft).toContain(`${inset[0]}px`)
    expect(screen.getByRole('group', { name: 'Tags by kind' })).toHaveAccessibleDescription(/^1 tag from /)
  })
})

describe('E-L1: Home and End before any arrow', () => {
  it('End goes to the last point, not to `start`', () => {
    render(<BarList label="Pages" items={[{ label: 'a', value: 3 }, { label: 'b', value: 2 }, { label: 'c', value: 1 }]} />)
    const group = screen.getByRole('group', { name: 'Pages' })
    fireEvent.keyDown(group, { key: 'End' })
    expect(group).toHaveTextContent('3 of 3: c')
  })
})
