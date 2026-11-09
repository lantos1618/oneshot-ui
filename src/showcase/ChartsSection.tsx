import { useEffect, useMemo, useState } from 'react'
import {
  BarList, BoxViolinChart, BulletChart, Button, CalendarHeatmap, Chart, DensityHistogram, DonutChart, ForestPlot, FunnelChart, Gauge, Heatmap, LOCALE, RadarChart,
  RegressionChart, ScatterChart, SegmentedControl, Slider, SparkChart, SparkTile, Switch, TOUCH, TickerTable, Treemap, dayKey, describeSample, useViewport, type ChartDatum, type TickerRow,
} from '../lib'
import { Row, Section, Spec, SpecAction } from './kit'

/* Demo data mirrors the original page: same generators and seeds, so the shapes match. */
const chartsLcg = (seed: number) => () => (seed = (seed * 9301 + 49297) % 233280) / 233280
const chartsPark = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647
const statRnd = chartsPark(11)
const statNormal = () => Math.sqrt(-2 * Math.log(statRnd() + 1e-9)) * Math.cos(6.2832 * statRnd())
const CHART_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug']
const CHART_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// line with forecast band: actuals, a forecast from today and a widening 80% range, for each range
const FORECAST: Record<string, ChartDatum[]> = (() => {
  const rnd = chartsLcg(5), out: Record<string, ChartDatum[]> = {}
  for (const n of [7, 30, 90]) {
    let v = 50
    const a: number[] = [], lo: number[] = [], hi: number[] = [], fc: number[] = []
    for (let i = 0; i < n; i++) { v += (rnd() - 0.4) * 6; a.push(+v.toFixed(1)) }
    const f = Math.max(4, Math.round(n / 4))
    let c = v
    for (let i = 1; i <= f; i++) { c += 0.9; fc.push(+c.toFixed(1)); const w = 1.6 * Math.sqrt(i) * (n / 30 + 1); lo.push(+(c - w).toFixed(1)); hi.push(+(c + w).toFixed(1)) }
    const pad = (arr: number[]) => [...Array<null>(n - 1).fill(null), a[n - 1], ...arr]
    const H = pad(hi), Lo = pad(lo), F = pad(fc)
    out[`${n}D`] = Array.from({ length: n + f }, (_, i) => { const k = i - n + 1; return { d: k === 0 ? 'Today' : `${k > 0 ? '+' : ''}${k}d`, actual: i < n ? a[i] : null, forecast: F[i], lo: Lo[i], hi: H[i] } })
  }
  return out
})()
const QUARTERS = [['Q1', 32, 40], ['Q2', 45, 52], ['Q3', 41, 60], ['Q4', 58, 71]].map(([q, a, b]) => ({ q, y2025: a, y2026: b }))
const AREA = CHART_MONTHS.map((m, i) => ({ m, web: [12, 15, 14, 18, 20, 24, 23, 27][i], mobile: [8, 9, 11, 10, 13, 14, 16, 17][i], api: [5, 6, 6, 8, 9, 9, 11, 12][i] }))
const SCATTER = (() => { const r = chartsLcg(9); return Array.from({ length: 40 }, () => { const x = r() * 100; return { x: +x.toFixed(1), y: +(x * 0.6 + r() * 35).toFixed(1) } }) })()
const BUBBLES = [[20, 30, 10], [35, 55, 18], [50, 40, 8], [62, 70, 22], [75, 35, 12], [85, 60, 6], [40, 80, 14], [15, 65, 9]].map(([x, y, r]) => ({ x, y, r }))
const WATERFALL: ChartDatum[] = (() => {
  const steps: [string, number][] = [['Start', 40], ['New', 25], ['Churn', -10], ['Fees', -6], ['Upsell', 18]], rows: ChartDatum[] = []
  let run = 0
  steps.forEach(([l, v], i) => {
    if (i === 0) { rows.push({ l, from: 0, to: v, text: String(v), kind: 'total' }); run = v }
    else { rows.push({ l, from: run, to: run + v, text: (v > 0 ? '+' : '−') + Math.abs(v), kind: v >= 0 ? 'up' : 'down' }); run += v }
  })
  rows.push({ l: 'End', from: 0, to: run, text: String(run), kind: 'end' })
  return rows
})()
const WATERFALL_COLORS: Record<string, string> = { total: 'var(--line2)', up: 'var(--ok)', down: 'var(--bad)', end: 'var(--c-neutral)' }
const COMBO = CHART_DAYS.map((d, i) => ({ d, orders: [120, 150, 132, 170, 190, 90, 80][i], conv: [3.1, 3.4, 3.2, 3.9, 4.2, 2.8, 2.6][i] }))
const HISTOGRAM = Array.from({ length: 18 }, (_, i) => ({ b: `${i * 5}ms`, n: Math.round(60 * Math.exp(-(((i - 8) / 3.6) ** 2)) + (i % 3) * 2 + 2) }))
const CANDLES: ChartDatum[] = (() => {
  const r = chartsLcg(3), out: ChartDatum[] = []
  let p = 100
  for (let i = 0; i < 22; i++) { const o = p, c = p + (r() - 0.45) * 7, h = Math.max(o, c) + r() * 3, l = Math.min(o, c) - r() * 3; out.push({ t: i + 1, o, c, h, l }); p = c }
  return out
})()
// heatmap and calendar share one generator, in that order, like the original
const { HEAT, CALENDAR } = (() => {
  const R = chartsLcg(21)
  const HEAT = CHART_DAYS.map((_, y) => Array.from({ length: 12 }, (_, x) => Math.round(120 * Math.max(0.06, Math.min(1, (y < 5 ? 1 : 0.35) * Math.exp(-(((x - 5) / 3.5) ** 2)) * (0.6 + R() * 0.6))))))
  const CALENDAR: Record<string, number> = {}
  for (let w = 0; w < 26; w++) for (let d = 0; d < 7; d++) {
    const v = R(), lvl = v < 0.25 ? 0 : v < 0.55 ? 1 : v < 0.8 ? 2 : 3, extra = Math.floor(R() * 3)
    CALENDAR[dayKey(new Date(2026, 4, 11 + w * 7 + d))] = lvl ? [0, 2, 5, 9][lvl] + extra : 0
  }
  return { HEAT, CALENDAR }
})()
const TREEMAP_START = [['Engineering', 'var(--c2)', 42], ['Sales', 'var(--c3)', 24], ['Design', 'var(--c4)', 14], ['Ops', 'var(--c-neutral)', 11], ['Other', 'var(--fg3)', 9]].map(([label, color, value]) => ({ label: label as string, color: color as string, value: value as number }))
const TICKERS: TickerRow[] = ([['NOVA', 'Nova Systems', 142.3], ['QLX', 'Quill Labs', 58.9], ['ARC', 'Arcwise', 311.6], ['MRD', 'Meridian Co', 23.4], ['HLX', 'Helix Bio', 87.2]] as const).map(([symbol, name, p], k) => {
  const r = chartsPark(100 + k), a: number[] = []
  let x = p * 0.94
  for (let i = 0; i < 30; i++) { x *= 1 + (r() - 0.48) * 0.03; a.push(x) }
  a[29] = p
  return { symbol, name, data: a }
})
const SPARK_VARIANTS = (() => { const r = chartsPark(7), v: number[] = []; let x = 50; for (let i = 0; i < 28; i++) { x += (r() - 0.48) * 8; v.push(x) } return v })()

const EB_GROUPS = ['Control', 'Variant A', 'Variant B', 'Variant C'], EB_COLORS = ['var(--fg3)', 'var(--accent)', 'var(--c3)', 'var(--c4)']
const genErrorBars = () => EB_GROUPS.map((_, i) => { const n = 18 + Math.floor(statRnd() * 20), base = [42, 51, 47, 56][i]; return Array.from({ length: n }, () => base + statNormal() * (8 + i * 1.5)) })
const genRegression = () => { const a = 12 + statRnd() * 6, b = 1.4 + statRnd() * 0.8; return Array.from({ length: 46 }, () => { const x = statRnd() * 40 + 2; return [x, a + b * x + statNormal() * (6 + x * 0.12)] as [number, number] }) }
const BV_GROUPS = ['Mon', 'Tue', 'Wed', 'Thu'], BV_COLORS = ['var(--accent)', 'var(--c3)', 'var(--c4)', 'var(--warn)']
const genBoxes = () => BV_GROUPS.map((label, i) => {
  const c = [30, 40, 34, 46][i], a = Array.from({ length: 80 }, () => c + statNormal() * [6, 8, 5, 7][i])
  for (let k = 0; k < 2; k++) a.push(c + (statRnd() < 0.5 ? -1 : 1) * (22 + statRnd() * 8))
  return { label, color: BV_COLORS[i], values: a.map(v => Math.max(2, Math.min(78, v))) }
})
const genDensity = () => Array.from({ length: 400 }, () => (statRnd() < 0.7 ? 48 + statNormal() * 8 : 70 + statNormal() * 6))
const FP_SEGMENTS = ['New users', 'Returning', 'Mobile', 'Desktop', 'EU', 'US']
const genForest = () => FP_SEGMENTS.map(label => { const se = 0.015 + statRnd() * 0.03; return { label, effect: 0.035 + statNormal() * 0.035, se } })

/* Touch sizing for the demo buttons: ≥36px on coarse pointers (segments and sliders size themselves), desktop look unchanged. */
const CHART_TAP = TOUCH.tap36
const CHART_SEG = 'self-start'

// candlestick days as dates (fixed start, so server and client render the same labels)
const candleDate = (t: unknown) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(Date.UTC(2026, 9, 1) + (Number(t) - 1) * 864e5)
const ebNote = { sd: 'Standard deviation: spread of the data', se: 'Standard error: precision of the mean', ci: 'Non-overlapping 95% CIs suggest a real difference' }

export function ChartsSection() {
  const [range, setRange] = useState('30D')
  const [gauge, setGauge] = useState(68)
  const [ebData, setEbData] = useState(genErrorBars)
  const [ebMode, setEbMode] = useState<'sd' | 'se' | 'ci'>('ci')
  const [rgPts, setRgPts] = useState(genRegression)
  const [rgPI, setRgPI] = useState(true)
  const [bvData, setBvData] = useState(genBoxes)
  const [bvMode, setBvMode] = useState<'box' | 'violin' | 'both'>('both')
  const [hdData, setHdData] = useState(genDensity)
  const [hdBins, setHdBins] = useState(18)
  const [fpRows, setFpRows] = useState(genForest)

  const ebRows = useMemo(() => ebData.map((a, i) => {
    const s = describeSample(a), e = ebMode === 'sd' ? s.sd : ebMode === 'se' ? s.se : 1.96 * s.se
    return { g: EB_GROUPS[i], floor: 20, m: s.mean, lo: s.mean - e, hi: s.mean + e, e, n: s.n }
  }), [ebData, ebMode])

  return (
    <Section id="charts" title="Charts" desc="One SVG kit with shared scales, tooltip, legend and palette. Every chart draws in when it scrolls into view and morphs when its data changes.">
      <Spec title="Line with forecast band" desc="Actual, forecast and 80% range. Switch the range and the lines redraw." span={2}>
        <SegmentedControl aria-label="Range" options={['7D', '30D', '90D']} value={range} onChange={setRange} size="sm" className={CHART_SEG} />
        <Chart data={FORECAST[range]} x="d" curve="monotone" zero={false} band={{ lower: 'lo', upper: 'hi', label: '80% range' }}
          series={[{ key: 'actual', label: 'Actual', color: 'var(--c-neutral)' }, { key: 'forecast', label: 'Forecast', dashed: true, color: 'var(--c2)' }]} />
      </Spec>
      <Spec title="Bar" desc="Grouped comparison">
        <Chart data={QUARTERS} x="q" series={[{ key: 'y2025', label: '2025', type: 'bar', color: 'var(--line2)' }, { key: 'y2026', label: '2026', type: 'bar', color: 'var(--c2)' }]} />
      </Spec>
      <Spec title="Doughnut" desc="Share of total">
        <DonutChart centerLabel="Traffic"
          data={[{ label: 'Direct', value: 42, color: 'var(--c-neutral)' }, { label: 'Search', value: 28, color: 'var(--c2)' }, { label: 'Social', value: 18, color: 'var(--c3)' }, { label: 'Referral', value: 12, color: 'var(--c4)' }]} />
      </Spec>
      <Spec title="Stacked area" desc="Composition over time">
        <Chart data={AREA} x="m" stacked curve="monotone"
          series={[{ key: 'web', label: 'Web', type: 'area', color: 'var(--c2)' }, { key: 'mobile', label: 'Mobile', type: 'area', color: 'var(--c3)' }, { key: 'api', label: 'API', type: 'area', color: 'var(--c4)' }]} />
      </Spec>
      <Spec title="Radar" desc="Profile across axes. Hover or tap an axis.">
        <RadarChart axes={['Speed', 'Quality', 'Cost', 'Support', 'Docs', 'Scale']} max={100}
          series={[{ label: 'Ours', values: [80, 65, 70, 50, 85, 60], color: 'var(--c2)' }, { label: 'Competitor', values: [55, 80, 45, 75, 60, 70], color: 'var(--c3)', dashed: true, fill: false }]} />
      </Spec>
      <Spec title="Scatter" desc="Relationship between two values">
        <ScatterChart points={SCATTER} xDomain={[0, 100]} />
      </Spec>
      <Spec title="Sparkline tile" desc="One number that matters">
        <SparkTile label="Revenue" value={41280} format={{ style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }} data={[20, 22, 21, 25, 24, 28, 27, 30, 29, 33, 35, 34, 38, 41]} />
      </Spec>
      <Spec title="Waterfall" desc="How a total was built">
        <Chart data={WATERFALL} x="l" gap={0.38} domain={[0, 80]} legend={false}
          series={[{ key: 'to', from: 'from', type: 'float', label: 'Change', colorOf: d => WATERFALL_COLORS[String(d.kind)], connectors: true, labelOf: d => String(d.text) }]}
          tooltip={d => <><div className="mb-1 font-medium">{String(d.l)}</div><div className="text-[var(--fg2)]">{d.kind === 'total' || d.kind === 'end' ? <>Total <b className="ui-num text-[var(--fg)]">{d.to}</b></> : <><b className="ui-num text-[var(--fg)]">{d.text}</b> (running {d.to})</>}</div></>} />
      </Spec>
      <Spec title="Combo bar + line" desc="Volume and rate, two axes">
        <Chart data={COMBO} x="d" rightFormat={v => `${v}%`}
          series={[{ key: 'orders', label: 'Orders', type: 'bar', color: 'var(--line2)' }, { key: 'conv', label: 'Conversion %', color: 'var(--c2)', axis: 'right', points: true, curve: 'monotone' }]} />
      </Spec>
      <Spec title="Histogram" desc="Distribution of one variable">
        <Chart data={HISTOGRAM} x="b" gap={0} legend={false} series={[{ key: 'n', label: 'Requests', type: 'bar', color: 'var(--c2)' }]} />
      </Spec>
      <Spec title="Bubble" desc="Third variable as size">
        <ScatterChart points={BUBBLES} xDomain={[0, 100]} yDomain={[0, 100]} />
      </Spec>
      <Spec title="Funnel" desc="Drop-off through steps. Hover or tap a step.">
        <FunnelChart format={v => v.toLocaleString(LOCALE)} steps={[{ label: 'Visits', value: 10000 }, { label: 'Signups', value: 4100 }, { label: 'Activated', value: 1900 }, { label: 'Paid', value: 820 }]} />
      </Spec>
      <Spec title="Gauge" desc="One value against a target" actions={<SpecAction onClick={() => setGauge(Math.round(20 + Math.random() * 78))}>Randomise</SpecAction>}>
        <Gauge value={gauge} color="var(--c2)" label="of quarterly target" numberFormat={{ style: 'unit', unit: 'percent', maximumFractionDigits: 0 }} />
      </Spec>
      <Spec title="Candlestick" desc="Open, high, low, close">
        <Chart data={CANDLES} x="t" xFormat={candleDate} label="Candlestick: daily price" zero={false} gap={0.3} legend={false} rightFormat={v => v.toFixed(0)}
          series={[{ key: 'c', from: 'o', type: 'float', axis: 'right', label: 'Price', colorOf: d => (Number(d.c) >= Number(d.o) ? 'var(--ok)' : 'var(--bad)'), whisker: { low: 'l', high: 'h' } }]}
          tooltip={d => <>
            <div className="mb-1 font-medium">{candleDate(d.t)}</div>
            <div className="ui-num text-[var(--fg2)]">O <b className="text-[var(--fg)]">{Number(d.o).toFixed(1)}</b>  C <b className="text-[var(--fg)]">{Number(d.c).toFixed(1)}</b></div>
            <div className="ui-num text-[var(--fg2)]">H <b className="text-[var(--fg)]">{Number(d.h).toFixed(1)}</b>  L <b className="text-[var(--fg)]">{Number(d.l).toFixed(1)}</b></div>
          </>} />
      </Spec>
      <ChartsLiveSparks />
      <Spec title="Heatmap" desc="Activity by day and hour">
        <Heatmap cell={18} rows={CHART_DAYS} cols={Array.from({ length: 12 }, (_, i) => `${8 + i}h`)} value={(r, c) => HEAT[r][c]} color="var(--c2)"
          label={(r, c) => `${CHART_DAYS[r]} ${8 + c}:00`} format={n => `${n} events`} />
      </Spec>
      <Spec title="Calendar heatmap" desc="Daily contributions, last 26 weeks">
        <CalendarHeatmap values={CALENDAR} end={new Date(2026, 10, 8)} />
      </Spec>
      <ChartsTreemapDemo />
      <Spec title="Bullet" desc="Actual vs target, with bands">
        <BulletChart rows={[{ label: 'Revenue', value: 72, target: 85 }, { label: 'Margin', value: 58, target: 50 }, { label: 'NPS', value: 41, target: 60 }, { label: 'Retention', value: 88, target: 80 }]} />
      </Spec>
      <Spec title="Bar list" desc="Top countries">
        <BarList items={[{ label: '🇩🇪 Germany', value: 4210 }, { label: '🇺🇸 United States', value: 3880 }, { label: '🇬🇧 United Kingdom', value: 2140 }, { label: '🇫🇷 France', value: 1320 }, { label: '🇯🇵 Japan', value: 870 }]} />
      </Spec>
      <Spec title="Polar area" desc="Magnitude by category, radial">
        <DonutChart variant="polar" size={170}
          data={[{ label: 'Email', value: 42, color: 'var(--c2)' }, { label: 'Chat', value: 30, color: 'var(--c3)' }, { label: 'Phone', value: 18, color: 'var(--c4)' }, { label: 'Social', value: 24, color: 'var(--c-neutral)' }, { label: 'Docs', value: 12, color: 'var(--line2)' }]} />
      </Spec>
      <Spec title="Error bars" desc="Group means with uncertainty" actions={<SpecAction onClick={() => setEbData(genErrorBars())}>Resample</SpecAction>}>
        <SegmentedControl aria-label="Error bar" size="sm" className={CHART_SEG} value={ebMode} onChange={v => setEbMode(v as 'sd' | 'se' | 'ci')} options={[{ value: 'sd', label: 'SD' }, { value: 'se', label: 'SE' }, { value: 'ci', label: '95% CI' }]} />
        <Chart data={ebRows} x="g" height={190} domain={[20, 75]} zero={false} gap={0.55} legend={false} format={v => v.toFixed(0)}
          series={[{ key: 'm', from: 'floor', type: 'float', label: 'Mean', colorOf: (_, i) => EB_COLORS[i], whisker: { low: 'lo', high: 'hi', caps: true } }]}
          tooltip={d => <><div className="mb-1 font-medium">{d.g}</div><div className="ui-num">{Number(d.m).toFixed(1)} ± {Number(d.e).toFixed(1)} <span className="text-[var(--fg3)]">({ebMode === 'ci' ? '95% CI' : ebMode.toUpperCase()}, n={d.n})</span></div></>} />
        <span className="block min-h-[2lh] text-xs text-[var(--fg3)]">{ebNote[ebMode]}</span>
      </Spec>
      <Spec title="Box and violin" desc="Distributions per group, outliers marked" actions={<SpecAction onClick={() => setBvData(genBoxes())}>Resample</SpecAction>}>
        <SegmentedControl aria-label="Show" size="sm" className={CHART_SEG} value={bvMode} onChange={v => setBvMode(v as 'box' | 'violin' | 'both')} options={[{ value: 'box', label: 'Box' }, { value: 'violin', label: 'Violin' }, { value: 'both', label: 'Both' }]} />
        <BoxViolinChart groups={bvData} mode={bvMode} domain={[0, 80]} />
        <span className="text-xs text-[var(--fg3)]">Box: median, quartiles, 1.5 × IQR whiskers</span>
      </Spec>
      <Spec title="Histogram and density" desc="Kernel density, mean, median and ±1σ" actions={<SpecAction onClick={() => setHdData(genDensity())}>Resample</SpecAction>}>
        <DensityHistogram values={hdData} bins={hdBins} domain={[20, 100]} />
        <Slider label="Bins" min={6} max={40} value={hdBins} onChange={setHdBins} />
      </Spec>
      <Spec title="Regression with confidence band" desc="Least-squares fit, 95% band for the mean and a wider prediction interval" span={2}
        actions={<SpecAction onClick={() => setRgPts(genRegression())}>Resample</SpecAction>}>
        <Switch label={<span className="text-[13px] text-[var(--fg2)]">Prediction interval</span>} checked={rgPI} onChange={setRgPI} className="self-start" />
        <RegressionChart points={rgPts} prediction={rgPI} xDomain={[0, 44]} yDomain={[0, 110]} />
      </Spec>
      <Spec title="Forest plot" desc="Effect sizes with 95% intervals, pooled estimate" actions={<SpecAction onClick={() => setFpRows(genForest())}>Resample</SpecAction>}>
        <ForestPlot rows={fpRows} />
        <span className="text-xs text-[var(--fg3)]">Blue = significant (interval clears 0). Square size = weight. Tap a row for its interval.</span>
      </Spec>
    </Section>
  )
}

/** The live Sparklines demo. Its ticker state lives here, not in the section, and only ticks while it is on screen. */
function ChartsLiveSparks() {
  const { ref, visible: onScreen } = useViewport<HTMLDivElement>(null, { amount: 0 })
  const [tickers, setTickers] = useState(TICKERS)
  const [variants, setVariants] = useState(SPARK_VARIANTS)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused || !onScreen) return
    const id = setInterval(() => {
      if (document.hidden) return
      setTickers(rows => rows.map(r => ({ ...r, data: [...r.data.slice(1), r.data[r.data.length - 1] * (1 + (Math.random() - 0.48) * 0.025)] })))
      setVariants(v => [...v.slice(1), v[v.length - 1] + (Math.random() - 0.48) * 8])
    }, 1400)
    return () => clearInterval(id)
  }, [paused, onScreen])
  return (
        <Spec title="Sparklines" desc="Word-sized charts that live inside tables and tiles, updating live" span={3}
          actions={<Switch label={<span className="text-xs text-[var(--fg2)]">Live</span>} checked={!paused} onChange={v => setPaused(!v)} />}>
          <div ref={ref} className="flex flex-col gap-3">
          <TickerTable rows={tickers} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {([['Line with min / max', <SparkChart key="a" data={variants} minMax color="var(--fg2)" />], ['Bars', <SparkChart key="b" data={variants} variant="bars" />],
              ['Win / loss', <SparkChart key="c" data={variants} variant="winloss" />], ['Area with target', <SparkChart key="d" data={variants} variant="area" target={55} />]] as const).map(([t, chart]) => (
              <div key={t} className="flex flex-col gap-1 rounded-[var(--r-md)] border border-[var(--line)] px-2.5 py-2"><span className="text-[11px] text-[var(--fg3)]">{t}</span>{chart}</div>
            ))}
          </div>
          </div>
        </Spec>
  )
}

/** Treemap demo with Randomise / Grow / Shuffle and an auto-play that pauses while the card is off screen. */
function ChartsTreemapDemo() {
  const { ref, visible: onScreen } = useViewport<HTMLDivElement>(null, { amount: 0 })
  const [tm, setTm] = useState(TREEMAP_START)
  const [tmAuto, setTmAuto] = useState(false)
  const treemapAct = {
    randomise: () => setTm(t => t.map(x => ({ ...x, value: Math.round(4 + Math.random() * 36) }))),
    grow: () => setTm(t => { const k = Math.floor(Math.random() * t.length); return t.map((x, i) => ({ ...x, value: i === k ? Math.round(x.value * (1.6 + Math.random() * 0.8)) : Math.max(3, Math.round(x.value * (0.7 + Math.random() * 0.25))) })) }),
    shuffle: () => setTm(t => { const vs = t.map(x => x.value).sort(() => Math.random() - 0.5); return t.map((x, i) => ({ ...x, value: vs[i] })) }),
  }
  useEffect(() => {
    if (!tmAuto || !onScreen) return
    const id = setInterval(() => treemapAct[(['randomise', 'grow', 'shuffle', 'grow'] as const)[Math.floor(Math.random() * 4)]](), 2200)
    return () => clearInterval(id)
  }, [tmAuto, onScreen]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
        <Spec title="Treemap" desc="Hierarchy by area. Grow or shuffle the values, or turn on auto-play, and the layout re-flows."
          actions={<SpecAction onClick={treemapAct.randomise}>Randomise</SpecAction>}>
          <div ref={ref}><Treemap items={tm} height={170} show="percent" /></div>
          <Row className="gap-1.5">
            <Button size="sm" className={`!px-2.5 ${CHART_TAP}`} onClick={treemapAct.grow}>Grow one</Button>
            <Button size="sm" className={`!px-2.5 ${CHART_TAP}`} onClick={treemapAct.shuffle}>Shuffle</Button>
            <span className="flex-1" />
            <Switch label={<span className="text-xs text-[var(--fg2)]">Auto-play</span>} checked={tmAuto} onChange={v => { setTmAuto(v); if (v) treemapAct.grow() }} />
          </Row>
        </Spec>
  )
}
