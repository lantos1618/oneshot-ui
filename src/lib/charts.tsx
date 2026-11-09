import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { motion } from 'motion/react'
import { AnimatedNumber, DeltaBadge, SparkChart, TOUCH, chartPath, type Curve, type UIDir, addDays, clamp, cn, dayKey, defineMessages, extent, fmt, isTouch, logicalArrow, maxOf, minOf, type MessageDefs, type MessageKeyOf, type MessageVars, onMouseLeave, prefersReducedMotion, releaseTouchCapture, safeColor, spring, startOfWeek, surface, useCoarsePointer, useControllable, useLocale, useMessages, useOutside, useWidth } from './core'
import { useTween, useViewport } from './motion'
import { ANNOTATE_MESSAGES, TAG_SR_ONLY, TagGlyph, TagTooltip, layoutTimeTags, timeTagLook, timeTagTint, timeTicks, useTagFocus, type TimeTag, type TimeTagKind, type TimeTagStyle } from './annotate'

/* ════════════════════════════════════════════════════════════════════════════
 * 13. CHARTS: one small SVG kit (no chart library). Every chart shares the palette,
 *     number formatting, sizing, tooltip surface and legend below. Charts draw from
 *     zero when they are first scrolled into view, then morph when their data changes.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Mid-grey series colour for "everything else" / baseline series (last year's bars, totals, other). It reads on cards in
 * light and dark, where `--fg`/`--c1` would glare white. Falls back to the muted text colour on themes without the token.
 */
export const CHART_NEUTRAL = 'var(--c-neutral, var(--muted-fg, var(--fg3)))'
/** Series colours, in order. Point these at your brand tokens. */
export const PALETTE = ['var(--c2)', 'var(--c3)', 'var(--c4)', CHART_NEUTRAL, 'var(--bad)', 'var(--warn)']
/** Compact numbers in en-GB: compact(12400) → "12.4K" (core fmt.compact). Charts default to the provider locale's (`useLocale().fmt.compact`). */
export const compact = fmt.compact

/**
 * Chart strings (summaries, tooltips, legends; machine-drafted de/ar). Series names, categories and axis titles are
 * data: pass them translated.
 *
 * Direction (0.4): every chart with an x scale (time or numbers) is an LTR plot in every locale, as in Excel, Google
 * Sheets and most BI tools: its box is `dir="ltr"`, the y axis stays on the left, ←/→ step through the points in the
 * plot's direction and tooltips prefer the reading side. Legends, captions, tooltips' text, footers and the
 * scale-free charts (BarList, FunnelChart) follow the locale; their ←/→ follow the reading direction.
 */
export const CHART_MESSAGES = defineMessages('chart', {
  en: {
    roledesc: 'chart', range: '{from} to {to}', noValues: 'no values', noData: 'No data.', data: 'Data', rangeLabel: 'Range',
    chartLabel: '{names} chart', pointsFromTo: '{n, plural, one {# point} other {# points}} from {from} to {to}.',
    seriesRange: '{name}: {range}.',
  },
  de: {
    roledesc: 'Diagramm', range: '{from} bis {to}', noValues: 'keine Werte', noData: 'Keine Daten.', data: 'Daten', rangeLabel: 'Bereich',
    chartLabel: 'Diagramm {names}', pointsFromTo: '{n, plural, one {# Punkt} other {# Punkte}} von {from} bis {to}.',
    seriesRange: '{name}: {range}.',
  },
  ar: {
    roledesc: 'مخطط', range: '{from} إلى {to}', noValues: 'لا قيم', noData: 'لا بيانات.', data: 'البيانات', rangeLabel: 'النطاق',
    chartLabel: 'مخطط {names}',
    pointsFromTo: '{n, plural, zero {لا نقاط} one {نقطة واحدة} two {نقطتان} few {# نقاط} many {# نقطة} other {# نقطة}} من {from} إلى {to}.',
    seriesRange: '{name}: {range}.',
  },
})
/** DonutChart (namespace 'chart'). */
export const CHART_DONUT_MESSAGES = defineMessages('chart', {
  en: {
    total: 'Total', polar: 'Polar area chart', byShare: '{label} by share',
    slices: '{n, plural, one {# slice} other {# slices}}, total {total}: {list}.', sliceText: '{label} {value} ({pct})',
    sliceDescribe: '{label}: {value}, {pct} of {total}',
  },
  de: {
    total: 'Gesamt', polar: 'Polarflächendiagramm', byShare: '{label} nach Anteil',
    slices: '{n, plural, one {# Segment} other {# Segmente}}, gesamt {total}: {list}.', sliceText: '{label} {value} ({pct})',
    sliceDescribe: '{label}: {value}, {pct} von {total}',
  },
  ar: {
    total: 'الإجمالي', polar: 'مخطط مساحي قطبي', byShare: '{label} حسب الحصة',
    slices: '{n, plural, one {شريحة واحدة} two {شريحتان} few {# شرائح} many {# شريحة} other {# شريحة}}، الإجمالي {total}: {list}.',
    sliceText: '{label} {value} ({pct})', sliceDescribe: '{label}: {value}، {pct} من {total}',
  },
})
/** Gauge (namespace 'chart'). */
export const CHART_GAUGE_MESSAGES = defineMessages('chart', {
  en: {
    gauge: 'Gauge',
  },
  de: {
    gauge: 'Anzeige',
  },
  ar: {
    gauge: 'مؤشر',
  },
})
/** RadarChart (namespace 'chart'). */
export const CHART_RADAR_MESSAGES = defineMessages('chart', {
  en: {
    radarLabel: 'Radar chart: {names}', axes: '{n, plural, one {# axis} other {# axes}}: {list}.',
  },
  de: {
    radarLabel: 'Netzdiagramm: {names}', axes: '{n, plural, one {# Achse} other {# Achsen}}: {list}.',
  },
  ar: {
    radarLabel: 'مخطط راداري: {names}',
    axes: '{n, plural, one {محور واحد} two {محوران} few {# محاور} many {# محورًا} other {# محور}}: {list}.',
  },
})
/** ScatterChart (namespace 'chart'). */
export const CHART_SCATTER_MESSAGES = defineMessages('chart', {
  en: {
    bubble: 'Bubble chart', scatter: 'Scatter plot', size: 'size', points: '{n, plural, one {# point} other {# points}}.',
    groups: 'Groups: {list}.', leftToRight: 'Arrow keys go left to right.',
  },
  de: {
    bubble: 'Blasendiagramm', scatter: 'Streudiagramm', size: 'Größe', points: '{n, plural, one {# Punkt} other {# Punkte}}.',
    groups: 'Gruppen: {list}.', leftToRight: 'Pfeiltasten gehen von links nach rechts.',
  },
  ar: {
    bubble: 'مخطط فقاعي', scatter: 'مخطط انتشار', size: 'الحجم',
    points: '{n, plural, zero {لا نقاط} one {نقطة واحدة} two {نقطتان} few {# نقاط} many {# نقطة} other {# نقطة}}.',
    groups: 'المجموعات: {list}.', leftToRight: 'تنتقل الأسهم من اليسار إلى اليمين.',
  },
})
/** Heatmap and CalendarHeatmap (namespace 'chart'). */
export const CHART_HEATMAP_MESSAGES = defineMessages('chart', {
  en: {
    heatmapName: 'Heatmap, {rows, plural, one {# row} other {# rows}} by {cols, plural, one {# column} other {# columns}}',
    heatSummary: 'Values {range}. Arrow keys read the cells.', tapCell: 'Tap a cell', hoverCell: 'Hover a cell',
    swipeMore: 'swipe for more', scrollMore: 'scroll for more', contributions: '{n, plural, one {# contribution} other {# contributions}}',
    lastWeeks: 'Contributions, last {n} weeks', less: 'Less', more: 'More',
  },
  de: {
    heatmapName: 'Heatmap, {rows, plural, one {# Zeile} other {# Zeilen}} × {cols, plural, one {# Spalte} other {# Spalten}}',
    heatSummary: 'Werte {range}. Pfeiltasten lesen die Zellen.', tapCell: 'Tippe auf eine Zelle', hoverCell: 'Zeige auf eine Zelle',
    swipeMore: 'wischen für mehr', scrollMore: 'scrollen für mehr', contributions: '{n, plural, one {# Beitrag} other {# Beiträge}}',
    lastWeeks: 'Beiträge der letzten {n} Wochen', less: 'Weniger', more: 'Mehr',
  },
  ar: {
    heatmapName: 'خريطة حرارية، {rows, plural, one {صف واحد} two {صفان} few {# صفوف} many {# صفًا} other {# صف}} × {cols, plural, one {عمود واحد} two {عمودان} few {# أعمدة} many {# عمودًا} other {# عمود}}',
    heatSummary: 'القيم {range}. تقرأ الأسهم الخلايا.', tapCell: 'انقر على خلية', hoverCell: 'مرّر المؤشر فوق خلية',
    swipeMore: 'اسحب للمزيد', scrollMore: 'مرّر للمزيد',
    contributions: '{n, plural, zero {لا مساهمات} one {مساهمة واحدة} two {مساهمتان} few {# مساهمات} many {# مساهمة} other {# مساهمة}}',
    lastWeeks: 'المساهمات، آخر {n} أسبوعًا', less: 'أقل', more: 'أكثر',
  },
})
/** FunnelChart (namespace 'chart'). */
export const CHART_FUNNEL_MESSAGES = defineMessages('chart', {
  en: {
    funnel: 'Funnel', count: 'Count', ofFirst: 'Of first step', steps: '{n, plural, one {# step} other {# steps}}: {list}.',
    reachLast: '{pct} reach the last step.', stepDescribe: '{label}: {value}, {pct} of the first step',
    ofBefore: '{pct} of the step before',
  },
  de: {
    funnel: 'Trichter', count: 'Anzahl', ofFirst: 'Vom ersten Schritt', steps: '{n, plural, one {# Schritt} other {# Schritte}}: {list}.',
    reachLast: '{pct} erreichen den letzten Schritt.', stepDescribe: '{label}: {value}, {pct} des ersten Schritts',
    ofBefore: '{pct} des vorigen Schritts',
  },
  ar: {
    funnel: 'مسار التحويل', count: 'العدد', ofFirst: 'من الخطوة الأولى',
    steps: '{n, plural, one {خطوة واحدة} two {خطوتان} few {# خطوات} many {# خطوة} other {# خطوة}}: {list}.',
    reachLast: '{pct} يصلون إلى الخطوة الأخيرة.', stepDescribe: '{label}: {value}، {pct} من الخطوة الأولى',
    ofBefore: '{pct} من الخطوة السابقة',
  },
})
/** BarList (namespace 'chart'). */
export const CHART_BARLIST_MESSAGES = defineMessages('chart', {
  en: {
    ranked: 'Ranked list', items: '{n, plural, one {# item} other {# items}}, {range}.', itemDescribe: '{i} of {n}: {label} {value}',
  },
  de: {
    ranked: 'Rangliste', items: '{n, plural, one {# Eintrag} other {# Einträge}}, {range}.', itemDescribe: '{i} von {n}: {label} {value}',
  },
  ar: {
    ranked: 'قائمة مرتّبة', items: '{n, plural, one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصرًا} other {# عنصر}}، {range}.',
    itemDescribe: '{i} من {n}: {label} {value}',
  },
})
/** Treemap (namespace 'chart'). */
export const CHART_TREEMAP_MESSAGES = defineMessages('chart', {
  en: {
    treemap: 'Treemap', parts: '{n, plural, one {# part} other {# parts}}, largest first: {list}.',
  },
  de: {
    treemap: 'Treemap', parts: '{n, plural, one {# Teil} other {# Teile}}, größte zuerst: {list}.',
  },
  ar: {
    treemap: 'خريطة شجرية',
    parts: '{n, plural, one {جزء واحد} two {جزآن} few {# أجزاء} many {# جزءًا} other {# جزء}}، الأكبر أولًا: {list}.',
  },
})
/** SparkTile and TickerTable (namespace 'chart'). */
export const CHART_SPARK_MESSAGES = defineMessages('chart', {
  en: {
    pointOf: 'Point {i} of {n}',
    trend: 'Trend of {n, plural, one {# point} other {# points}}, {range}, {up, select, yes {up} other {down}} {pct} from the first.',
    noTrend: 'No trend data.', prices: 'Prices', upSince: 'Up since the first price shown', downSince: 'Down since the first price shown',
  },
  de: {
    pointOf: 'Punkt {i} von {n}',
    trend: 'Verlauf aus {n, plural, one {# Punkt} other {# Punkten}}, {range}, {up, select, yes {plus} other {minus}} {pct} seit dem ersten.',
    noTrend: 'Keine Verlaufsdaten.', prices: 'Kurse', upSince: 'Gestiegen seit dem ersten angezeigten Kurs',
    downSince: 'Gefallen seit dem ersten angezeigten Kurs',
  },
  ar: {
    pointOf: 'النقطة {i} من {n}',
    trend: 'اتجاه من {n, plural, one {نقطة واحدة} two {نقطتين} few {# نقاط} many {# نقطة} other {# نقطة}}، {range}، {up, select, yes {ارتفاع} other {انخفاض}} {pct} منذ الأولى.',
    noTrend: 'لا بيانات للاتجاه.', prices: 'الأسعار', upSince: 'ارتفع منذ أول سعر معروض', downSince: 'انخفض منذ أول سعر معروض',
  },
})
/** BulletChart (namespace 'chart'). */
export const CHART_BULLET_MESSAGES = defineMessages('chart', {
  en: {
    bullet: 'Bullet chart', actual: 'Actual', target: 'Target',
    measures: '{n, plural, one {# measure} other {# measures}} against targets. {met} of {n} meet their target.',
    measureDescribe: '{label}: {value}, target {target}, {met, select, yes {met} other {below target}}',
  },
  de: {
    bullet: 'Bullet-Diagramm', actual: 'Ist', target: 'Ziel',
    measures: '{n, plural, one {# Kennzahl} other {# Kennzahlen}} gegen Ziele. {met} von {n} erreichen ihr Ziel.',
    measureDescribe: '{label}: {value}, Ziel {target}, {met, select, yes {erreicht} other {unter dem Ziel}}',
  },
  ar: {
    bullet: 'مخطط نقطي', actual: 'الفعلي', target: 'الهدف',
    measures: '{n, plural, one {مقياس واحد} two {مقياسان} few {# مقاييس} many {# مقياسًا} other {# مقياس}} مقابل الأهداف. {met} من {n} تحقق هدفها.',
    measureDescribe: '{label}: {value}، الهدف {target}، {met, select, yes {محقق} other {دون الهدف}}',
  },
})
/** RegressionChart (namespace 'chart'). */
export const CHART_REGRESSION_MESSAGES = defineMessages('chart', {
  en: {
    regression: 'Regression chart', ci95: '95% CI', prediction: 'Prediction',
    regSummary: '{n, plural, one {# point} other {# points}}. Fitted line y = {a} + {b}x, R² {r2}. Arrow keys walk the fitted line.',
    regDescribe: 'x {x}: fitted {y}, 95% CI plus or minus {ci}', regPred: 'prediction plus or minus {p}', slope: 'slope',
    intercept: 'intercept', residualSE: 'residual SE', xEq: 'x = {x}',
  },
  de: {
    regression: 'Regressionsdiagramm', ci95: '95-%-KI', prediction: 'Vorhersage',
    regSummary: '{n, plural, one {# Punkt} other {# Punkte}}. Ausgleichsgerade y = {a} + {b}x, R² {r2}. Pfeiltasten folgen der Geraden.',
    regDescribe: 'x {x}: geschätzt {y}, 95-%-KI plus/minus {ci}', regPred: 'Vorhersage plus/minus {p}', slope: 'Steigung',
    intercept: 'Achsenabschnitt', residualSE: 'Residual-SE', xEq: 'x = {x}',
  },
  ar: {
    regression: 'مخطط انحدار', ci95: 'فاصل ثقة 95%', prediction: 'التنبؤ',
    regSummary: '{n, plural, one {نقطة واحدة} two {نقطتان} few {# نقاط} many {# نقطة} other {# نقطة}}. خط الملاءمة y = {a} + {b}x، R² {r2}. تتبع الأسهم الخط.',
    regDescribe: 'x {x}: القيمة المقدّرة {y}، فاصل ثقة 95% زائد أو ناقص {ci}', regPred: 'التنبؤ زائد أو ناقص {p}', slope: 'الميل',
    intercept: 'المقطع', residualSE: 'الخطأ المعياري للبواقي', xEq: 'x = {x}',
  },
})
/** BoxViolinChart (namespace 'chart'). */
export const CHART_BOX_MESSAGES = defineMessages('chart', {
  en: {
    boxViolin: 'Box and violin chart', median: 'median', iqr: 'IQR', whiskers: 'whiskers', outlier: 'outlier',
    boxGroups: '{n, plural, one {# group} other {# groups}}: {list}.', boxMedian: '{label} median {v}',
    boxDescribe: '{label}: median {q2}, quartiles {q1} to {q3}, whiskers {lo} to {hi}',
    outliers: '{n, plural, one {# outlier} other {# outliers}}',
  },
  de: {
    boxViolin: 'Box- und Violinplot', median: 'Median', iqr: 'IQR', whiskers: 'Whisker', outlier: 'Ausreißer',
    boxGroups: '{n, plural, one {# Gruppe} other {# Gruppen}}: {list}.', boxMedian: '{label} Median {v}',
    boxDescribe: '{label}: Median {q2}, Quartile {q1} bis {q3}, Whisker {lo} bis {hi}',
    outliers: '{n, plural, one {# Ausreißer} other {# Ausreißer}}',
  },
  ar: {
    boxViolin: 'مخطط صندوقي وكماني', median: 'الوسيط', iqr: 'المدى الربيعي', whiskers: 'الشعيرات', outlier: 'قيمة شاذة',
    boxGroups: '{n, plural, one {مجموعة واحدة} two {مجموعتان} few {# مجموعات} many {# مجموعة} other {# مجموعة}}: {list}.',
    boxMedian: '{label} الوسيط {v}', boxDescribe: '{label}: الوسيط {q2}، الربيعيات {q1} إلى {q3}، الشعيرات {lo} إلى {hi}',
    outliers: '{n, plural, one {قيمة شاذة واحدة} two {قيمتان شاذتان} few {# قيم شاذة} many {# قيمة شاذة} other {# قيمة شاذة}}',
  },
})
/** DensityHistogram (namespace 'chart'). */
export const CHART_HISTOGRAM_MESSAGES = defineMessages('chart', {
  en: {
    histogram: 'Histogram with density curve', values: 'values',
    histSummary: '{n, plural, one {# value} other {# values}} in {bins} bins from {lo} to {hi}. Mean {m}, median {md}, standard deviation {sd}.',
    binDescribe: '{lo} to {hi}: {n, plural, one {# value} other {# values}}', meanV: 'mean {v}', medianV: 'median {v}', sigmaV: 'σ {v}',
  },
  de: {
    histogram: 'Histogramm mit Dichtekurve', values: 'Werte',
    histSummary: '{n, plural, one {# Wert} other {# Werte}} in {bins} Klassen von {lo} bis {hi}. Mittelwert {m}, Median {md}, Standardabweichung {sd}.',
    binDescribe: '{lo} bis {hi}: {n, plural, one {# Wert} other {# Werte}}', meanV: 'Mittel {v}', medianV: 'Median {v}', sigmaV: 'σ {v}',
  },
  ar: {
    histogram: 'مدرج تكراري مع منحنى الكثافة', values: 'القيم',
    histSummary: '{n, plural, one {قيمة واحدة} two {قيمتان} few {# قيم} many {# قيمة} other {# قيمة}} في {bins} فئة من {lo} إلى {hi}. المتوسط {m}، الوسيط {md}، الانحراف المعياري {sd}.',
    binDescribe: '{lo} إلى {hi}: {n, plural, zero {لا قيم} one {قيمة واحدة} two {قيمتان} few {# قيم} many {# قيمة} other {# قيمة}}',
    meanV: 'المتوسط {v}', medianV: 'الوسيط {v}', sigmaV: 'σ {v}',
  },
})
/** ForestPlot (namespace 'chart'). */
export const CHART_FOREST_MESSAGES = defineMessages('chart', {
  en: {
    segment: 'Segment', lift: 'Lift [95% CI]', worse: '← worse', better: 'better →', forest: 'Forest plot',
    ciText: '{effect}, 95% CI {lo} to {hi}', significant: 'significant', notSignificant: 'not significant', weight: 'weight {pct}',
    pooledIV: 'Pooled (inverse-variance)', pooled: 'Pooled',
    forestSummary: '{n, plural, one {# row} other {# rows}} and a pooled estimate of {p}. {k} of {n} intervals clear zero.',
    forestDescribe: '{label}: {effect}, 95% interval {lo} to {hi}, {sig}', pooledDescribe: 'Pooled: {effect}, 95% interval {lo} to {hi}',
  },
  de: {
    segment: 'Segment', lift: 'Uplift [95-%-KI]', worse: '← schlechter', better: 'besser →', forest: 'Forest-Plot',
    ciText: '{effect}, 95-%-KI {lo} bis {hi}', significant: 'signifikant', notSignificant: 'nicht signifikant', weight: 'Gewicht {pct}',
    pooledIV: 'Gepoolt (inverse Varianz)', pooled: 'Gepoolt',
    forestSummary: '{n, plural, one {# Zeile} other {# Zeilen}} und eine gepoolte Schätzung von {p}. {k} von {n} Intervallen schließen null aus.',
    forestDescribe: '{label}: {effect}, 95-%-Intervall {lo} bis {hi}, {sig}',
    pooledDescribe: 'Gepoolt: {effect}, 95-%-Intervall {lo} bis {hi}',
  },
  ar: {
    segment: 'الشريحة', lift: 'التحسّن [فاصل ثقة 95%]', worse: '← أسوأ', better: 'أفضل →', forest: 'مخطط الغابة',
    ciText: '{effect}، فاصل ثقة 95% من {lo} إلى {hi}', significant: 'دال إحصائيًا', notSignificant: 'غير دال إحصائيًا',
    weight: 'الوزن {pct}', pooledIV: 'مجمّع (التباين العكسي)', pooled: 'مجمّع',
    forestSummary: '{n, plural, one {صف واحد} two {صفان} few {# صفوف} many {# صفًا} other {# صف}} وتقدير مجمّع قدره {p}. {k} من {n} فواصل لا تتضمن الصفر.',
    forestDescribe: '{label}: {effect}، فاصل 95% من {lo} إلى {hi}، {sig}', pooledDescribe: 'مجمّع: {effect}، فاصل 95% من {lo} إلى {hi}',
  },
})

/** The provider's locale for charts: messages, formatters, direction and the summary helpers. */
function useChartLocale<K extends string = never>(own?: MessageDefs<K>) {
  const { fmt, dir, locale, weekStartsOn } = useLocale(), kit = useMessages(CHART_MESSAGES), mine = useMessages<string>((own ?? CHART_MESSAGES) as MessageDefs<string>)
  // each chart carries only its own catalog plus the shared kit, so a drop-in file doesn't embed every chart's strings
  const cm = (key: K | MessageKeyOf<typeof CHART_MESSAGES>, vars?: MessageVars) => own && key in own.en ? mine(key, vars) : kit(key as MessageKeyOf<typeof CHART_MESSAGES>, vars)
  /** Fixed decimals in the locale: fixed(1.234, 2) → "1.23" / "1,23" / "١٫٢٣". */
  const fixed = (v: number, d = 1) => fmt.number(Math.round(v * 10 ** d) / 10 ** d, { minimumFractionDigits: d, maximumFractionDigits: d })
  /** "a to b" range text for the summaries. */
  const range = (vals: number[], f: (n: number) => string) => { const v = vals.filter(Number.isFinite); return v.length ? cm('range', { from: f(minOf(v)), to: f(maxOf(v)) }) : cm('noValues') }
  /** Whole-number percent of a fraction: 0.42 → "42%" / "42 %" / "٤٢٪". */
  const pct = (f: number) => fmt.percent(Number.isFinite(f) ? f : 0, 0)
  return { cm, fmt, dir, locale, weekStartsOn, fixed, range, pct }
}
/** Room for the widest y-tick label (Arabic compact numbers such as "١٢٫٤ ألف" are wider than "12.4K"). */
const chartAxisPad = (labels: string[], min = 40) => Math.max(min, Math.ceil(maxOf(labels.map(s => s.length), 0) * 6.2 + 12))
/**
 * One row of chart data: the x label plus one field per series. Chart is generic over its rows, so typed rows
 * (interfaces included) work too and `x` / `series[].key` are checked against their keys; this is the untyped default.
 */
export type ChartDatum = Record<string, string | number | null | undefined>

/* ── Draw-in stagger ─────────────────────────────────────────────────────────
 * Several charts often scroll into view in the same frame. Starting all their draw-in animations inside the
 * IntersectionObserver callback made one long frame (200 ms+). Instead each chart queues its reveal and the queue
 * releases one chart per ~50 ms, outside the observer callback. */
const chartRevealQueue: (() => void)[] = []
let chartRevealTimer = 0
function chartRevealPump() {
  chartRevealTimer = 0
  chartRevealQueue.shift()?.()
  if (chartRevealQueue.length) chartRevealTimer = window.setTimeout(chartRevealPump, 50)
}
/** `seen`, released through the shared stagger queue (immediately for reduced motion and when nothing is queued). */
function useChartReveal(seen: boolean) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!seen || shown) return
    let live = true
    const go = () => { if (live) setShown(true) }
    if (prefersReducedMotion()) { go(); return }
    chartRevealQueue.push(go)
    if (!chartRevealTimer) chartRevealTimer = window.setTimeout(chartRevealPump, 0)
    return () => { live = false; const k = chartRevealQueue.indexOf(go); if (k >= 0) chartRevealQueue.splice(k, 1) }
  }, [seen, shown])
  return shown
}

/** Ref, width and a flag that turns true once the element has scrolled into view (charts draw from zero until then). */
function useChartFrame<T extends HTMLElement>(amount = 0.25) {
  const [ref, w] = useWidth<T>()
  const { seen } = useViewport(ref, { amount })
  return [ref, w, useChartReveal(seen)] as const
}
/** Ref plus the scrolled-into-view flag. */
function useChartSeen<T extends Element>(amount = 0.25) {
  const { ref, seen } = useViewport<T>(null, { amount })
  return [ref, useChartReveal(seen)] as const
}

/* ── Keyboard: one focus model for every chart ──────────────────────────────── */

/** Options of useChartFocus. */
export type ChartFocusOptions = {
  /** number of points (in a grid: rows × columns, row by row) */
  count: number
  /** the active point (the chart's hover index), or null */
  index: number | null
  /** set the active point; null clears it */
  onIndex: (i: number | null) => void
  /** accessible name of the chart */
  label: string
  /** one or two sentences describing the data, read after the name (aria-describedby) */
  summary: string
  /** what a screen reader hears when the keyboard lands on point `i` */
  describe: (i: number) => string
  /** grid charts (heatmaps): points per row, so ↑/↓ move by a row and Home/End stay in the row */
  columns?: number
  /** the point the first arrow press lands on (default 0) */
  start?: number
  /**
   * Which way ←/→ step: 'ltr' (default) for plots, which run left to right in every locale; pass the locale's dir
   * for charts that mirror (lists such as BarList), so ← moves forward in RTL.
   */
  dir?: UIDir
}
/**
 * The keyboard model every chart shares. The chart is one Tab stop (role=group, roledescription "chart", a name and an
 * aria-describedby data summary). ←/→ step through the points (↑/↓ too, or by a row in a grid), Home/End jump to the
 * ends and Escape clears. The active point is the chart's own hover index, so the same tooltip and highlight show for
 * keyboard users, and each move is announced in a polite live region. Tab focus lands on the first point; a mouse click
 * doesn't. Spread `props` on the focusable box and render `a11y` inside it.
 */
export function useChartFocus({ count, index, onIndex, label, summary, describe, columns, start = 0, dir = 'ltr' }: ChartFocusOptions) {
  const id = useId()
  const cm = useMessages(CHART_MESSAGES)
  const [live, setLive] = useState('')
  const go = (i: number) => { onIndex(i); setLive(describe(i)) }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!count || e.altKey || e.ctrlKey || e.metaKey) return
    if (e.key === 'Escape') { if (index !== null) { e.preventDefault(); onIndex(null); setLive('') } return }
    const c = columns && columns > 0 ? columns : 0, cur = index === null || index >= count ? null : index
    const row = c && cur !== null ? cur - (cur % c) : 0
    let next: number | null = null
    switch (logicalArrow(e.key, dir)) {
      case 'ArrowRight': next = cur === null ? start : c ? (cur % c < c - 1 ? cur + 1 : cur) : cur + 1; break // rtl-lint-ignore: LTR plot (logicalArrow above)
      case 'ArrowLeft': next = cur === null ? start : c ? (cur % c > 0 ? cur - 1 : cur) : cur - 1; break
      case 'ArrowDown': next = cur === null ? start : cur + (c || 1); break
      case 'ArrowUp': next = cur === null ? start : cur - (c || 1); break
      case 'Home': next = c ? row : 0; break
      case 'End': next = c ? Math.min(count - 1, row + c - 1) : count - 1; break
      default: return
    }
    e.preventDefault()
    if (cur !== null && (next < 0 || next >= count)) next = cur
    go(clamp(next, 0, count - 1))
  }
  const props = {
    tabIndex: 0, role: 'group', 'aria-roledescription': cm('roledesc'), 'aria-label': label, 'aria-describedby': `${id}-sum`, onKeyDown,
    onFocus: (e: ReactFocusEvent<HTMLElement>) => { if (e.target === e.currentTarget && index === null && count && e.currentTarget.matches(':focus-visible')) go(clamp(start, 0, count - 1)) },
    onBlur: (e: ReactFocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { onIndex(null); setLive('') } },
  }
  const a11y = <><span id={`${id}-sum`} className="sr-only">{summary}</span><span className="sr-only" aria-live="polite">{live}</span></>
  return { props, a11y }
}
/** Focus ring for a chart's focusable box (the active point carries the second, data-level mark). */
const CHART_FOCUS = 'rounded-[var(--r-md)] outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]'
/** Ease numbers to `to` in 250 ms; `snap`, the value after a snap and reduced motion jump. */
function useChartEase(to: number[], snap: boolean) {
  const [v, setV] = useState(to), cur = useRef<number[] | null>(null), key = to.join(), jump = snap || !cur.current
  useEffect(() => {
    const from = cur.current
    if (jump || !from || prefersReducedMotion()) { cur.current = snap ? null : to; setV(to); return }
    const t0 = performance.now()
    let raf = 0
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / 250), e = 1 - (1 - u) ** 3
      cur.current = to.map((x, i) => from[i] + (x - from[i]) * e); setV(cur.current)
      if (u < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [key, jump]) // eslint-disable-line react-hooks/exhaustive-deps
  return jump ? to : v
}
/** A hover index that is dropped (not left dangling) when the data shrinks under it. */
const chartIndex = (i: number | null, n: number) => (i !== null && i >= 0 && i < n ? i : null)

/** Round axis ticks: niceTicks(0, 87) → [0, 20, 40, 60, 80, 100] */
export function niceTicks(min: number, max: number, count = 4) {
  const raw = (max - min || 1) / count, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag
  const step = (f >= 7.5 ? 10 : f >= 3.5 ? 5 : f >= 1.5 ? 2 : 1) * mag
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step
  return Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => +(lo + i * step).toFixed(10))
}
/**
 * At most `max` items of `data`, evenly spaced and always keeping the first and last (simple stride downsampling).
 * Returns `data` itself when it is already small enough or `max` isn't a positive number.
 */
export function chartDownsample<T>(data: T[], max?: number): T[] {
  if (!max || !Number.isFinite(max) || max < 2 || data.length <= max) return data
  const out: T[] = [], step = (data.length - 1) / (Math.floor(max) - 1)
  for (let i = 0; i < Math.floor(max); i++) out.push(data[Math.round(i * step)])
  return out
}
const p1 = (n: number) => n.toFixed(1)
const linePath = (pts: [number, number][]) => chartPath(pts)
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

/* ── Touch: hover-driven chart state that also works by tap ─────────────────
 * A finger fires pointerenter → pointerdown → pointerup → pointerleave, so a tap would show and instantly clear
 * a hover readout. Charts ignore that trailing leave for touch (core onMouseLeave) and dismiss on the next tap
 * outside or Escape instead (core useOutside). */
/**
 * Tooltip inside a chart's relative box (the in-box sibling of overlay's PointerTooltip, same surface): sits on the
 * reading side of x (right, or left in RTL), flips when there is no room and is clamped to the box, gliding between
 * points. `x` is physical (plot coordinates); the text follows the locale's direction.
 */
function ChartTooltip({ x, y, children, width }: { x: number; y: number; children: ReactNode; width: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const { dir } = useLocale()
  const [tw, setTw] = useState(150)
  useLayoutEffect(() => { const w = ref.current?.offsetWidth; if (w && Math.abs(w - tw) > 1) setTw(w) })
  const fitsR = x + 12 + tw <= width, fitsL = x - 12 - tw >= -8
  const right = dir === 'rtl' ? !fitsL && fitsR : fitsR || !fitsL
  const left = clamp(right ? x + 12 : x - 12 - tw, Math.min(0, width - tw), width - tw)
  return (
    <motion.div ref={ref} role="tooltip" dir={dir} className={cn(surface.floating, 'pointer-events-none absolute z-10 w-max max-w-[min(300px,calc(100vw-40px))] min-w-[120px] rounded-[var(--r-md)] px-2.5 py-1.5 text-xs')}
      initial={false} animate={{ left, top: y }} transition={spring(0.1, 0.25)}>
      {children}
    </motion.div>
  )
}
function TooltipRow({ color, label, value, dashed }: { color: string; label: ReactNode; value: ReactNode; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('h-2 w-2 rounded-[var(--r-sm)]', dashed && 'border border-dashed bg-transparent')} style={dashed ? { borderColor: safeColor(color) } : { background: safeColor(color) }} />
      <span className="flex-1 text-[var(--fg2)]">{label}</span><b className="ui-num font-medium">{value}</b>
    </div>
  )
}
/**
 * Tooltip that follows the pointer inside a chart's relative container: [tip, bind(() => content)].
 * A tap shows it too (lifted above the finger) and it stays until the next tap outside the chart.
 */
function useChartTip(ref: RefObject<HTMLElement | null>) {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null)
  const place = (e: ReactPointerEvent, body: () => ReactNode) => { const r = ref.current?.getBoundingClientRect(); if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top - (isTouch(e) ? 70 : 34), body: body() }) }
  useOutside([ref], () => setTip(null), !!tip, { escape: true })
  const bind = (body: () => ReactNode, onEnter?: () => void) => ({
    onPointerDown: (e: ReactPointerEvent) => { releaseTouchCapture(e); place(e, body); onEnter?.() },
    onPointerMove: (e: ReactPointerEvent) => place(e, body),
    onPointerEnter: onEnter,
    onPointerLeave: onMouseLeave(() => setTip(null)),
  })
  /** Keyboard: show `body` over the element marked data-ci={i} (read on the key press, never during mount). */
  const at = (i: number | null, body?: () => ReactNode) => {
    const box = ref.current, el = i === null ? null : box?.querySelector(`[data-ci="${i}"]`)
    if (!box || !el || !body) { setTip(null); return }
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect()
    setTip({ x: r.left - b.left + Math.min(r.width / 2, 60), y: r.top - b.top - 34, body: body() })
  }
  return [tip, bind, setTip, at] as const
}

/** Legend row: swatch per series; `dashed` draws a dashed line, `band` a shaded range. */
export function Legend({ items, className }: { items: { label: string; color: string; dashed?: boolean; band?: boolean }[]; className?: string }) {
  return (
    <div className={cn('mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--fg2)]', className)}>
      {items.map(it => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className={cn('inline-block', it.band ? 'h-2.5 w-3.5 rounded-[var(--r-sm)] bg-[var(--band)]' : it.dashed ? 'w-3.5 border-t-2 border-dashed' : 'h-2.5 w-2.5 rounded-[var(--r-sm)]')}
            style={it.band ? undefined : it.dashed ? { borderColor: safeColor(it.color) } : { background: safeColor(it.color) }} />{it.label}
        </span>
      ))}
    </div>
  )
}

/** One series of a Chart. `T` is the row type, so `key`, `from` and the whisker fields are checked against its keys. */
export type Series<T extends object = ChartDatum> = {
  key: keyof T & string; label?: string; type?: 'line' | 'area' | 'bar' | 'float'; color?: string; dashed?: boolean
  /** Which y-axis the series is measured on. A right axis appears as soon as one series uses it. */
  axis?: 'left' | 'right'
  /** Overrides the chart's `curve` for this series. */
  curve?: Curve
  /** Marker on every point (lines and areas). */
  points?: boolean
  /** Floating bar: spans data[from] → data[key] (waterfall steps, candle bodies, error-bar means). */
  from?: keyof T & string
  /** Line through the bar centre from data[low] to data[high]. Without caps it's a wick (drawn behind), with caps an error bar (drawn on top). */
  whisker?: { low: keyof T & string; high: keyof T & string; caps?: boolean; color?: string }
  /** Per-bar colour, e.g. up/down. */
  colorOf?: (d: T, i: number) => string
  /** Dashed connector from the end of each bar to the next one. */
  connectors?: boolean
  /** Small label above each bar, e.g. '+25'. */
  labelOf?: (d: T, i: number) => string | null
}
/**
 * Tags on a time-axis Chart. `style` 'auto' (default: pins → rug → rollup by width and density, see layoutTimeTags),
 * 'pins', 'rug', 'flags', 'rollup' or 'dots'; the room a style may need is reserved, so switching never moves the plot.
 * `spans: 'bands'` (default) shades durations. `activeId`/`onActiveChange` link to a list; `onSelect` runs on click,
 * Enter or a second tap; `label` names the tag list ("Tags").
 */
export type ChartAnnotations = {
  tags: TimeTag[]; kinds?: TimeTagKind[]; style?: TimeTagStyle; spans?: 'bands' | 'none'; activeId?: string | null
  onActiveChange?: (id: string | null) => void; onSelect?: (tag: TimeTag) => void; label?: string
  /** 'current' (default): room for the shown style's rows, eased when data or width change it. 'max': room for every style, so the height never changes: use it for live or streaming data. */
  reserve?: 'current' | 'max'
}
/** Props of Chart over rows of type `T`. */
export type ChartProps<T extends object = ChartDatum> = {
  data: T[]; x: NoInfer<keyof T & string>; series: Series<NoInfer<T>>[]; height?: number; stacked?: boolean
  band?: { lower: NoInfer<keyof T & string>; upper: NoInfer<keyof T & string>; label?: string }; gap?: number
  format?: (n: number) => string; rightFormat?: (n: number) => string; legend?: boolean; curve?: Curve
  /** Include 0 in the value axis (default). Turn off for prices. */
  zero?: boolean
  /** Minimum left-axis range, like a suggested min/max. */
  domain?: [number, number]
  tooltip?: (d: NoInfer<T>, i: number) => ReactNode
  /**
   * Draw at most this many rows (evenly sampled, first and last kept) so very long series stay fast. Off by default;
   * with it on, tooltip indexes refer to the sampled rows.
   */
  maxPoints?: number
  /** Accessible name (default: the series labels, e.g. "2025 and 2026 chart"). */
  label?: string
  /** Data summary read after the name (default: the x range and each series' range). */
  summary?: string
  /** Formats the x values for the axis, the tooltip header and the keyboard readout (e.g. day numbers → dates). */
  xFormat?: (v: NoInfer<T>[keyof T], i: number) => string
  /** Time x axis (rows placed by time, clock ticks): `true` reads epoch ms/Dates from `x`, or map a row. On with `annotations` over numeric/Date x. */
  xTime?: boolean | ((d: NoInfer<T>) => number | Date)
  /** tags over time (point events and spans); needs a time x axis */
  annotations?: ChartAnnotations
  className?: string
}

/**
 * The cartesian chart. Mix series types freely:
 *   line                     <Chart data x="month" series={[{ key: 'revenue' }]} curve="monotone" />
 *   stacked area             series={[{ key: 'a', type: 'area' }, { key: 'b', type: 'area' }]} stacked
 *   grouped / stacked bars   series={[{ key: 'a', type: 'bar' }, { key: 'b', type: 'bar' }]} (stacked)
 *   combo, two axes          series={[{ key: 'orders', type: 'bar' }, { key: 'rate', axis: 'right', points: true }]}
 *   forecast / confidence    band={{ lower: 'lo', upper: 'hi' }} plus a dashed series; nulls leave gaps
 *   histogram                bars with gap={0} (1px separators)
 *   waterfall                { type: 'float', from: 'start', key: 'end', connectors: true, labelOf, colorOf }
 *   candlestick              { type: 'float', from: 'open', key: 'close', whisker: { low: 'low', high: 'high' }, axis: 'right' }
 *   error bars               { type: 'float', from: 'floor', key: 'mean', whisker: { low: 'lo', high: 'hi', caps: true } }
 * Hover, tap or drag a finger sideways for a crosshair and tooltip (`tooltip` replaces its body); tap outside to dismiss.
 * Keyboard: the chart is one Tab stop; arrows, Home and End move the same crosshair and tooltip (useChartFocus).
 * Draws in when scrolled into view.
 */
export function Chart<T extends object = ChartDatum>({ data: allRows, x, series, height = 220, stacked, band, gap = 0.3, format: formatProp, rightFormat, legend = true, curve = 'linear', zero = true, domain, tooltip, maxPoints, label, summary, xFormat, xTime, annotations: A, className }: ChartProps<T>) {
  const { cm, fmt: lf, range } = useChartLocale()
  const format = formatProp ?? lf.compact
  const data = useMemo(() => chartDownsample(allRows, maxPoints), [allRows, maxPoints])
  const [ref, w, seen] = useChartFrame<HTMLDivElement>()
  const [hoverAt, setHover] = useState<number | null>(null)
  const hover = chartIndex(hoverAt, data.length)
  const val = (d: T, k: keyof T | undefined) => (k === undefined ? null : num(d[k]))
  const S = series.map((s, i) => ({ ...s, type: s.type ?? 'line', color: s.color ?? PALETTE[i % PALETTE.length], label: s.label ?? s.key, axis: s.axis ?? 'left', curve: s.curve ?? curve }))
  type RS = (typeof S)[number]
  const hasL = S.some(s => s.axis === 'left'), hasR = S.some(s => s.axis === 'right')
  // annotations reserve their room for every style they may switch to (no layout shift): pins headroom on top, the rug/rollup band below
  // annotations add headroom (pins, flags) and a band under the axis (rug, rollup); set once the layout is known, below
  const aStyle = A?.style ?? 'auto', ROW = 23
  const pad = { l: 8, r: 10, t: S.some(s => s.labelOf) ? 22 : 10, b: 24 }
  let ih = height - pad.t - pad.b
  const n = data.length, slots = S.filter(s => s.type === 'bar' || s.type === 'float'), banded = slots.length > 0
  // stacking: each series sits on the sum of the stackable series before it (same type, same axis)
  const base = (i: number, si: number) => stacked ? S.slice(0, si).filter(s => s.type === S[si].type && s.axis === S[si].axis).reduce((a, s) => a + (num(data[i][s.key]) ?? 0), 0) : 0
  const top = (i: number, si: number) => { const v = num(data[i][S[si].key]); return v === null ? null : v + base(i, si) }
  const scale = (side: 'left' | 'right', dom?: [number, number]) => {
    const v = data.flatMap((d, i) => S.flatMap((s, si) => s.axis !== side ? [] : [top(i, si), s.from ? num(d[s.from]) : null, s.whisker ? num(d[s.whisker.low]) : null, s.whisker ? num(d[s.whisker.high]) : null])
      .concat(side === 'left' && band ? [num(d[band.lower]), num(d[band.upper])] : [])).filter((q): q is number => q !== null && Number.isFinite(q))
    if (!v.length && !dom) return null
    const lo = minOf(v, Math.min(dom?.[0] ?? Infinity, zero ? 0 : Infinity)), hi = maxOf(v, dom?.[1] ?? -Infinity)
    const ticks = niceTicks(lo, hi), y0 = ticks[0], y1 = ticks[ticks.length - 1]
    return { ticks, Y: (val: number) => pad.t + ih - ((val - y0) / (y1 - y0 || 1)) * ih, rest: y0 <= 0 && y1 >= 0 ? 0 : y0 }
  }
  const L = hasL ? scale('left', domain) : null, R = hasR ? scale('right') : null, G = L ?? R
  // the axes take the room their widest tick label needs (Arabic compact numbers run longer than "12.4K")
  if (L) pad.l = chartAxisPad(L.ticks.map(format))
  if (R) pad.r = chartAxisPad(R.ticks.map(rightFormat ?? format))
  const iw = Math.max(0, w - pad.l - pad.r)
  const sc = (s: RS) => (s.axis === 'right' ? R : L) ?? G!
  const step = iw / Math.max(1, banded ? n : n - 1)
  // time x axis: rows placed by time; tx(ms) maps any time (a tag) onto the plot
  const v0: unknown = data[0]?.[x]
  const timeOf = typeof xTime === 'function' ? (d: T) => +xTime(d) : xTime || (xTime === undefined && A && (typeof v0 === 'number' || v0 instanceof Date)) ? (d: T) => +(d[x] as number | Date) : null
  const T = timeOf ? data.map(timeOf) : null
  const t0 = T?.[0] ?? 0, t1 = T?.[n - 1] ?? 1, linT = (ms: number) => pad.l + ((ms - t0) / (t1 - t0 || 1)) * iw
  /** fractional row index of a time (binary search over the rows' times) */
  const fracAt = (ms: number) => {
    if (!T || n < 2 || ms <= T[0]) return 0
    let lo = 0, hi = n - 1
    if (ms >= T[hi]) return hi
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= ms) lo = mid; else hi = mid }
    return lo + (ms - T[lo]) / (T[hi] - T[lo] || 1)
  }
  const X = (i: number) => (T && !banded ? linT(T[i]) : pad.l + (banded ? step * (i + 0.5) : step * i))
  const tx = (ms: number) => (banded ? pad.l + step * (fracAt(ms) + 0.5) : linT(ms))
  const xText = (i: number) => (xFormat ? xFormat(data[i][x], i) : T ? lf.time(T[i]) : String(data[i][x] ?? ''))
  // skip x labels that would collide: show every Nth (N from a tidy 1, 2, 3, 4, 5, 6, 10… set) so each one gets
  // its estimated 11px width plus a gap. Dense charts (histograms with gap={0}) rely on this.
  const labelW = maxOf(data.map((_, i) => xText(i).length), 0) * 6.6 + 10
  const need = Math.max(1, Math.ceil(labelW / (step || 1)))
  const every = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 25, 50, 100].find(k => k >= need) ?? need
  const runs = (si: number) => { // indices of each unbroken run of non-null values (nulls leave gaps)
    const out: number[][] = [[]]
    data.forEach((_, i) => { if (top(i, si) === null) { if (out[out.length - 1].length) out.push([]) } else out[out.length - 1].push(i) })
    return out.filter(r => r.length)
  }
  const slotW = (step * (1 - gap)) / (stacked ? 1 : slots.length || 1)
  const bw = Math.max(1, gap ? slotW - 1 : slotW), rx = gap ? Math.min(4, bw / 4) : 0
  const bx = (i: number, s: RS) => X(i) - (step * (1 - gap)) / 2 + (stacked ? 0 : slots.indexOf(s) * slotW)
  const span = (i: number, si: number): [number, number] | null => {
    const s = S[si]
    if (s.type === 'float') { const a = val(data[i], s.from), b = num(data[i][s.key]); return a === null || b === null ? null : [a, b] }
    const v = top(i, si); return v === null ? null : [base(i, si), v]
  }
  const fmtOf = (s: RS) => (s.axis === 'right' ? rightFormat ?? format : format)
  const pick = (px: number) => setHover(Math.max(0, Math.min(n - 1, Math.round(T && !banded ? fracAt(t0 + ((px - pad.l) / (iw || 1)) * (t1 - t0)) : (px - pad.l - (banded ? step / 2 : 0)) / step))))
  useOutside([ref], () => setHover(null), hover !== null, { escape: true })
  const valueText = (i: number, si: number) => {
    const s = S[si]
    if (s.type === 'float') { const sp = span(i, si); return sp && cm('range', { from: fmtOf(s)(sp[0]), to: fmtOf(s)(sp[1]) }) }
    const v = num(data[i][s.key]); return v === null ? null : fmtOf(s)(v)
  }
  const names = S.map(s => s.label)
  const focus = useChartFocus({
    count: n, index: hover, onIndex: setHover,
    label: label ?? cm('chartLabel', { names: names.length ? lf.list(names) : cm('data') }),
    summary: summary ?? (n ? [cm('pointsFromTo', { n, from: xText(0), to: xText(n - 1) }), ...S.map(s => cm('seriesRange', { name: s.label, range: range(data.map((_, i) => s.type === 'float' ? num(data[i][s.key]) ?? NaN : top(i, S.indexOf(s)) ?? NaN), fmtOf(s)) }))].join(' ') : cm('noData')),
    describe: i => `${xText(i)}: ${S.map((s, si) => { const v = valueText(i, si); return v === null ? null : `${s.label} ${v}` }).filter(Boolean).join(', ')}`,
  })
  /* ── annotations: tags over time (annotate.tsx) ── */
  const am = useMessages(ANNOTATE_MESSAGES)
  const aTags = !A ? [] : A.spans === 'none' ? A.tags.filter(t => t.end === undefined) : A.tags
  const [activeAt, setActiveRaw] = useControllable<string | null>(A?.activeId, null, A?.onActiveChange)
  const setActive = (id: string | null) => { if (id !== activeAt) setActiveRaw(id) }
  const tags = useTagFocus({ tags: aTags, activeId: activeAt, onActive: setActive, onSelect: A?.onSelect, label: A?.label })
  const tl = A && T && iw > 0 ? layoutTimeTags(aTags, { x: tx, width: w - pad.r, style: aStyle, domain: [t0, t1] }) : null
  // room for the tags: 'max' every style it may switch to; 'current' the shown style's rows, eased when they change
  const aMax = !tl || A?.reserve === 'max', st = aMax ? aStyle : tl.style, rows = aMax ? 3 : Math.max(1, tl.rows)
  const want = !A ? [0, 0] : [st === 'pins' ? 8 + (aMax && st === aStyle ? 3 : rows) * ROW : st === 'auto' ? 8 + 2 * ROW : st === 'flags' ? 24 : 6, /auto|rug|rollup/.test(st) ? rows * ROW + 6 : 0]
  const [aTop, aBand] = useChartEase(want, aMax)
  pad.t += aTop; ih = height - pad.t - pad.b
  const s0 = S.findIndex(s => s.type === 'line' || s.type === 'area')
  /** y of the first line series at a time (interpolated), or the plot floor */
  const lineY = (ms: number) => {
    const f = fracAt(ms), i = Math.floor(f), a = s0 < 0 || !n ? null : top(i, s0), b = s0 < 0 || !n ? null : top(Math.min(n - 1, i + 1), s0)
    const v = a === null ? b : b === null ? a : a + (b - a) * (f - i)
    return v === null ? pad.t + ih : sc(S[s0]).Y(v)
  }
  const pinY = (ms: number, row: number) => Math.max(10, lineY(ms) - 17 - row * ROW), rugY = (row: number) => height + 4 + ROW / 2 + row * ROW
  const look = (t: TimeTag) => timeTagLook(t, A?.kinds)
  const placed = tl?.points.find(p => p.tag.id === activeAt), host = placed?.hidden ? tl!.points.find(p => p.more?.includes(placed.tag.id)) : placed
  const aSpan = tl?.spans.find(p => p.tag.id === activeAt), aBin = placed?.bin !== undefined ? tl!.bins[placed.bin] : undefined
  const activeTag = placed?.tag ?? aSpan?.tag ?? null
  const anchor = !tl ? null : aSpan ? { x: clamp((aSpan.x0 + aSpan.x1) / 2, pad.l, w - pad.r), y: pad.t } : !host ? null
    : { x: aBin ? aBin.x : host.x, y: aBin ? rugY(aBin.row) : tl.style === 'pins' ? pinY(host.ms, host.row) : tl.style === 'rug' ? rugY(host.row) : tl.style === 'flags' ? pad.t : lineY(host.ms) }
  useOutside([ref], () => setActive(null), !!activeTag, { escape: true })
  const tap = useRef({ type: '', was: false })
  const tagPtr = (t: TimeTag) => ({
    onPointerEnter: (e: ReactPointerEvent) => { if (!isTouch(e)) { setHover(null); setActive(t.id) } },
    onPointerLeave: onMouseLeave(() => setActive(null)),
    onPointerDown: (e: ReactPointerEvent) => { tap.current = { type: e.pointerType, was: activeAt === t.id }; releaseTouchCapture(e); setHover(null); setActive(t.id) },
    onClick: () => { if (tap.current.type !== 'touch' || tap.current.was) A?.onSelect?.(t) },
  })
  const fade = { opacity: seen ? 1 : 0, transition: 'opacity .3s' }
  const whiskers = (caps: boolean) => S.map(s => s.whisker && !!s.whisker.caps === caps && data.map((d, i) => {
    const lo = num(d[s.whisker!.low]), hi = num(d[s.whisker!.high]), mid = num(d[s.key]); if (lo === null || hi === null || mid === null) return null
    const { Y } = sc(s), cx = bx(i, s) + bw / 2, cw = Math.min(7, bw / 2)
    const path = (a: number, b: number) => `M${p1(cx)},${p1(a)}L${p1(cx)},${p1(b)}` + (caps ? `M${p1(cx - cw)},${p1(a)}L${p1(cx + cw)},${p1(a)}M${p1(cx - cw)},${p1(b)}L${p1(cx + cw)},${p1(b)}` : '')
    return <motion.path key={`w${s.key}${i}`} fill="none" stroke={s.whisker!.color ?? (caps ? 'var(--fg2)' : s.colorOf?.(d, i) ?? s.color)} strokeWidth={1.5} strokeLinecap="round"
      initial={{ d: path(Y(mid), Y(mid)) }} animate={{ d: seen ? path(Y(lo), Y(hi)) : path(Y(mid), Y(mid)), opacity: hover === null || hover === i ? 1 : 0.55 }} transition={{ ...spring(0.15, 0.6), delay: seen ? 0.15 : 0 }} />
  }))
  return (
    <div className={className}>
      {/* an LTR plot in every locale (see CHART_MESSAGES); legend and tooltip text follow the locale */}
      <div ref={ref} {...focus.props} dir="ltr" className={cn('relative', CHART_FOCUS)} style={{ height: height + aBand }} onPointerLeave={onMouseLeave(() => setHover(null))}>
        {focus.a11y}
        {w > 0 && G && (
          <svg width={w} height={height + aBand} aria-hidden className="block touch-pan-y overflow-visible text-[11px]"
            onPointerDown={e => pick(e.clientX - e.currentTarget.getBoundingClientRect().left)} onPointerMove={e => pick(e.clientX - e.currentTarget.getBoundingClientRect().left)}>
            {G.ticks.map(t => (
              <line key={t} x1={pad.l} x2={w - pad.r} y1={G.Y(t)} y2={G.Y(t)} stroke="var(--line)" strokeDasharray={t === 0 ? undefined : '3 3'} />
            ))}
            {L && L.ticks.map(t => <text key={t} x={pad.l - 8} y={L.Y(t)} dy="0.32em" textAnchor="end" fill="var(--fg3)">{format(t)}</text>)}
            {R && R.ticks.map(t => <text key={t} x={w - pad.r + 8} y={R.Y(t)} dy="0.32em" fill="var(--fg3)">{(rightFormat ?? format)(t)}</text>)}
            {T && n > 1 ? timeTicks(t0, t1, iw, ms => lf.time(ms), Math.max(56, lf.time(t0).length * 6.6 + 18)).map(k => <g key={k.ms}>
              <line x1={tx(k.ms)} x2={tx(k.ms)} y1={pad.t} y2={pad.t + ih} stroke="var(--line)" strokeOpacity={0.6} />
              <text x={tx(k.ms)} y={height - 6} textAnchor="middle" fill="var(--fg3)">{k.label}</text>
            </g>) : data.map((_, i) => i % every === 0 && <text key={i} x={X(i)} y={height - 6} textAnchor="middle" fill="var(--fg3)">{xText(i)}</text>)}
            {tl && <g style={fade}>
              {tl.spans.map(p => { const c = look(p.tag).color, on = p.tag.id === activeAt; return <g key={p.tag.id}>
                <rect x={p.x0} y={pad.t} width={Math.max(1, p.x1 - p.x0)} height={ih} fill={c} fillOpacity={on ? 0.24 : 0.1} />
                <rect x={p.x0} y={pad.t} width={Math.max(1, p.x1 - p.x0)} height={3} fill={c} />
              </g> })}
              {tl.style === 'flags' && tl.points.map(p => <line key={p.tag.id} x1={p.x} x2={p.x} y1={pad.t - (p.flag ? 4 : 10)} y2={pad.t + ih} stroke={look(p.tag).color} strokeDasharray="3 3" strokeOpacity={p.tag.id === activeAt ? 1 : 0.7} strokeWidth={p.tag.id === activeAt ? 2 : 1} />)}
              {aBin && <rect x={tx(aBin.from)} y={pad.t} width={Math.max(1, tx(aBin.to) - tx(aBin.from))} height={ih} fill="var(--line)" fillOpacity={0.5} />}
            </g>}
            {band && L && (() => {
              const pts = data.map((d, i) => [i, num(d[band.lower]), num(d[band.upper])] as const).filter(p => p[1] !== null && p[2] !== null)
              const dd = chartPath(pts.map(p => [X(p[0]), L.Y(p[2]!)]), curve) + chartPath(pts.slice().reverse().map(p => [X(p[0]), L.Y(p[1]!)]), curve, true) + 'Z'
              return <motion.path key={`band${pts.length}`} initial={{ d: dd, opacity: 0 }} animate={{ d: dd, opacity: seen ? 1 : 0 }} fill="var(--band)" transition={spring(0.1, 0.6)} />
            })()}
            {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--line2)" />}
            {whiskers(false)}
            {S.map((s, si) => (s.type === 'bar' || s.type === 'float') && data.map((d, i) => {
              const sp = span(i, si); if (!sp) return null
              const { Y } = sc(s), ya = Y(sp[0]), yb = Y(sp[1])
              return <motion.rect key={`${s.key}${i}`} x={bx(i, s)} width={bw} rx={rx} fill={s.colorOf?.(d, i) ?? s.color} stroke={gap ? undefined : 'var(--card)'} strokeWidth={gap ? undefined : 1}
                initial={{ y: ya, height: 0 }} animate={seen ? { y: Math.min(ya, yb), height: Math.max(1, Math.abs(ya - yb)), opacity: hover === null || hover === i ? 1 : 0.55 } : { y: ya, height: 0 }}
                transition={{ ...spring(0.15, 0.55), delay: Math.min(0.3, i * 0.025) }} />
            }))}
            {S.map(s => s.connectors && data.slice(0, -1).map((d, i) => {
              const v = num(d[s.key]); if (v === null) return null
              const y = sc(s).Y(v)
              return <motion.line key={`c${s.key}${i}`} x1={bx(i, s) + bw} x2={bx(i + 1, s)} y1={y} y2={y} stroke="var(--fg3)" strokeDasharray="3 3"
                initial={{ opacity: 0 }} animate={{ opacity: seen ? 1 : 0, y1: y, y2: y }} transition={{ duration: 0.3, delay: seen ? 0.45 : 0 }} />
            }))}
            {S.map((s, si) => s.labelOf && data.map((d, i) => {
              const sp = span(i, si), text = s.labelOf!(d, i); if (!sp || !text) return null
              const yTop = Math.min(sc(s).Y(sp[0]), sc(s).Y(sp[1])) - 6
              return <motion.text key={`l${s.key}${i}`} x={bx(i, s) + bw / 2} textAnchor="middle" fill="var(--fg2)" fontWeight={500}
                initial={{ opacity: 0, y: yTop + 6 }} animate={{ opacity: seen ? 1 : 0, y: seen ? yTop : yTop + 6 }} transition={{ ...spring(0.2, 0.5), delay: seen ? 0.35 + i * 0.03 : 0 }}>{text}</motion.text>
            }))}
            {S.map((s, si) => (s.type === 'line' || s.type === 'area') && runs(si).map(run => {
              const { Y, rest } = sc(s)
              const line = run.map(i => [X(i), Y(top(i, si)!)] as [number, number]), floor = run.map(i => [X(i), Y(stacked ? base(i, si) : rest)] as [number, number]), flat = run.map(i => [X(i), Y(rest)] as [number, number])
              const area = (up: [number, number][], low: [number, number][]) => chartPath(up, s.curve) + chartPath(low.slice().reverse(), s.curve, true) + 'Z'
              const d = chartPath(line, s.curve), d0 = chartPath(flat, s.curve)
              return (
                <g key={`${s.key}-${run[0]}-${run.length}`}>
                  {s.type === 'area' && <motion.path initial={{ d: area(flat, flat) }} animate={{ d: seen ? area(line, floor) : area(flat, flat) }} fill={s.color} fillOpacity={0.18} transition={spring(0.1, 0.6)} />}
                  <motion.path initial={{ d: d0 }} animate={{ d: seen ? d : d0 }} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                    strokeDasharray={s.dashed ? '5 4' : undefined} transition={spring(0.1, 0.6)} />
                  {s.points && run.map(i => <motion.circle key={i} cx={X(i)} r={3} fill="var(--card)" stroke={s.color} strokeWidth={2}
                    initial={{ cy: Y(rest) }} animate={{ cy: seen ? Y(top(i, si)!) : Y(rest) }} transition={spring(0.1, 0.6)} />)}
                </g>
              )
            }))}
            {whiskers(true)}
            {hover !== null && S.map((s, si) => { const v = top(hover, si); return (s.type === 'line' || s.type === 'area') && v !== null && <circle key={s.key} cx={X(hover)} cy={sc(s).Y(v)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} /> })}
            {tl && /pins|dots/.test(tl.style) && <g style={fade}>{tl.points.map(p => {
              const c = look(p.tag).color, y = lineY(p.ms), stem = tl.style === 'pins' && !p.hidden
              return <g key={p.tag.id}>
                {stem && <line x1={p.x} x2={p.x} y1={y} y2={pinY(p.ms, p.row) + 10} stroke={c} strokeOpacity={0.5} />}
                <circle cx={p.x} cy={y} r={tl.style === 'dots' ? 0 : 2.5} fill={c} />
              </g>
            })}</g>}
            {activeTag && anchor && !aSpan && tl && <g pointerEvents="none">
              {(tl.style === 'rug' || tl.style === 'rollup') && <line x1={anchor.x} x2={anchor.x} y1={lineY(host!.ms)} y2={height - 18} stroke="var(--fg3)" strokeDasharray="2 3" />}
              <circle cx={host!.x} cy={lineY(host!.ms)} r={4.5} fill={look(activeTag).color} stroke="var(--card)" strokeWidth={2} />
            </g>}
          </svg>
        )}
        {tl && aTags.length > 0 && (
          // the tags: one Tab stop after the series (useTagFocus); glyphs are its options, folded ones visually hidden
          <div {...tags.props} onFocus={e => { setHover(null); tags.props.onFocus(e) }} className="pointer-events-none absolute inset-0 outline-none" style={fade}>
            {/* options in time order (spans by their start), as the keyboard walks them */}
            {[...tl.spans.map(p => [p.from, <div key={p.tag.id} {...tags.option(p.tag)} {...tagPtr(p.tag)} className={cn(TOUCH.hit, 'pointer-events-auto absolute cursor-pointer')}
              style={{ /* rtl-lint-ignore: LTR plot */ left: p.x0, width: Math.max(8, p.x1 - p.x0), top: pad.t - 5, height: 12 }} />] as const), ...tl.points.map(p => [p.ms, (() => {
              const { icon, color } = look(p.tag), on = p.tag.id === activeAt || (host === p && !!activeTag), o = { ...tags.option(p.tag), ...tagPtr(p.tag) }
              if (p.hidden || tl.style === 'rollup') return <span key={p.tag.id} {...o} style={TAG_SR_ONLY} />
              if (tl.style === 'flags') return p.flag
                ? <div key={p.tag.id} {...o} className={cn(TOUCH.hit, 'pointer-events-auto absolute h-[18px] cursor-pointer rounded-e-[var(--r-sm)] border-s-2 px-1.5 text-[11px] leading-[16px] font-medium whitespace-nowrap text-[var(--fg)]')}
                  style={{ /* rtl-lint-ignore: LTR plot */ left: p.x - 1, top: pad.t - 22, borderColor: color, background: timeTagTint(color, on ? 32 : 18) }}>{p.tag.label}</div>
                : <div key={p.tag.id} {...o} className={cn(TOUCH.hit, 'pointer-events-auto absolute w-2.5 cursor-pointer')} style={{ /* rtl-lint-ignore: LTR plot */ left: p.x - 5, top: pad.t - 10, height: 14 }} />
              if (tl.style === 'dots') return <span key={p.tag.id} {...o} className={cn(TOUCH.hit, 'pointer-events-auto absolute cursor-pointer rounded-full border-2 border-[var(--card)] motion-safe:transition-transform', on && 'scale-150')}
                style={{ /* rtl-lint-ignore: LTR plot */ left: p.x - 5, top: lineY(p.ms) - 5, width: 10, height: 10, background: color }} />
              const y = tl.style === 'pins' ? pinY(p.ms, p.row) : rugY(p.row)
              return <TagGlyph key={p.tag.id} {...o} icon={icon} color={color} active={on} more={p.more?.length} className={cn(TOUCH.hit, 'pointer-events-auto !absolute cursor-pointer motion-safe:[transition:left_.3s,top_.3s,transform_.15s]')}
                style={{ /* rtl-lint-ignore: LTR plot */ left: p.x - 10, top: y - 10 }} />
            })()] as const)].sort((a, b) => a[0] - b[0]).map(e => e[1])}
            {tl.bins.map(b => {
              const k = A!.kinds?.find(q => q.kind === b.kind), color = b.kind === '*' ? 'var(--c-neutral)' : safeColor(k?.color, 'var(--accent)'), on = aBin === b
              const first = tl.points.find(p => p.tag.id === b.ids[0])!.tag
              return <div key={`${b.from}${b.kind}`} aria-hidden {...tagPtr(first)} className={cn(TOUCH.hit, 'ui-num pointer-events-auto absolute flex h-[18px] cursor-pointer items-center gap-0.5 overflow-hidden rounded-full px-1.5 text-[11px] whitespace-nowrap text-[var(--fg)]')}
                style={{ /* rtl-lint-ignore: LTR plot */ left: b.x, top: rugY(b.row) - 9, maxWidth: b.w - 2, transform: 'translateX(-50%)', background: timeTagTint(color, on ? 34 : 18), boxShadow: on ? `0 0 0 1.5px ${color}` : undefined }}>
                <span className="text-[10px]">{b.kind === '*' ? '+' : k?.icon}</span>{b.count}
              </div>
            })}
          </div>
        )}
        {activeTag && anchor && w > 0 && (
          <ChartTooltip x={anchor.x} y={clamp(anchor.y - 10, 0, height + aBand - 64)} width={w}>
            <TagTooltip tag={activeTag} kinds={A?.kinds} extra={aBin && aBin.count > 1 ? am('bin', { label: aBin.kind === '*' ? am('others') : look(activeTag).kindLabel, n: aBin.count, from: lf.time(aBin.from), to: lf.time(aBin.to) }) : undefined} />
          </ChartTooltip>
        )}
        {hover !== null && w > 0 && !activeTag && (
          <ChartTooltip x={X(hover)} y={pad.t} width={w}>
            {tooltip ? tooltip(data[hover], hover) : <>
              <div className="mb-1 font-medium">{xText(hover)}</div>
              {S.map((s, si) => {
                if (s.type === 'float') { const sp = span(hover, si); return sp && <TooltipRow key={s.key} color={s.colorOf?.(data[hover], hover) ?? s.color} label={s.label} value={`${fmtOf(s)(sp[0])} → ${fmtOf(s)(sp[1])}`} /> }
                const v = num(data[hover][s.key]); return v !== null && <TooltipRow key={s.key} color={s.color} label={s.label} dashed={s.dashed} value={fmtOf(s)(v)} />
              })}
              {band && num(data[hover][band.lower]) !== null && <TooltipRow color="var(--band)" label={band.label ?? cm('rangeLabel')} value={`${format(num(data[hover][band.lower])!)}–${format(num(data[hover][band.upper])!)}`} />}
            </>}
          </ChartTooltip>
        )}
      </div>
      {legend && <Legend items={[...S.map(s => ({ label: s.label, color: s.color, dashed: s.dashed })), ...(band ? [{ label: band.label ?? cm('rangeLabel'), color: '', band: true }] : [])]} />}
    </div>
  )
}

export type Slice = { label: string; value: number; color?: string }

/**
 * Share of a total. variant 'donut' (default; pie with thickness = size/2) or 'polar' (polar area: equal angles,
 * radius by value). Hover or tap a slice or legend row to focus it (tap outside to clear). Sweeps in when scrolled into view.
 */
export function DonutChart({ data, size = 150, thickness = 20, format: formatProp, centerLabel: centerProp, variant = 'donut', label, className }:
  { data: Slice[]; size?: number; thickness?: number; format?: (n: number) => string; centerLabel?: string; variant?: 'donut' | 'polar'
    /** accessible name (default "<centerLabel> by share" / "Polar area chart") */ label?: string; className?: string }) {
  const [ref, seen] = useChartSeen<HTMLDivElement>()
  const { cm, fmt: lf, locale } = useChartLocale(CHART_DONUT_MESSAGES)
  const format = formatProp ?? lf.compact, centerLabel = centerProp ?? cm('total')
  const [hoverAt, setHover] = useState<number | null>(null)
  const hover = chartIndex(hoverAt, data.length)
  useOutside([ref], () => setHover(null), hover !== null, { escape: true })
  const total = data.reduce((a, d) => a + d.value, 0) || 1
  const pctOf = (d: Slice) => lf.percent(Math.round((d.value / total) * 100) / 100, 0)
  const focus = useChartFocus({
    count: data.length, index: hover, onIndex: setHover,
    label: label ?? (variant === 'polar' ? cm('polar') : cm('byShare', { label: centerLabel })),
    summary: cm('slices', { n: data.length, total: format(total), list: lf.list(data.map(d => cm('sliceText', { label: d.label, value: format(d.value), pct: pctOf(d) }))) }),
    describe: i => cm('sliceDescribe', { label: data[i].label, value: format(data[i].value), pct: pctOf(data[i]), total: format(total) }),
  })
  const colorOf = (d: Slice, i: number) => d.color ?? PALETTE[i % PALETTE.length]
  const r = (size - thickness) / 2 - 2, c = 2 * Math.PI * r
  const cx = size / 2, R = size / 2 - 6, max = maxOf(data.map(d => d.value)) || 1
  const wedge = (i: number, rr: number) => {
    const a0 = (i / data.length) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1) / data.length) * 2 * Math.PI - Math.PI / 2
    return `M${cx},${cx}L${p1(cx + Math.cos(a0) * rr)},${p1(cx + Math.sin(a0) * rr)}A${p1(rr)},${p1(rr)} 0 0 1 ${p1(cx + Math.cos(a1) * rr)},${p1(cx + Math.sin(a1) * rr)}Z`
  }
  let acc = 0
  return (
    <div ref={ref} {...focus.props} className={cn('flex flex-wrap items-center gap-5', CHART_FOCUS, className)}>
      {focus.a11y}
      <div className="relative" style={{ width: size, height: size }}>
        {variant === 'donut' ? (
          <svg width={size} height={size} aria-hidden className="-rotate-90">
            {data.map((d, i) => {
              const len = (d.value / total) * c, off = acc; acc += len
              return <motion.circle key={d.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colorOf(d, i)}
                strokeDasharray={`${Math.max(0, len - 2)} ${c}`} initial={{ strokeDashoffset: c, strokeWidth: thickness }}
                animate={{ strokeDashoffset: seen ? -off : c, strokeWidth: hover === i ? thickness + 6 : thickness, opacity: hover === null || hover === i ? 1 : 0.4 }}
                transition={{ ...spring(0.15, 0.8), delay: seen ? i * 0.05 : 0 }} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} onPointerLeave={onMouseLeave(() => setHover(null))} />
            })}
          </svg>
        ) : (
          <svg width={size} height={size} aria-hidden className="overflow-visible">
            {[0.25, 0.5, 0.75, 1].map(f => <circle key={f} cx={cx} cy={cx} r={R * f} fill="none" stroke="var(--line)" />)}
            {data.map((d, i) => {
              const rr = (d.value / max) * R + (hover === i ? 4 : 0)
              return <motion.path key={d.label} fill={colorOf(d, i)} fillOpacity={0.8} stroke="var(--card)" strokeWidth={2} strokeLinejoin="round"
                initial={{ d: wedge(i, 0) }} animate={{ d: wedge(i, seen ? rr : 0), opacity: hover === null || hover === i ? 1 : 0.45 }}
                transition={{ ...spring(0.2, 0.7), delay: seen && hover === null ? i * 0.06 : 0 }} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} onPointerLeave={onMouseLeave(() => setHover(null))} />
            })}
          </svg>
        )}
        {variant === 'donut' ? (
          <div aria-hidden className="pointer-events-none absolute inset-0 grid place-content-center text-center">
            <span className="text-xs text-[var(--fg3)]">{hover === null ? centerLabel : data[hover].label}</span>
            <AnimatedNumber locale={locale} value={hover === null ? total : data[hover].value} className="justify-center text-lg font-semibold" format={{ notation: 'compact', maximumFractionDigits: 1 }} />
          </div>
        ) : hover !== null && (() => {
          const a = ((hover + 0.5) / data.length) * 2 * Math.PI - Math.PI / 2, rr = (data[hover].value / max) * R * 0.6
          return <ChartTooltip x={cx + Math.cos(a) * rr} y={cx + Math.sin(a) * rr - 16} width={size + 150}><TooltipRow color={colorOf(data[hover], hover)} label={data[hover].label} value={format(data[hover].value)} /></ChartTooltip>
        })()}
      </div>
      <div aria-hidden className="flex min-w-[140px] flex-1 flex-col gap-1.5">
        {data.map((d, i) => (
          <div key={d.label} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} onPointerLeave={onMouseLeave(() => setHover(null))}
            className={cn('flex items-center gap-2 text-[13px] transition-opacity', TOUCH.tap, hover !== null && hover !== i && 'opacity-50')}>
            <span className="h-2.5 w-2.5 rounded-[var(--r-sm)]" style={{ background: safeColor(colorOf(d, i)) }} />
            <span className="flex-1 text-[var(--fg2)]">{d.label}</span><span className="ui-num">{format(d.value)}</span>
            <span className="ui-num w-10 text-end text-xs text-[var(--fg3)]">{pctOf(d)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Half-circle gauge. The arc sweeps and the number rolls up when scrolled into view, and again whenever `value` changes.
 * Colour comes from `color`, or from `thresholds` (fraction of the range → colour). `label` is the caption under the number.
 */
export function Gauge({ value, min = 0, max = 100, label, format, numberFormat = { maximumFractionDigits: 0 }, color, thresholds = [[0.6, 'var(--ok)'], [0.85, 'var(--warn)'], [1, 'var(--bad)']], className }:
  { value: number; min?: number; max?: number; label?: string; format?: (v: number) => string; numberFormat?: Intl.NumberFormatOptions; color?: string; thresholds?: [number, string][]; className?: string }) {
  const [ref, seen] = useChartSeen<HTMLDivElement>()
  const { cm, fmt: lf, locale } = useChartLocale(CHART_GAUGE_MESSAGES)
  const raw = (value - min) / (max - min || 1), t = Number.isFinite(raw) ? clamp(raw, 0, 1) : 0
  const stroke = color ?? thresholds.find(([at]) => t <= at)?.[1] ?? 'var(--primary)'
  const shown = useTween(seen && Number.isFinite(value) ? value : min, 800)
  const arc = 'M 12 82 A 68 68 0 0 1 148 82'
  return (
    <div ref={ref} className={cn('relative mx-auto w-full max-w-[220px]', className)}>
      <svg viewBox="0 0 160 92" className="block w-full" role="img" aria-label={`${label ?? cm('gauge')}: ${format ? format(value) : lf.number(value, numberFormat)}`}>
        <path d={arc} fill="none" stroke="var(--muted)" strokeWidth={14} strokeLinecap="round" />
        <motion.path d={arc} fill="none" stroke={stroke} strokeWidth={14} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: seen ? Math.max(0.001, t) : 0, stroke }} transition={spring(0.15, 0.9)} />
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        {format ? <div className="ui-num text-2xl font-semibold">{format(shown)}</div> : <AnimatedNumber locale={locale} value={Math.round(shown)} format={numberFormat} className="justify-center text-[28px] font-semibold tracking-tight" />}
        {label && <div className="mt-1 text-xs text-[var(--fg3)]">{label}</div>}
      </div>
    </div>
  )
}

/** Radar / spider chart for comparing a few profiles across the same axes. Vertex dots, dashed or unfilled series; hover or tap an axis for its values. */
export function RadarChart({ axes, series, max, size = 240, format: formatProp, label, className }:
  { axes: string[]; series: { label: string; values: number[]; color?: string; dashed?: boolean; fill?: boolean }[]; max?: number; size?: number; format?: (n: number) => string
    /** accessible name (default: the series labels) */ label?: string; className?: string }) {
  const [ref, seen] = useChartSeen<HTMLDivElement>()
  const [hoverAt, setHover] = useState<number | null>(null)
  const hover = chartIndex(hoverAt, axes.length)
  const { cm, fmt: lf, range } = useChartLocale(CHART_RADAR_MESSAGES)
  const format = formatProp ?? lf.compact
  useOutside([ref], () => setHover(null), hover !== null, { escape: true })
  const focus = useChartFocus({
    count: axes.length, index: hover, onIndex: setHover,
    label: label ?? cm('radarLabel', { names: lf.list(series.map(s => s.label)) }),
    summary: [cm('axes', { n: axes.length, list: lf.list(axes) }), ...series.map(s => cm('seriesRange', { name: s.label, range: range(s.values, format) }))].join(' '),
    describe: i => `${axes[i]}: ${series.map(s => `${s.label} ${format(s.values[i] ?? 0)}`).join(', ')}`,
  })
  // an all-zero (or empty) chart would divide by zero: fall back to a unit scale
  const m = (max ?? maxOf(series.flatMap(s => s.values.filter(Number.isFinite)), 0)) || 1, cx = size / 2, cy = size / 2, R = size / 2 - 34
  const ang = (i: number) => (Math.PI * 2 * i) / (axes.length || 1) - Math.PI / 2
  const pt = (i: number, v: number) => [cx + Math.cos(ang(i)) * R * (v / m), cy + Math.sin(ang(i)) * R * (v / m)] as [number, number]
  const colorOf = (i: number) => series[i].color ?? PALETTE[i % PALETTE.length]
  const sector = (i: number) => {
    const a0 = ang(i - 0.5), a1 = ang(i + 0.5), rr = R * 1.25
    return `M${cx},${cy}L${p1(cx + Math.cos(a0) * rr)},${p1(cy + Math.sin(a0) * rr)}A${rr},${rr} 0 0 1 ${p1(cx + Math.cos(a1) * rr)},${p1(cy + Math.sin(a1) * rr)}Z`
  }
  return (
    <div ref={ref} className={cn('flex flex-col items-center', className)}>
      <div {...focus.props} dir="ltr" className={cn('relative', CHART_FOCUS)} style={{ width: size, height: size }} onPointerLeave={onMouseLeave(() => setHover(null))}>
        {focus.a11y}
        <svg width={size} height={size} aria-hidden className="overflow-visible text-[11px]">
          {[0.25, 0.5, 0.75, 1].map(f => <path key={f} d={linePath(axes.map((_, i) => pt(i, m * f))) + 'Z'} fill="none" stroke="var(--line)" />)}
          {axes.map((a, i) => { const [x, y] = pt(i, m * 1.16); return <g key={a}><line x1={cx} y1={cy} x2={pt(i, m)[0]} y2={pt(i, m)[1]} stroke={hover === i ? 'var(--fg3)' : 'var(--line)'} /><text x={x} y={y} dy="0.32em" textAnchor="middle" fill={hover === i ? 'var(--fg)' : 'var(--fg2)'}>{a}</text></g> })}
          {series.map((s, si) => {
            const d = linePath(s.values.map((v, i) => pt(i, v))) + 'Z', d0 = linePath(s.values.map((_, i) => pt(i, 0))) + 'Z', color = colorOf(si)
            return <motion.path key={s.label} initial={{ d: d0 }} animate={{ d: seen ? d : d0 }} fill={s.fill === false ? 'none' : color} fillOpacity={0.15} stroke={color} strokeWidth={2}
              strokeDasharray={s.dashed ? '4 3' : undefined} strokeLinejoin="round" transition={{ ...spring(0.2, 0.8), delay: seen ? si * 0.1 : 0 }} />
          })}
          {series.map((s, si) => s.values.map((v, i) => {
            const [x, y] = seen ? pt(i, v) : [cx, cy]
            return <motion.circle key={`${s.label}${i}`} fill={colorOf(si)} stroke="var(--card)" strokeWidth={1.5} initial={{ cx, cy, r: 2.5 }}
              animate={{ cx: x, cy: y, r: hover === i ? 4.5 : 2.5 }} transition={{ ...spring(0.2, 0.8), delay: seen && hover === null ? si * 0.1 : 0 }} />
          }))}
          {axes.map((a, i) => <path key={a} d={sector(i)} fill="transparent" onPointerEnter={() => setHover(i)} onPointerDown={e => { releaseTouchCapture(e); setHover(i) }} />)}
        </svg>
        {hover !== null && (() => { const [x, y] = pt(hover, m * 0.55); return (
          <ChartTooltip x={x} y={y - 20} width={size + 60}>
            <div className="mb-1 font-medium">{axes[hover]}</div>
            {series.map((s, si) => <TooltipRow key={s.label} color={colorOf(si)} dashed={s.dashed} label={s.label} value={format(s.values[hover] ?? 0)} />)}
          </ChartTooltip>
        ) })()}
      </div>
      <Legend items={series.map((s, i) => ({ label: s.label, color: colorOf(i), dashed: s.dashed }))} />
    </div>
  )
}

export type Point = { x: number; y: number; r?: number; label?: string; group?: string }
/**
 * Scatter plot; give points an `r` for a bubble chart and a `group` for colours. Points pop in when scrolled into view.
 * Hover or tap near a point (or slide a finger) for its tooltip; touch uses a wider catch radius.
 */
export function ScatterChart({ points: allPoints, height = 220, xLabel, yLabel, format: formatProp, xDomain, yDomain, maxPoints, label, className }:
  { points: Point[]; height?: number; xLabel?: string; yLabel?: string; format?: (n: number) => string; xDomain?: [number, number]; yDomain?: [number, number]
    /** draw at most this many points (evenly sampled) */ maxPoints?: number; /** accessible name (default "Scatter plot" / "Bubble chart") */ label?: string; className?: string }) {
  const points = useMemo(() => chartDownsample(allPoints, maxPoints), [allPoints, maxPoints])
  // the keyboard walks the points left to right
  const order = useMemo(() => points.map((_, i) => i).sort((a, b) => points[a].x - points[b].x || points[a].y - points[b].y), [points])
  const [ref, w, seen] = useChartFrame<HTMLDivElement>()
  const [hoverAt, setHover] = useState<number | null>(null)
  const hover = chartIndex(hoverAt, points.length)
  const groups = [...new Set(points.map(p => p.group ?? ''))]
  const { cm, fmt: lf, range } = useChartLocale(CHART_SCATTER_MESSAGES)
  const format = formatProp ?? lf.compact
  const xt = niceTicks(xDomain?.[0] ?? minOf(points.map(p => p.x)), xDomain?.[1] ?? maxOf(points.map(p => p.x)))
  const yt = niceTicks(yDomain?.[0] ?? minOf(points.map(p => p.y), 0), yDomain?.[1] ?? maxOf(points.map(p => p.y)))
  const pad = { l: chartAxisPad(yt.map(format)), r: 12, t: 10, b: 28 }, iw = w - pad.l - pad.r, ih = height - pad.t - pad.b
  const X = (v: number) => pad.l + ((v - xt[0]) / (xt[xt.length - 1] - xt[0] || 1)) * iw, Y = (v: number) => pad.t + ih - ((v - yt[0]) / (yt[yt.length - 1] - yt[0] || 1)) * ih
  const color = (p: Point) => PALETTE[groups.indexOf(p.group ?? '') % PALETTE.length]
  useOutside([ref], () => setHover(null), hover !== null, { escape: true })
  const bubbles = points.some(p => p.r !== undefined)
  const pointText = (p: Point) => (p.label ? `${p.label}: ` : '') + [`${xLabel ?? 'x'} ${format(p.x)}`, `${yLabel ?? 'y'} ${format(p.y)}`, ...(p.r !== undefined ? [`${cm('size')} ${format(p.r)}`] : []), ...(p.group ? [p.group] : [])].join(', ')
  const focus = useChartFocus({
    count: points.length, index: hover === null ? null : order.indexOf(hover), onIndex: k => setHover(k === null ? null : order[k] ?? null),
    label: label ?? (bubbles ? cm('bubble') : cm('scatter')),
    summary: [cm('points', { n: points.length }), `${xLabel ?? 'x'} ${range(points.map(p => p.x), format)}, ${yLabel ?? 'y'} ${range(points.map(p => p.y), format)}.`, ...(groups.length > 1 ? [cm('groups', { list: lf.list(groups) })] : []), cm('leftToRight')].join(' '),
    describe: k => pointText(points[order[k]]),
  })
  const near = (e: ReactPointerEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top, slop = isTouch(e) ? 22 : 6
    let best: number | null = null, bd = Infinity
    points.forEach((p, i) => { const d = Math.hypot(X(p.x) - mx, Y(p.y) - my) - (p.r ?? 4); if (d < slop && d < bd) { bd = d; best = i } })
    if (best !== null || !isTouch(e) || e.type === 'pointerdown') setHover(best)
  }
  return (
    <div className={className}>
      <div ref={ref} {...focus.props} dir="ltr" className={cn('relative', CHART_FOCUS)} style={{ height }} onPointerLeave={onMouseLeave(() => setHover(null))}>
        {focus.a11y}
        {w > 0 && (
          <svg width={w} height={height} aria-hidden className="block touch-pan-y overflow-visible text-[11px]" onPointerDown={near} onPointerMove={near}>
            {yt.map(t => <g key={t}><line x1={pad.l} x2={w - pad.r} y1={Y(t)} y2={Y(t)} stroke="var(--line)" strokeDasharray="3 3" /><text x={pad.l - 8} y={Y(t)} dy="0.32em" textAnchor="end" fill="var(--fg3)">{format(t)}</text></g>)}
            {xt.map(t => <text key={t} x={X(t)} y={height - 12} textAnchor="middle" fill="var(--fg3)">{format(t)}</text>)}
            {xLabel && <text x={w - pad.r} y={height} textAnchor="end" fill="var(--fg3)">{xLabel}</text>}
            {yLabel && <text x={pad.l} y={pad.t - 2} fill="var(--fg3)">{yLabel}</text>}
            {/* plain circles scaled by a CSS transition (one transform each), not 40 JS-driven r tweens: cheap to mount */}
            {points.map((p, i) => (
              <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={p.r ?? 4} fill={color(p)} fillOpacity={p.r ? 0.35 : 0.7} stroke={hover === i ? 'var(--fg2)' : color(p)} strokeWidth={p.r ? 1.5 : hover === i ? 1.5 : 0}
                style={{ transform: `scale(${seen ? (hover === i ? 1.35 : 1) : 0})`, transformBox: 'fill-box', transformOrigin: 'center',
                  transition: `transform ${seen && hover === null ? '.5s' : '.2s'} cubic-bezier(.34,1.56,.64,1) ${seen && hover === null ? i * 0.012 : 0}s` }} />
            ))}
          </svg>
        )}
        {hover !== null && <ChartTooltip x={X(points[hover].x)} y={Y(points[hover].y) - 20} width={w}>
          {points[hover].label && <div className="mb-1 font-medium">{points[hover].label}</div>}
          <TooltipRow color={color(points[hover])} label={xLabel ?? 'x'} value={format(points[hover].x)} /><TooltipRow color={color(points[hover])} label={yLabel ?? 'y'} value={format(points[hover].y)} />
          {points[hover].r !== undefined && <TooltipRow color={color(points[hover])} label={cm('size')} value={format(points[hover].r!)} />}
        </ChartTooltip>}
      </div>
      {groups.length > 1 && <Legend items={groups.map((g, i) => ({ label: g, color: PALETTE[i % PALETTE.length] }))} />}
    </div>
  )
}

/** Shade a cell from muted to `color` by t ∈ [0, 1]. */
const heat = (t: number, color = 'var(--accent)') => t <= 0 ? 'var(--muted)' : `color-mix(in srgb, ${color} ${Math.round(15 + t * 85)}%, var(--muted))`

/**
 * Matrix heatmap: rows × columns. Cells fade in when scrolled into view; hover or tap a cell (slide a finger across)
 * for its value in the footer, or focus the grid and move with the arrow keys. `shade` maps value/max → colour. On touch
 * screens cells grow to at least `touchCell`; when the grid is wider than its box it scrolls inside it with the row
 * labels pinned (`scrollTo` picks the start edge).
 */
export function Heatmap({ rows, cols, value, format: formatProp, cell = 18, touchCell = 24, label = (r, c) => `${rows[r]} · ${cols[c]}`, color = 'var(--accent)', shade, footer = true, scrollTo = 'start', name, className }:
  {
    rows: string[]; cols: string[]; value: (r: number, c: number) => number; format?: (n: number) => string; cell?: number; touchCell?: number; label?: (r: number, c: number) => string
    color?: string; shade?: (t: number) => string; footer?: boolean; scrollTo?: 'start' | 'end'
    /** accessible name of the grid (default "Heatmap, 7 rows by 12 columns") */ name?: string; className?: string
  }) {
  const [ref, seen] = useChartSeen<HTMLDivElement>()
  const scroller = useRef<HTMLDivElement>(null)
  const [hoverAt, setHover] = useState<[number, number] | null>(null)
  const hover = hoverAt && hoverAt[0] < rows.length && hoverAt[1] < cols.length ? hoverAt : null
  const [scrolls, setScrolls] = useState(false)
  const coarse = useCoarsePointer()
  const { cm, fmt: lf, range, dir } = useChartLocale(CHART_HEATMAP_MESSAGES)
  const format = formatProp ?? lf.compact
  useOutside([ref], () => setHover(null), hover !== null, { escape: true })
  const size = coarse ? Math.max(cell, touchCell) : cell
  const vals = rows.map((_, r) => cols.map((_, c) => value(r, c))), max = maxOf(vals.flat().filter(Number.isFinite), 0) || 1
  const fill = (t: number) => safeColor(shade ? shade(t) : heat(t, color), 'var(--muted)')
  const gap = Math.ceil(30 / (size + 3)) // columns each label needs; skip labels that would collide
  let last = -gap
  const shown = cols.map((c, i) => (c && i - last >= gap ? ((last = i), c) : ''))
  useLayoutEffect(() => {
    const el = scroller.current; if (!el) return
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1)
    check(); if (scrollTo === 'end') el.scrollLeft = el.scrollWidth
    const ro = new ResizeObserver(check); ro.observe(el)
    return () => ro.disconnect()
  }, [size, cols.length, scrollTo])
  // the staggered fade-in only applies to the first reveal; later hover changes answer straight away
  const [introDone, setIntroDone] = useState(false)
  useEffect(() => { if (!seen || introDone) return; const t = setTimeout(() => setIntroDone(true), 900); return () => clearTimeout(t) }, [seen, introDone])
  // keyboard: the shared chart focus model in grid mode (one Tab stop; ↑/↓ move by a row, Home/End stay in the row)
  const nc = cols.length, flat = vals.flat()
  const focus = useChartFocus({
    count: rows.length * nc, columns: nc, start: scrollTo === 'end' ? nc - 1 : 0,
    index: hover ? hover[0] * nc + hover[1] : null,
    onIndex: k => {
      if (k === null) { setHover(null); return }
      const to: [number, number] = [Math.floor(k / nc), k % nc]
      setHover(to)
      scroller.current?.querySelector<HTMLElement>(`[data-hm="${to[0]}-${to[1]}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    },
    label: name ?? cm('heatmapName', { rows: rows.length, cols: nc }),
    summary: cm('heatSummary', { range: range(flat, format) }),
    describe: k => `${label(Math.floor(k / nc), k % nc)}: ${format(flat[k])}`,
  })
  const pin = 'sticky start-0 z-[1] bg-[var(--card)] shadow-[3px_0_0_var(--card)]'
  return (
    <div ref={ref} className={className}>
      {/* the grid is a plot (columns are usually time): LTR in every locale, labels pinned on the left; the footer follows the locale */}
      <div ref={scroller} {...focus.props} dir="ltr"
        className="overflow-x-auto overscroll-x-contain rounded-[var(--r-sm)] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]">
      {focus.a11y}
      <div className="inline-grid gap-[3px] text-[11px] text-[var(--fg3)]" style={{ gridTemplateColumns: `auto repeat(${cols.length}, ${size}px)` }} onPointerLeave={onMouseLeave(() => setHover(null))}>
        <span className={pin} />{shown.map((c, i) => <span key={i} aria-hidden className="overflow-visible text-start whitespace-nowrap">{c}</span>)}
        {rows.map((r, ri) => [
          <span key={`r${ri}`} aria-hidden className={cn('pe-1.5', pin)} style={{ lineHeight: `${size}px` }}>{r}</span>,
          // plain spans with CSS transitions (opacity + transform) rather than one motion component per cell: a 26-week
          // calendar has 182 cells, which made the mount frame long
          ...cols.map((_, ci) => {
            const on = hover?.[0] === ri && hover[1] === ci
            return <span key={`${ri}-${ci}`} data-hm={`${ri}-${ci}`} aria-hidden onPointerEnter={() => setHover([ri, ci])} onPointerDown={e => { releaseTouchCapture(e); setHover([ri, ci]) }}
              className={cn('rounded-[var(--r-sm)] transition-[opacity,transform] duration-300 ease-out', on && 'relative z-[1] shadow-[0_0_0_1.5px_var(--card),0_0_0_3px_var(--fg2)]')}
              style={{ height: size, background: fill(vals[ri][ci] / max), opacity: seen ? 1 : 0, transform: `scale(${seen ? (on ? 1.2 : 1) : 0.6})`, transitionDelay: seen && !introDone ? `${Math.min(0.5, ci * 0.012 + ri * 0.02)}s` : '0s' }} />
          }),
        ])}
      </div>
      </div>
      {footer && <div dir={dir} className="mt-2 h-4 truncate text-xs text-[var(--fg2)]" aria-live="polite">{hover ? <>{label(hover[0], hover[1])} · <b className="ui-num font-medium">{format(vals[hover[0]][hover[1]])}</b></>
        : <>{coarse ? cm('tapCell') : cm('hoverCell')}{scrolls && <span className="text-[var(--fg3)]"> · {coarse ? cm('swipeMore') : cm('scrollMore')}</span>}</>}</div>}
    </div>
  )
}

const CAL_LEVELS = [0, 35, 60, 100]
const calShade = (k: number) => k === 0 ? 'var(--muted)' : `color-mix(in srgb, var(--c4) ${CAL_LEVELS[k]}%, var(--muted))`
const calLevel = (t: number) => t <= 0 ? 0 : t <= 0.4 ? 1 : t <= 0.7 ? 2 : 3

/**
 * GitHub-style contribution grid in 4 levels with a Less → More legend. `values` maps core dayKey(date) → count.
 * `end` is the last day shown (default: today, read after mount so server and client render the same).
 * Built on Heatmap; cells size to fit, and on touch screens stay tappable and scroll inside the card (newest week in view, days pinned).
 */
export function CalendarHeatmap({ values, weeks = 26, end: endProp, className }: { values: Record<string, number>; weeks?: number; end?: Date; className?: string }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const { cm, fmt: lf, weekStartsOn } = useChartLocale(CHART_HEATMAP_MESSAGES)
  const [today, setToday] = useState<Date | null>(null)
  useEffect(() => { if (!endProp) setToday(new Date()) }, [endProp])
  const end = endProp ?? today
  const start = end && addDays(startOfWeek(end, weekStartsOn), -(weeks - 1) * 7) // the locale's first weekday, `weeks` columns back
  const day = (wk: number, d: number) => addDays(start!, wk * 7 + d)
  const month = (wk: number) => lf.date(day(wk, 0), { month: 'short' })
  const wd = lf.weekdays('short') // rows from the locale's first day; every other one is labelled
  // label a column only where a new month starts
  const cols = start ? Array.from({ length: weeks }, (_, wk) => (wk === 0 || month(wk) !== month(wk - 1) ? month(wk) : '')) : []
  const cell = Math.max(8, Math.min(14, Math.floor((w - 34) / weeks) - 3))
  return (
    <div ref={ref} className={className}>
      {w > 0 && start && <Heatmap name={cm('lastWeeks', { n: weeks })} cell={cell} touchCell={20} scrollTo="end" rows={[wd[0], '', wd[2], '', wd[4], '', '']} cols={cols} value={(r, c) => values[dayKey(day(c, r))] ?? 0} shade={t => calShade(calLevel(t))}
        label={(r, c) => lf.date(day(c, r), { weekday: 'short', day: 'numeric', month: 'short' })} format={n => cm('contributions', { n })} />}
      <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-[var(--fg3)]">
        {cm('less')}{[0, 1, 2, 3].map(k => <span key={k} className="h-2.5 w-2.5 rounded-[var(--r-sm)]" style={{ background: calShade(k) }} />)}{cm('more')}
      </div>
    </div>
  )
}

/**
 * Funnel with step-to-step conversion. Bars grow in when scrolled into view (a clip-path wipe from the centre, so nothing
 * reflows); hover, tap or arrow-key a step for its share of the first step.
 */
export function FunnelChart({ steps, format: formatProp, label: labelProp, className }: { steps: { label: string; value: number }[]; format?: (n: number) => string; /** accessible name */ label?: string; className?: string }) {
  const [ref, seen] = useChartSeen<HTMLDivElement>()
  const [hoverAt, setHover] = useState<number | null>(null)
  const hover = chartIndex(hoverAt, steps.length)
  const [tip, bind, , tipAt] = useChartTip(ref)
  const { cm, fmt: lf, pct, dir } = useChartLocale(CHART_FUNNEL_MESSAGES)
  const format = formatProp ?? lf.compact, label = labelProp ?? cm('funnel')
  useOutside([ref], () => setHover(null), hover !== null, { escape: true })
  const max = steps[0]?.value || 1
  const share = (i: number) => pct(steps[i].value / max)
  const conv = (i: number) => (i > 0 && steps[i - 1].value ? pct(steps[i].value / steps[i - 1].value) : null)
  const body = (i: number) => () => <>
    <div className="mb-1 font-medium">{steps[i].label}</div>
    <TooltipRow color={PALETTE[0]} label={cm('count')} value={format(steps[i].value)} />
    <TooltipRow color={PALETTE[0]} label={cm('ofFirst')} value={share(i)} />
  </>
  const focus = useChartFocus({
    count: steps.length, index: hover, onIndex: i => { setHover(i); tipAt(i, i === null ? undefined : body(i)) }, label, dir,
    summary: cm('steps', { n: steps.length, list: lf.list(steps.map(s => `${s.label} ${format(s.value)}`)) }) + (steps.length > 1 ? ' ' + cm('reachLast', { pct: share(steps.length - 1) }) : ''),
    describe: i => cm('stepDescribe', { label: steps[i].label, value: format(steps[i].value), pct: share(i) }) + (conv(i) !== null ? ', ' + cm('ofBefore', { pct: conv(i) }) : ''),
  })
  return (
    <div ref={ref} {...focus.props} className={cn('relative flex flex-col gap-1', CHART_FOCUS, className)} onPointerLeave={onMouseLeave(() => setHover(null))}>
      {focus.a11y}
      {steps.map((s, i) => {
        const cut = (100 - (s.value / max) * 100) / 2
        return (
          <div key={s.label} aria-hidden>
            {i > 0 && <div className="py-0.5 text-center text-[11px] text-[var(--fg3)]">↓ {conv(i) ?? pct(0)}</div>}
            <div className="flex items-center gap-3 text-[13px]" {...bind(body(i), () => setHover(i))}>
              <span className="w-24 flex-none truncate text-[var(--fg2)]">{s.label}</span>
              <div className="flex-1">
                <motion.div data-ci={i} className={cn('h-7 rounded-[var(--r-md)] transition-shadow', hover === i && 'shadow-[0_0_0_2px_var(--card),0_0_0_3.5px_var(--fg3)]')} style={{ background: PALETTE[0] }}
                  initial={{ clipPath: 'inset(0% 50% 0% 50% round 8px)' }}
                  animate={{ clipPath: seen ? `inset(0% ${cut}% 0% ${cut}% round 8px)` : 'inset(0% 50% 0% 50% round 8px)', opacity: (1 - i * 0.2) * (hover === null || hover === i ? 1 : 0.6) }}
                  transition={{ ...spring(0.15, 0.6), delay: seen ? i * 0.08 : 0 }} />
              </div>
              <span className="ui-num w-12 text-end">{format(s.value)}</span>
            </div>
          </div>
        )
      })}
      {tip && <ChartTooltip x={tip.x} y={tip.y} width={ref.current?.clientWidth ?? 300}>{tip.body}</ChartTooltip>}
    </div>
  )
}

/**
 * Ranked horizontal bars: top pages, countries, referrers. Bars grow in when scrolled into view (a clip-path wipe, no
 * reflow). Hover a row or arrow-key through them to highlight one; the values are always printed.
 */
export function BarList({ items, format: formatProp, color = 'var(--accent)', label: labelProp, className }: { items: { label: ReactNode; value: number; key?: string }[]; format?: (n: number) => string; color?: string; /** accessible name */ label?: string; className?: string }) {
  const [ref, seen] = useChartSeen<HTMLDivElement>()
  const [hoverAt, setHover] = useState<number | null>(null)
  const hover = chartIndex(hoverAt, items.length)
  useOutside([ref], () => setHover(null), hover !== null, { escape: true })
  const max = maxOf(items.map(i => i.value), 0) || 1
  const { cm, fmt: lf, range, dir } = useChartLocale(CHART_BARLIST_MESSAGES)
  const format = formatProp ?? lf.compact, label = labelProp ?? cm('ranked')
  const text = (l: ReactNode) => (typeof l === 'string' || typeof l === 'number' ? String(l) : '')
  // a list, not a plot: rows mirror in RTL (bars grow from the right) and ←/→ follow the reading direction
  const wipe = (f: number) => (dir === 'rtl' ? `inset(0% 0% 0% ${f}% round 8px)` : `inset(0% ${f}% 0% 0% round 8px)`)
  const focus = useChartFocus({
    count: items.length, index: hover, onIndex: setHover, label, dir,
    summary: cm('items', { n: items.length, range: range(items.map(i => i.value), format) }),
    describe: i => cm('itemDescribe', { i: i + 1, n: items.length, label: text(items[i].label), value: format(items[i].value) }),
  })
  const bar = `color-mix(in srgb, ${safeColor(color, 'var(--accent)')} 16%, transparent)`
  return (
    <div ref={ref} {...focus.props} className={cn('flex flex-col gap-1', CHART_FOCUS, className)} onPointerLeave={onMouseLeave(() => setHover(null))}>
      {focus.a11y}
      {items.map((it, i) => (
        <div key={it.key ?? String(it.label)} onPointerEnter={() => setHover(i)}
          className={cn('relative flex h-8 items-center justify-between overflow-hidden rounded-[var(--r-md)] px-2.5 text-[13px] transition-colors', hover === i && 'bg-[var(--muted)]')}>
          <motion.span aria-hidden className="absolute inset-0 rounded-[var(--r-md)]" style={{ background: bar }}
            initial={{ clipPath: wipe(100) }} animate={{ clipPath: wipe(seen ? 100 - (it.value / max) * 100 : 100) }}
            transition={{ ...spring(0.1, 0.6), delay: seen ? i * 0.04 : 0 }} />
          <span className="relative truncate">{it.label}</span><span className="ui-num relative text-[var(--fg2)]">{format(it.value)}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Squarified treemap: area ∝ value. Tiles grow out of their centres when scrolled into view and re-flow with a spring
 * when values change; both run on transforms (motion layout animations), never on left/top/width/height. Hover, tap or
 * arrow-key a tile to highlight it and see its share. `show` picks the second line: value or percent.
 */
export function Treemap({ items, height = 220, format: formatProp, show = 'value', label: labelProp, className }:
  { items: { label: string; value: number; color?: string }[]; height?: number; format?: (n: number) => string; show?: 'value' | 'percent'; /** accessible name */ label?: string; className?: string }) {
  const [ref, w, seen] = useChartFrame<HTMLDivElement>()
  const [hoverAt, setHover] = useState<number | null>(null)
  const hover = chartIndex(hoverAt, items.length)
  const [tip, bind, , tipAt] = useChartTip(ref)
  const { cm, fmt: lf, pct: lpct, locale } = useChartLocale(CHART_TREEMAP_MESSAGES)
  const format = formatProp ?? lf.compact, label = labelProp ?? cm('treemap')
  useOutside([ref], () => setHover(null), hover !== null, { escape: true })
  const total = items.reduce((a, d) => a + d.value, 0) || 1
  type Rect = { x: number; y: number; w: number; h: number; i: number }
  const rects = useMemo(() => {
    const out: Rect[] = []
    const sorted = items.map((d, i) => ({ a: (d.value / total) * w * height, i })).sort((p, q) => q.a - p.a)
    let box = { x: 0, y: 0, w, h: height }, row: typeof sorted = []
    const worst = (r: typeof sorted, side: number) => { const s = r.reduce((a, d) => a + d.a, 0); return maxOf(r.map(d => Math.max((side * side * d.a) / (s * s), (s * s) / (side * side * d.a)))) }
    const lay = (r: typeof sorted) => {
      const s = r.reduce((a, d) => a + d.a, 0), wide = box.w >= box.h, side = wide ? box.h : box.w, thick = s / side
      let o = 0
      r.forEach(d => { const len = d.a / thick; out.push(wide ? { x: box.x, y: box.y + o, w: thick, h: len, i: d.i } : { x: box.x + o, y: box.y, w: len, h: thick, i: d.i }); o += len })
      box = wide ? { x: box.x + thick, y: box.y, w: box.w - thick, h: box.h } : { x: box.x, y: box.y + thick, w: box.w, h: box.h - thick }
    }
    for (const d of sorted) {
      const side = Math.min(box.w, box.h)
      if (!row.length || worst([...row, d], side) <= worst(row, side)) row.push(d)
      else { lay(row); row = [d] }
    }
    if (row.length) lay(row)
    return out
  }, [items, w, height, total])
  const pct = (i: number) => Math.round((items[i].value / total) * 100)
  const tipBody = (i: number) => () => <TooltipRow color={items[i].color ?? PALETTE[i % PALETTE.length]} label={items[i].label} value={show === 'percent' ? lpct(pct(i) / 100) : `${format(items[i].value)} · ${lpct(pct(i) / 100)}`} />
  const order = useMemo(() => rects.map(r => r.i), [rects]) // largest first
  const focus = useChartFocus({
    count: items.length, index: hover === null ? null : order.indexOf(hover), label,
    onIndex: k => { const i = k === null ? null : order[k] ?? null; setHover(i); tipAt(i, i === null ? undefined : tipBody(i)) },
    summary: cm('parts', { n: items.length, list: lf.list(order.map(i => `${items[i].label} ${lpct(pct(i) / 100)}`)) }),
    describe: k => { const i = order[k]; return `${items[i].label}: ${format(items[i].value)}, ${lpct(pct(i) / 100)}` },
  })
  return (
    // tiles are laid out by geometry (largest at the top left), like a plot: dir="ltr"; their labels follow the locale
    <div ref={ref} {...focus.props} dir="ltr" className={cn('relative', CHART_FOCUS, className)} style={{ height }} onPointerLeave={onMouseLeave(() => setHover(null))}>
      {focus.a11y}
      {w > 0 && rects.map(r => {
        const it = items[r.i], color = it.color ?? PALETTE[r.i % PALETTE.length]
        return (
          // the box is laid out at its final rect straight away; `layout` animates the change as a transform (FLIP)
          // and the entrance is a scale from the centre, so no frame ever changes layout properties
          <motion.div key={it.label} data-ci={r.i} aria-hidden layout initial={{ scale: 0, opacity: 0 }} animate={seen ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
            transition={spring(0.2, 0.65)} className="absolute overflow-hidden p-[2px]" style={{ /* rtl-lint-ignore: LTR plot */ left: r.x, top: r.y, width: r.w, height: r.h }}
            {...bind(tipBody(r.i), () => setHover(r.i))}>
            <motion.div layout className={cn('h-full p-2 text-xs transition-[opacity,box-shadow]', hover === r.i && 'shadow-[inset_0_0_0_2px_var(--card)]')}
              style={{ borderRadius: 8, background: `color-mix(in srgb, ${safeColor(color, 'var(--accent)')} 72%, var(--fg))`, color: 'var(--card)', opacity: hover === null || hover === r.i ? 1 : 0.7 }}>
              {r.w > it.label.length * 6.5 + 18 && r.h > 34 && <motion.div layout="position" dir="auto">
                <b className="block truncate font-semibold">{it.label}</b>
                <span className="ui-num opacity-85">{show === 'percent' ? <AnimatedNumber locale={locale} value={pct(r.i) / 100} format={{ style: 'percent' }} /> : format(it.value)}</span>
              </motion.div>}
            </motion.div>
          </motion.div>
        )
      })}
      {tip && <ChartTooltip x={tip.x} y={tip.y} width={w}>{tip.body}</ChartTooltip>}
    </div>
  )
}

/* ── Sparklines: SparkChart lives in core (the foundation bundle uses it too) ─── */

/**
 * Stat tile: label, value that rolls up when scrolled into view, and a curved area sparkline under it. The tile is one
 * Tab stop: arrows walk the sparkline's points (a marker and readout follow), Home/End jump to the ends.
 */
export function SparkTile({ label, value, format, data, color = 'var(--ok)', height = 50, points, className }:
  { label: string; value: number; format?: Intl.NumberFormatOptions; data: number[]; color?: string; height?: number
    /** labels for the sparkline's points (keyboard readout), e.g. month names; default "point 3 of 14" */ points?: string[]; className?: string }) {
  const [ref, seen] = useChartSeen<HTMLDivElement>()
  const [boxRef, bw] = useWidth<HTMLDivElement>()
  const shown = useTween(seen ? value : 0, 1100)
  const [hoverAt, setHover] = useState<number | null>(null)
  const hover = chartIndex(hoverAt, data.length)
  const { cm, fmt: lf, range, pct, locale } = useChartLocale(CHART_SPARK_MESSAGES)
  const n = data.length, lo = minOf(data), hi = maxOf(data), pad = 4
  const ptName = (i: number) => points?.[i] ?? cm('pointOf', { i: i + 1, n })
  const focus = useChartFocus({
    count: n, index: hover, onIndex: setHover, start: n - 1,
    label: `${label}: ${lf.number(value, format)}`,
    summary: n ? cm('trend', { n, range: range(data, lf.compact), up: data[n - 1] >= data[0] ? 'yes' : 'no', pct: pct(Math.abs((data[n - 1] - data[0]) / (Math.abs(data[0]) || 1))) }) : cm('noTrend'),
    describe: i => `${ptName(i)}: ${lf.compact(data[i])}`,
  })
  const px = (i: number) => (i / Math.max(1, n - 1)) * bw, py = (i: number) => height - pad - ((data[i] - lo) / (hi - lo || 1)) * (height - pad * 2)
  return (
    <div ref={ref} {...focus.props} className={cn('flex flex-col gap-1', CHART_FOCUS, className)}>
      {focus.a11y}
      <span aria-hidden className="text-xs text-[var(--fg3)]">{label}</span>
      <span aria-hidden><AnimatedNumber locale={locale} value={Math.round(shown)} format={format} className="text-[28px] font-semibold tracking-tight" /></span>
      <div ref={boxRef} aria-hidden dir="ltr" className="relative mt-2" style={{ height }}>
        <SparkChart data={data} variant="area" curve="monotone" color={color} height={height} endDot />
        {hover !== null && bw > 0 && <>
          <span className="pointer-events-none absolute inset-y-0 w-px bg-[var(--line2)]" style={{ /* rtl-lint-ignore: LTR plot */ left: px(hover) }} />
          <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--card)]" style={{ /* rtl-lint-ignore: LTR plot */ left: px(hover), top: py(hover), background: safeColor(color) }} />
          <ChartTooltip x={px(hover)} y={-34} width={bw}><TooltipRow color={color} label={ptName(hover)} value={lf.compact(data[hover])} /></ChartTooltip>
        </>}
      </div>
    </div>
  )
}

export type TickerRow = { symbol: string; name: string; data: number[] }
/**
 * Live price table: symbol, name, sparkline with an end dot, rolling last price and a % change pill (up/down coloured).
 * Feed it new `data` to tick. Price and change cells have a fixed width with tabular digits, so a tick never moves a column.
 */
export function TickerTable({ rows, className }: { rows: TickerRow[]; className?: string }) {
  const { cm, locale } = useChartLocale(CHART_SPARK_MESSAGES)
  return (
    <div role="table" aria-label={cm('prices')} className={cn('flex flex-col', className)}>
      {rows.map(r => {
        const first = r.data[0] ?? 0, last = r.data[r.data.length - 1] ?? 0, ch = first ? (last / first - 1) * 100 : 0, up = ch >= 0
        return (
          <div key={r.symbol} role="row" className="grid h-11 grid-cols-[44px_minmax(0,1fr)_64px_62px] items-center gap-3 border-b border-[var(--line)] text-[13px] last:border-b-0 sm:grid-cols-[56px_minmax(0,1fr)_120px_72px_66px]">
            <span role="cell" className="font-[family-name:var(--mono)] text-xs font-semibold">{r.symbol}</span>
            <span role="cell" className="hidden truncate text-[var(--fg2)] sm:block">{r.name}</span>
            <SparkChart data={r.data} height={28} endDot color={up ? 'var(--ok)' : 'var(--bad)'} />
            <span role="cell" className="flex justify-end font-[family-name:var(--mono)] text-xs tabular-nums"><AnimatedNumber locale={locale} value={last} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} /></span>
            <span role="cell" className="flex min-w-[62px] justify-end tabular-nums"><DeltaBadge value={ch} digits={2} title={up ? cm('upSince') : cm('downSince')} className="min-w-[62px] justify-center font-[family-name:var(--mono)] tabular-nums" /></span>
          </div>
        )
      })}
    </div>
  )
}

/* ── Bullet ──────────────────────────────────────────────────────────────── */

/**
 * Bullet chart: qualitative bands, the actual bar (green when it meets its target, neutral grey when not) and a target
 * tick, one row per measure. Bars grow in when scrolled into view; hover, tap or arrow-key a row for numbers.
 */
export function BulletChart({ rows, max = 100, bands = [0.5, 0.75], format: formatProp, label: labelProp, className }:
  { rows: { label: string; value: number; target: number }[]; max?: number; bands?: number[]; format?: (n: number) => string; /** accessible name */ label?: string; className?: string }) {
  const [ref, w, seen] = useChartFrame<HTMLDivElement>()
  const [tip, bind, , tipAt] = useChartTip(ref)
  const { cm, fmt: lf } = useChartLocale(CHART_BULLET_MESSAGES)
  const format = formatProp ?? lf.compact, label = labelProp ?? cm('bullet')
  const [hoverAt, setHover] = useState<number | null>(null)
  const hover = chartIndex(hoverAt, rows.length)
  const L = 72, rowH = 31, iw = Math.max(0, w - L - 4), X = (v: number) => L + (clamp(v, 0, max) / (max || 1)) * iw
  const bandFill = ['var(--line)', 'color-mix(in srgb, var(--line2) 60%, transparent)', 'var(--line2)']
  const miss = CHART_NEUTRAL
  const body = (r: { label: string; value: number; target: number }) => () => <>
    <div className="mb-1 font-medium">{r.label}</div>
    <TooltipRow color={r.value >= r.target ? 'var(--ok)' : miss} label={cm('actual')} value={format(r.value)} />
    <TooltipRow color="var(--fg2)" label={cm('target')} value={format(r.target)} />
  </>
  const focus = useChartFocus({
    count: rows.length, index: hover, label, onIndex: i => { setHover(i); tipAt(i, i === null ? undefined : body(rows[i])) },
    summary: cm('measures', { n: rows.length, met: rows.filter(r => r.value >= r.target).length }),
    describe: i => cm('measureDescribe', { label: rows[i].label, value: format(rows[i].value), target: format(rows[i].target), met: rows[i].value >= rows[i].target ? 'yes' : 'no' }),
  })
  return (
    <div ref={ref} {...focus.props} dir="ltr" className={cn('relative', CHART_FOCUS, className)} style={{ height: rows.length * rowH }} onPointerLeave={onMouseLeave(() => setHover(null))}>
      {focus.a11y}
      {w > 0 && (
        <svg width={w} height={rows.length * rowH} aria-hidden className="block overflow-visible text-[11px]">
          {rows.map((r, i) => {
            const y = 6 + i * rowH, ok = r.value >= r.target
            return (
              <g key={r.label} data-ci={i} {...bind(body(r), () => setHover(i))}>
                <rect x={0} y={y - 6} width={w} height={rowH} fill="transparent" />
                <text x={0} y={y + 13} fill={hover === i ? 'var(--fg)' : 'var(--fg2)'} fontWeight={hover === i ? 600 : undefined}>{r.label}</text>
                <rect x={L} y={y} width={iw} height={18} rx={3} fill="var(--muted)" />
                {[...bands].sort((a, b) => b - a).map((b, k) => <rect key={b} x={L} y={y} width={iw * b} height={18} rx={3} fill={bandFill[k % bandFill.length]} />)}
                {hover === i && <rect x={L - 2} y={y - 2} width={iw + 4} height={22} rx={4} fill="none" stroke="var(--fg3)" strokeWidth={1.5} />}
                <motion.rect x={L} y={y + 6} height={6} rx={2} fill={ok ? 'var(--ok)' : miss} initial={{ width: 0 }} animate={{ width: seen ? X(r.value) - L : 0 }}
                  transition={{ duration: 0.8, delay: seen ? i * 0.1 : 0, ease: [0.22, 1, 0.36, 1] }} />
                <line x1={X(r.target)} x2={X(r.target)} y1={y + 2} y2={y + 16} stroke="var(--fg)" strokeWidth={2.5} strokeLinecap="round" />
              </g>
            )
          })}
        </svg>
      )}
      {tip && <ChartTooltip x={tip.x} y={tip.y} width={w}>{tip.body}</ChartTooltip>}
    </div>
  )
}

/* ── Statistical charts ──────────────────────────────────────────────────── */

const statMean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
const statSd = (a: number[]) => { const m = statMean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)) }
const statQuantile = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo) }
const statKde = (a: number[], xs: number[], bw: number) => xs.map(x => a.reduce((s, v) => s + Math.exp(-0.5 * ((x - v) / bw) ** 2), 0) / (a.length * bw * 2.5066))
const statBandwidth = (a: number[]) => 1.06 * statSd(a) * a.length ** -0.2 || 1

function StatGridY({ ticks, Y, x1, x2, format: formatProp }: { ticks: number[]; Y: (v: number) => number; x1: number; x2: number; format?: (v: number) => string }) {
  const { fixed } = useChartLocale(), format = formatProp ?? ((v: number) => fixed(v, 0))
  return <>{ticks.map(t => <g key={t}><line x1={x1} x2={x2} y1={Y(t)} y2={Y(t)} stroke="var(--line)" strokeDasharray="2 3" /><text x={x1 - 6} y={Y(t)} dy="0.32em" textAnchor="end" fill="var(--fg3)">{format(t)}</text></g>)}</>
}
const ticksIn = (lo: number, hi: number, count = 4) => niceTicks(lo, hi, count).filter(t => t >= lo - 1e-9 && t <= hi + 1e-9)

function regressionFit(P: [number, number][]) {
  const n = P.length, xs = P.map(p => p[0]), ys = P.map(p => p[1]), mx = statMean(xs), my = statMean(ys)
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 1, sxy = P.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0), b = sxy / sxx, a = my - b * mx
  const res = P.map(([x, y]) => y - (a + b * x)), sse = res.reduce((s, r) => s + r * r, 0), se = Math.sqrt(sse / Math.max(1, n - 2))
  const sst = ys.reduce((s, y) => s + (y - my) ** 2, 0) || 1, t = 1.96 + 2.4 / Math.max(1, n - 2) // ≈ t(0.975, n−2)
  const x0 = Math.floor(minOf(xs)), x1 = Math.ceil(maxOf(xs))
  const band = Array.from({ length: 41 }, (_, i) => { const x = x0 + ((x1 - x0) * i) / 40, h2 = 1 / n + (x - mx) ** 2 / sxx; return [x, a + b * x, t * se * Math.sqrt(h2), t * se * Math.sqrt(1 + h2)] })
  return { a, b, r2: 1 - sse / sst, se, n, seb: se / Math.sqrt(sxx), band, pts: P.map(p => [p[0], p[1]]) }
}

/**
 * Scatter with a least-squares fit, the 95% confidence band for the mean and (optionally) the wider 95% prediction interval.
 * Hover, tap or slide a finger for a crosshair readout; a stats footer shows slope, intercept, R², residual SE and n. New `points` morph in place.
 */
export function RegressionChart({ points, prediction = true, height = 240, xDomain, yDomain, footer = true, label: labelProp, className }:
  { points: [number, number][]; prediction?: boolean; height?: number; xDomain?: [number, number]; yDomain?: [number, number]; footer?: boolean; /** accessible name */ label?: string; className?: string }) {
  const [ref, w, seen] = useChartFrame<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const { cm, fmt: lf, fixed } = useChartLocale(CHART_REGRESSION_MESSAGES)
  const label = labelProp ?? cm('regression')
  useOutside([ref], () => setHover(null), hover !== null, { escape: true })
  const fit = useMemo(() => regressionFit(points), [points])
  const collapsed = useMemo(() => ({ ...fit, band: fit.band.map(r => [r[0], r[1], 0, 0]), pts: fit.pts.map(([x]) => [x, fit.a + fit.b * x]) }), [fit])
  const S = useTween(seen ? fit : collapsed)
  const xd = xDomain ?? extent(points.map(p => p[0])), yd = yDomain ?? [minOf(points.map(p => p[1]), 0), maxOf(points.map(p => p[1]))]
  const pad = { l: 40, r: 10, t: 10, b: 26 }, iw = Math.max(0, w - pad.l - pad.r), ih = height - pad.t - pad.b
  const X = (v: number) => pad.l + ((v - xd[0]) / (xd[1] - xd[0] || 1)) * iw, Y = (v: number) => pad.t + ih - ((v - yd[0]) / (yd[1] - yd[0] || 1)) * ih
  const poly = (k: number) => S.band.map(r => `${p1(X(r[0]))},${p1(Y(r[1] + r[k]))}`).join(' ') + ' ' + S.band.slice().reverse().map(r => `${p1(X(r[0]))},${p1(Y(r[1] - r[k]))}`).join(' ')
  const row = hover === null ? null : S.band[hover]
  const regressionPick = (e: ReactPointerEvent<SVGRectElement>) => {
    const xv = xd[0] + ((e.clientX - e.currentTarget.getBoundingClientRect().left) / (iw || 1)) * (xd[1] - xd[0]), b0 = fit.band[0][0], b1 = fit.band[40][0]
    setHover(Math.max(0, Math.min(40, Math.round(((xv - b0) / (b1 - b0 || 1)) * 40))))
  }
  const focus = useChartFocus({
    count: fit.band.length, index: hover, onIndex: setHover, label, start: 20,
    summary: cm('regSummary', { n: fit.n, a: fixed(fit.a), b: fixed(fit.b, 2), r2: fixed(fit.r2, 2) }),
    describe: i => { const r = fit.band[i]; return cm('regDescribe', { x: fixed(r[0], 0), y: fixed(r[1]), ci: fixed(r[2]) }) + (prediction ? ', ' + cm('regPred', { p: fixed(r[3]) }) : '') },
  })
  const kv = (k: string, v: string) => <span key={k} className="text-xs text-[var(--fg3)]">{k}<b className="ms-1 font-[family-name:var(--mono)] font-semibold text-[var(--fg)]">{v}</b></span>
  return (
    <div className={className}>
      <div ref={ref} {...focus.props} dir="ltr" className={cn('relative', CHART_FOCUS)} style={{ height }} onPointerLeave={onMouseLeave(() => setHover(null))}>
        {focus.a11y}
        {w > 0 && (
          <svg width={w} height={height} aria-hidden className="block touch-pan-y overflow-visible text-[11px]">
            <StatGridY ticks={ticksIn(yd[0], yd[1], 5)} Y={Y} x1={pad.l} x2={w - pad.r} />
            {ticksIn(xd[0], xd[1]).map(t => <text key={t} x={X(t)} y={height - 8} textAnchor="middle" fill="var(--fg3)">{lf.number(t)}</text>)}
            <motion.polygon points={poly(3)} fill="var(--accent)" initial={false} animate={{ opacity: prediction ? 0.07 : 0 }} />
            <polygon points={poly(2)} fill="var(--accent)" opacity={0.16} />
            {S.pts.map((p, i) => <circle key={i} cx={X(p[0])} cy={Y(p[1])} r={3} fill="var(--fg2)" opacity={0.55} />)}
            <path d={linePath(S.band.map(r => [X(r[0]), Y(r[1])]))} fill="none" stroke="var(--accent)" strokeWidth={2.2} />
            {row && <line x1={X(row[0])} x2={X(row[0])} y1={pad.t} y2={pad.t + ih} stroke="var(--fg3)" strokeDasharray="3 3" />}
            {row && <circle cx={X(row[0])} cy={Y(row[1])} r={4} fill="var(--accent)" stroke="var(--card)" strokeWidth={2} />}
            <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent" onPointerDown={e => regressionPick(e)} onPointerMove={e => regressionPick(e)} />
          </svg>
        )}
        {row && w > 0 && (
          <ChartTooltip x={X(row[0])} y={Math.max(0, Y(row[1] + row[3]) - 10)} width={w}>
            <div className="mb-1 font-medium">{cm('xEq', { x: fixed(row[0], 0) })}</div>
            <TooltipRow color="var(--accent)" label="ŷ" value={fixed(row[1])} />
            <TooltipRow color="var(--band)" label={cm('ci95')} value={`± ${fixed(row[2])}`} />
            {prediction && <TooltipRow color="var(--band)" label={cm('prediction')} value={`± ${fixed(row[3])}`} />}
          </ChartTooltip>
        )}
      </div>
      {footer && <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
        {[kv(cm('slope'), `${fixed(S.b, 2)} ± ${fixed(1.96 * S.seb, 2)}`), kv(cm('intercept'), fixed(S.a)), kv('R²', fixed(S.r2, 2)), kv(cm('residualSE'), fixed(S.se)), kv('n', lf.number(Math.round(S.n)))]}
      </div>}
    </div>
  )
}

export type BoxGroup = { label: string; values: number[]; color?: string }
function boxStats(a: number[]) {
  const q1 = statQuantile(a, 0.25), q3 = statQuantile(a, 0.75), iqr = q3 - q1
  const lo = Math.max(minOf(a), q1 - 1.5 * iqr), hi = Math.min(maxOf(a), q3 + 1.5 * iqr), inner = a.filter(v => v >= lo && v <= hi)
  const ys = Array.from({ length: 41 }, (_, k) => lo + ((hi - lo) * k) / 40)
  // the violin is the density between the whisker ends, so outliers show as dots instead of long spikes
  return { q1, q2: statQuantile(a, 0.5), q3, lo, hi, ys, dens: statKde(inner, ys, statBandwidth(inner)), out: a.filter(v => v < lo || v > hi).slice(0, 6) }
}
/**
 * Distributions per group: box (median, quartiles, 1.5 × IQR whiskers), KDE violin, or both, with outliers as dots.
 * Hover or tap a box or outlier for numbers. New values morph in place.
 */
export function BoxViolinChart({ groups, mode = 'both', domain, height = 200, format: formatProp, label: labelProp, className }:
  { groups: BoxGroup[]; mode?: 'box' | 'violin' | 'both'; domain?: [number, number]; height?: number; format?: (v: number) => string; /** accessible name */ label?: string; className?: string }) {
  const [ref, w, seen] = useChartFrame<HTMLDivElement>()
  const [tip, bind, , tipAt] = useChartTip(ref)
  const { cm, fmt: lf, fixed } = useChartLocale(CHART_BOX_MESSAGES)
  const format = formatProp ?? ((v: number) => fixed(v)), label = labelProp ?? cm('boxViolin')
  const [hoverAt, setHover] = useState<number | null>(null)
  const hover = chartIndex(hoverAt, groups.length)
  // the box and violin morph between samples; outliers (their count varies) tween on their own, so a changed count only
  // snaps the dots. useTween snaps whenever the shape changes, so adding or removing groups never indexes past the end.
  const stats = useMemo(() => groups.map(g => { const { out, ...k } = boxStats(g.values); return k }), [groups])
  const outs = useMemo(() => groups.map(g => boxStats(g.values).out), [groups])
  const collapsed = useMemo(() => stats.map(k => ({ ...k, q1: k.q2, q3: k.q2, lo: k.q2, hi: k.q2, ys: k.ys.map(() => k.q2), dens: k.dens.map(() => 0) })), [stats])
  const collapsedOuts = useMemo(() => outs.map((o, i) => o.map(() => stats[i].q2)), [outs, stats])
  const S = useTween(seen ? stats : collapsed), O = useTween(seen ? outs : collapsedOuts)
  const all = groups.flatMap(g => g.values), dom = domain ?? (all.length ? extent(all) : [0, 1])
  const pad = { l: 30, r: 10, t: 8, b: 24 }, iw = Math.max(0, w - pad.l - pad.r), ih = height - pad.t - pad.b
  const Y = (v: number) => pad.t + ih - ((v - dom[0]) / (dom[1] - dom[0] || 1)) * ih, slot = iw / Math.max(1, groups.length), JIT = [-4, 3, -2, 5, -5, 2]
  const boxTip = (i: number) => () => { const k = stats[i]; return <>
    <div className="mb-1 font-medium">{groups[i].label}</div>
    <TooltipRow color={groups[i].color ?? PALETTE[i % PALETTE.length]} label={cm('median')} value={format(k.q2)} />
    <TooltipRow color={groups[i].color ?? PALETTE[i % PALETTE.length]} label={cm('iqr')} value={`${format(k.q1)} – ${format(k.q3)}`} />
    <TooltipRow color={groups[i].color ?? PALETTE[i % PALETTE.length]} label={cm('whiskers')} value={`${format(k.lo)} – ${format(k.hi)}`} />
  </> }
  const focus = useChartFocus({
    count: groups.length, index: hover, label, onIndex: i => { setHover(i); tipAt(i, i === null ? undefined : boxTip(i)) },
    summary: cm('boxGroups', { n: groups.length, list: lf.list(groups.map((g, i) => cm('boxMedian', { label: g.label, v: format(stats[i].q2) }))) }),
    describe: i => { const k = stats[i]; return cm('boxDescribe', { label: groups[i].label, q2: format(k.q2), q1: format(k.q1), q3: format(k.q3), lo: format(k.lo), hi: format(k.hi) }) + (outs[i].length ? ', ' + cm('outliers', { n: outs[i].length }) : '') },
  })
  return (
    <div ref={ref} {...focus.props} dir="ltr" className={cn('relative', CHART_FOCUS, className)} style={{ height }} onPointerLeave={onMouseLeave(() => setHover(null))}>
      {focus.a11y}
      {w > 0 && (
        <svg width={w} height={height} aria-hidden className="block overflow-visible text-[11px]">
          <StatGridY ticks={ticksIn(dom[0], dom[1])} Y={Y} x1={pad.l} x2={w - pad.r} />
          {S.map((k, i) => {
            const g = groups[i], color = g.color ?? PALETTE[i % PALETTE.length], cx = pad.l + slot * (i + 0.5), mx = maxOf(k.dens) || 1, wv = slot * 0.36, bxw = mode === 'both' ? 9 : 16
            const right = k.ys.map((v, j) => `L${p1(cx + (k.dens[j] / mx) * wv)},${p1(Y(v))}`).join(''), left = k.ys.map((v, j) => `L${p1(cx - (k.dens[j] / mx) * wv)},${p1(Y(v))}`).reverse().join('')
            return (
              <g key={g.label} data-ci={i} opacity={hover === null || hover === i ? 1 : 0.5} onPointerEnter={() => setHover(i)}>
                {mode !== 'box' && <path d={`M${p1(cx)},${p1(Y(k.lo))}${right}L${p1(cx)},${p1(Y(k.hi))}${left}Z`} fill={color} fillOpacity={mode === 'both' ? 0.16 : 0.3} stroke={color} strokeOpacity={0.7} strokeWidth={1.2} strokeLinejoin="round" />}
                {mode !== 'violin' && <>
                  <line x1={cx} x2={cx} y1={Y(k.lo)} y2={Y(k.hi)} stroke="var(--fg2)" />
                  {[k.lo, k.hi].map((v, j) => <line key={j} x1={cx - 5} x2={cx + 5} y1={Y(v)} y2={Y(v)} stroke="var(--fg2)" />)}
                  <rect x={cx - bxw} y={Y(k.q3)} width={bxw * 2} height={Math.max(0, Y(k.q1) - Y(k.q3))} rx={3} fill="var(--card)" stroke={color} strokeWidth={1.6} className="cursor-default"
                    {...bind(() => <>
                      <div className="mb-1 font-medium">{g.label}</div>
                      <TooltipRow color={color} label={cm('median')} value={format(k.q2)} />
                      <TooltipRow color={color} label={cm('iqr')} value={`${format(k.q1)} – ${format(k.q3)}`} />
                      <TooltipRow color={color} label={cm('whiskers')} value={`${format(k.lo)} – ${format(k.hi)}`} />
                    </>)} />
                  <line x1={cx - bxw} x2={cx + bxw} y1={Y(k.q2)} y2={Y(k.q2)} stroke="var(--fg)" strokeWidth={1.5} pointerEvents="none" />
                </>}
                {mode === 'violin' && <circle cx={cx} cy={Y(k.q2)} r={3} fill="var(--fg)" stroke="transparent" strokeWidth={16} {...bind(() => <><div className="mb-1 font-medium">{g.label}</div><TooltipRow color={color} label={cm('median')} value={format(k.q2)} /></>)} />}
                {(O[i] ?? []).map((v, j) => <circle key={j} cx={cx + JIT[j % JIT.length]} cy={Y(v)} r={2.8} fill="var(--bad)" opacity={0.9} stroke="transparent" strokeWidth={14}
                  {...bind(() => <><div className="mb-1 font-medium">{g.label}</div><TooltipRow color="var(--bad)" label={cm('outlier')} value={format(v)} /></>)} />)}
                <text x={cx} y={height - 7} textAnchor="middle" fill={hover === i ? 'var(--fg)' : 'var(--fg3)'} fontWeight={hover === i ? 600 : undefined}>{g.label}</text>
              </g>
            )
          })}
        </svg>
      )}
      {tip && <ChartTooltip x={tip.x} y={tip.y} width={w}>{tip.body}</ChartTooltip>}
    </div>
  )
}

/**
 * Histogram with a kernel-density curve, mean (dashed), median and a ±1σ shaded band. `bins` is usually driven by a slider;
 * bins, density and markers all morph when it or the data changes. Hover or tap a bar for its range and count.
 */
export function DensityHistogram({ values, bins = 18, domain, height = 190, label: labelProp, className }: { values: number[]; bins?: number; domain?: [number, number]; height?: number; /** accessible name */ label?: string; className?: string }) {
  const [ref, w, seen] = useChartFrame<HTMLDivElement>()
  const [tip, bind, , tipAt] = useChartTip(ref)
  const { cm, fmt: lf, fixed } = useChartLocale(CHART_HISTOGRAM_MESSAGES)
  const label = labelProp ?? cm('histogram')
  const [hoverAt, setHover] = useState<number | null>(null)
  const [d0, d1] = domain ?? [NaN, NaN]
  const dom = useMemo(() => (Number.isFinite(d0) ? [d0, d1] : niceTicks(minOf(values), maxOf(values)).filter((_, i, a) => i === 0 || i === a.length - 1)) as [number, number], [d0, d1, values])
  const xs = useMemo(() => Array.from({ length: 81 }, (_, i) => dom[0] + ((dom[1] - dom[0]) * i) / 80), [dom])
  const kde = useMemo(() => statKde(values, xs, statBandwidth(values)), [values, xs])
  const stats = useMemo(() => {
    const width = (dom[1] - dom[0]) / bins, counts = Array(Math.max(40, bins)).fill(0)
    values.forEach(v => { const k = Math.floor((v - dom[0]) / width); if (k >= 0 && k < bins) counts[k]++ })
    const dens = counts.map(c => c / (values.length * width))
    return { dens, bins, kde, m: statMean(values), md: statQuantile(values, 0.5), sd: statSd(values), ymax: maxOf(kde, maxOf(dens)) * 1.12 }
  }, [values, bins, kde, dom])
  const collapsed = useMemo(() => ({ ...stats, dens: stats.dens.map(() => 0), kde: stats.kde.map(() => 0), sd: 0 }), [stats])
  const S = useTween(seen ? stats : collapsed, 450)
  const pad = { l: 12, r: 8, t: 10, b: 24 }, iw = Math.max(0, w - pad.l - pad.r), ih = height - pad.t - pad.b
  const X = (v: number) => pad.l + ((v - dom[0]) / (dom[1] - dom[0] || 1)) * iw, Y = (v: number) => pad.t + ih - Math.min(1, v / (S.ymax || 1)) * ih
  const nb = Math.round(S.bins), bwv = (dom[1] - dom[0]) / nb
  const hover = chartIndex(hoverAt, bins)
  const binLo = (i: number) => dom[0] + (i * (dom[1] - dom[0])) / bins, binN = (i: number) => Math.round(stats.dens[i] * values.length * ((dom[1] - dom[0]) / bins))
  const binTip = (i: number) => () => <><div className="mb-1 font-medium">{fixed(binLo(i), 0)}–{fixed(binLo(i + 1), 0)}</div><TooltipRow color="var(--accent)" label={cm('values')} value={lf.number(binN(i))} /></>
  const focus = useChartFocus({
    count: bins, index: hover, label, onIndex: i => { setHover(i); tipAt(i, i === null ? undefined : binTip(i)) },
    summary: cm('histSummary', { n: values.length, bins, lo: fixed(dom[0], 0), hi: fixed(dom[1], 0), m: fixed(stats.m), md: fixed(stats.md), sd: fixed(stats.sd) }),
    describe: i => cm('binDescribe', { lo: fixed(binLo(i), 0), hi: fixed(binLo(i + 1), 0), n: binN(i) }),
  })
  return (
    <div ref={ref} {...focus.props} dir="ltr" className={cn('relative', CHART_FOCUS, className)} style={{ height }} onPointerLeave={onMouseLeave(() => setHover(null))}>
      {focus.a11y}
      {w > 0 && (
        <svg width={w} height={height} aria-hidden className="block overflow-visible text-[11px]">
          <line x1={pad.l} x2={w - pad.r} y1={pad.t + ih} y2={pad.t + ih} stroke="var(--line)" />
          <rect x={X(S.m - S.sd)} y={pad.t} width={Math.max(0, X(S.m + S.sd) - X(S.m - S.sd))} height={ih} fill="color-mix(in srgb, var(--fg) 6%, transparent)" />
          {Array.from({ length: nb }, (_, i) => {
            const lo = dom[0] + i * bwv
            return <rect key={i} data-ci={i} x={X(lo) + 1} y={Y(S.dens[i])} width={Math.max(0, X(lo + bwv) - X(lo) - 2)} height={Math.max(0, Y(0) - Y(S.dens[i]))} rx={2} fill="var(--accent)" opacity={hover === i ? 0.5 : 0.22}
              {...bind(() => <><div className="mb-1 font-medium">{fixed(lo, 0)}–{fixed(lo + bwv, 0)}</div><TooltipRow color="var(--accent)" label={cm('values')} value={lf.number(Math.round(stats.dens[i] * values.length * bwv))} /></>, () => setHover(i))} />
          })}
          <path d={chartPath(xs.map((v, i) => [X(v), Y(S.kde[i])]))} fill="none" stroke="var(--accent)" strokeWidth={2} pointerEvents="none" />
          <line x1={X(S.m)} x2={X(S.m)} y1={pad.t} y2={pad.t + ih} stroke="var(--bad)" strokeWidth={1.5} strokeDasharray="4 3" pointerEvents="none" />
          <line x1={X(S.md)} x2={X(S.md)} y1={pad.t} y2={pad.t + ih} stroke="var(--fg)" strokeWidth={1.5} pointerEvents="none" />
          {ticksIn(dom[0], dom[1]).map(t => <text key={t} x={X(t)} y={height - 8} textAnchor="middle" fill="var(--fg3)">{lf.number(t)}</text>)}
          <text x={w - pad.r} y={pad.t + 10} textAnchor="end" fill="var(--bad)">{cm('meanV', { v: fixed(S.m) })}</text>
          <text x={w - pad.r} y={pad.t + 24} textAnchor="end" fill="var(--fg)">{cm('medianV', { v: fixed(S.md) })}</text>
          <text x={w - pad.r} y={pad.t + 38} textAnchor="end" fill="var(--fg3)">{cm('sigmaV', { v: fixed(S.sd) })}</text>
        </svg>
      )}
      {tip && <ChartTooltip x={tip.x} y={tip.y} width={w}>{tip.body}</ChartTooltip>}
    </div>
  )
}

export type ForestRow = { label: string; effect: number; se: number }
/**
 * Forest plot: effect sizes with 95% CI whiskers, squares sized by inverse-variance weight, a pooled diamond and a zero line.
 * Rows whose interval clears 0 are coloured as significant. New rows morph in place; hover or tap a row for its numbers.
 * Below 400px wide the right column shows the effect only (the interval stays drawn and is in the tooltip).
 */
export function ForestPlot({ rows, domain = [-0.1, 0.2], ticks = [-0.1, 0, 0.1, 0.2], height = 220, label: labelProp, valueLabel: valueProp, lower: lowerProp, higher: higherProp, name: nameProp, className }:
  { rows: ForestRow[]; domain?: [number, number]; ticks?: number[]; height?: number; label?: string; valueLabel?: string; lower?: string; higher?: string; /** accessible name */ name?: string; className?: string }) {
  const [ref, w, seen] = useChartFrame<HTMLDivElement>()
  const [tip, bind, , tipAt] = useChartTip(ref)
  const { cm, fmt: lf } = useChartLocale(CHART_FOREST_MESSAGES)
  const label = labelProp ?? cm('segment'), valueLabel = valueProp ?? cm('lift'), lower = lowerProp ?? cm('worse'), higher = higherProp ?? cm('better'), name = nameProp ?? cm('forest')
  /** +12.3% (signed, one decimal, the locale's digits and percent sign) */
  const forestPct = (v: number) => lf.number(v, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' })
  /** the interval ends without the % sign: −1.2, 0.0, 3.4 */
  const forestCi = (v: number) => lf.number(Math.round(v * 1000) / 10 || 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const ci = (e: number, lo: number, hi: number) => cm('ciText', { effect: forestPct(e), lo: forestPct(lo), hi: forestPct(hi) })
  const [hoverAt, setHover] = useState<number | null>(null)
  const hover = chartIndex(hoverAt, rows.length + 1)
  const state = useMemo(() => {
    const wsum = rows.reduce((a, r) => a + 1 / r.se ** 2, 0) || 1
    return { rows: rows.map(r => [r.effect, r.se]), pooled: rows.reduce((a, r) => a + r.effect / r.se ** 2, 0) / wsum, pse: Math.sqrt(1 / wsum) }
  }, [rows])
  const collapsed = useMemo(() => ({ rows: state.rows.map(([, se]) => [0, se * 0.001]), pooled: 0, pse: state.pse * 0.001 }), [state])
  const S = useTween(seen ? state : collapsed)
  const narrow = w > 0 && w < 400
  const L = 72, R = narrow ? 50 : 118, T = 18, B = 34, X = (v: number) => L + (Math.max(0, w - L - R) * (Math.max(domain[0], Math.min(domain[1], v)) - domain[0])) / (domain[1] - domain[0])
  const rowH = (height - T - B) / (rows.length + 1.4), wts = S.rows.map(r => 1 / r[1] ** 2), maxW = maxOf(wts, 0) || 1, wsum = wts.reduce((a, b) => a + b, 0) || 1
  const py = T + rowH * (rows.length + 0.9), plo = S.pooled - 1.96 * S.pse, phi = S.pooled + 1.96 * S.pse
  const rowSig = (r: ForestRow) => r.effect - 1.96 * r.se > 0 || r.effect + 1.96 * r.se < 0
  const rowTip = (i: number) => () => i < rows.length ? <>
    <div className="mb-1 font-medium">{rows[i].label}</div>
    <div className="text-[var(--fg2)]">{ci(rows[i].effect, rows[i].effect - 1.96 * rows[i].se, rows[i].effect + 1.96 * rows[i].se)}</div>
    <div className="text-[var(--fg2)]">{rowSig(rows[i]) ? cm('significant') : cm('notSignificant')}</div>
  </> : <><div className="mb-1 font-medium">{cm('pooledIV')}</div><div className="text-[var(--fg2)]">{ci(state.pooled, state.pooled - 1.96 * state.pse, state.pooled + 1.96 * state.pse)}</div></>
  const focus = useChartFocus({
    count: rows.length + 1, index: hover, label: name, onIndex: i => { setHover(i); tipAt(i, i === null ? undefined : rowTip(i)) },
    summary: cm('forestSummary', { n: rows.length, p: forestPct(state.pooled), k: rows.filter(rowSig).length }),
    describe: i => i < rows.length ? cm('forestDescribe', { label: rows[i].label, effect: forestPct(rows[i].effect), lo: forestPct(rows[i].effect - 1.96 * rows[i].se), hi: forestPct(rows[i].effect + 1.96 * rows[i].se), sig: rowSig(rows[i]) ? cm('significant') : cm('notSignificant') })
      : cm('pooledDescribe', { effect: forestPct(state.pooled), lo: forestPct(state.pooled - 1.96 * state.pse), hi: forestPct(state.pooled + 1.96 * state.pse) }),
  })
  return (
    <div ref={ref} {...focus.props} dir="ltr" className={cn('relative', CHART_FOCUS, className)} style={{ height }} onPointerLeave={onMouseLeave(() => setHover(null))}>
      {focus.a11y}
      {w > 0 && (
        <svg width={w} height={height} aria-hidden className="block overflow-visible text-[11px]">
          <text x={L - 8} y={10} textAnchor="end" fontWeight={600} fill="var(--fg2)">{label}</text>
          <text x={w - 2} y={10} textAnchor="end" fontWeight={600} fill="var(--fg2)">{narrow ? valueLabel.replace(/\s*\[.*\]\s*$/, '') : valueLabel}</text>
          {ticks.map(v => <g key={v}>
            <line x1={X(v)} x2={X(v)} y1={T} y2={height - B} stroke={v ? 'var(--line)' : 'var(--fg2)'} strokeWidth={v ? 1 : 1.2} strokeDasharray={v ? '2 3' : undefined} />
            <text x={X(v)} y={height - B + 14} textAnchor="middle" fill="var(--fg3)">{lf.number(v, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' })}</text>
          </g>)}
          <text x={X(0) - 4} y={height - 4} textAnchor="end" fill="var(--fg3)">{lower}</text>
          <text x={X(0) + 4} y={height - 4} fill="var(--fg3)">{higher}</text>
          {rows.map((r, i) => {
            const [e, se] = S.rows[i], lo = e - 1.96 * se, hi = e + 1.96 * se, cy = T + rowH * (i + 0.5), sig = lo > 0 || hi < 0, col = sig ? 'var(--accent)' : 'var(--fg3)', sz = 4 + 4 * Math.sqrt(wts[i] / maxW)
            return (
              <g key={r.label}>
                {hover === i && <rect x={2} y={cy - rowH / 2 + 1} width={w - 4} height={rowH - 2} rx={4} fill="var(--muted)" />}
                <text x={L - 8} y={cy} dy="0.32em" textAnchor="end" fill="var(--fg)">{r.label}</text>
                <line x1={X(lo)} x2={X(hi)} y1={cy} y2={cy} stroke={col} strokeWidth={1.6} strokeLinecap="round" />
                <rect data-ci={i} x={0} y={cy - rowH / 2} width={w} height={rowH} fill="transparent"
                  {...bind(() => <>
                    <div className="mb-1 font-medium">{r.label}</div>
                    <div className="text-[var(--fg2)]">{ci(r.effect, r.effect - 1.96 * r.se, r.effect + 1.96 * r.se)}</div>
                    <div className="text-[var(--fg2)]">{sig ? cm('significant') : cm('notSignificant')} · {cm('weight', { pct: lf.percent(wts[i] / wsum, 0) })}</div>
                  </>, () => setHover(i))} />
                <rect x={X(e) - sz / 2} y={cy - sz / 2} width={sz} height={sz} rx={1.5} fill={col} pointerEvents="none" />
                <text x={w - 2} y={cy} dy="0.32em" textAnchor="end" fontFamily="var(--mono)" pointerEvents="none" fill={sig ? 'var(--fg)' : 'var(--fg3)'}>{forestPct(e)}{narrow ? '' : ` [${forestCi(lo)}, ${forestCi(hi)}]`}</text>
              </g>
            )
          })}
          <line x1={8} x2={w - 2} y1={py - rowH * 0.6} y2={py - rowH * 0.6} stroke="var(--line)" />
          {hover === rows.length && <rect x={2} y={py - rowH / 2 + 1} width={w - 4} height={rowH - 2} rx={4} fill="var(--muted)" />}
          <text x={L - 8} y={py} dy="0.32em" textAnchor="end" fontWeight={600} fill="var(--fg)">{cm('pooled')}</text>
          <path d={`M${p1(X(plo))},${p1(py)}L${p1(X(S.pooled))},${p1(py - 6)}L${p1(X(phi))},${p1(py)}L${p1(X(S.pooled))},${p1(py + 6)}Z`} fill="var(--fg)" />
          <rect data-ci={rows.length} x={0} y={py - rowH / 2} width={w} height={rowH} fill="transparent"
            {...bind(() => <><div className="mb-1 font-medium">{cm('pooledIV')}</div><div className="text-[var(--fg2)]">{ci(state.pooled, state.pooled - 1.96 * state.pse, state.pooled + 1.96 * state.pse)}</div></>, () => setHover(rows.length))} />
          <text x={w - 2} y={py} dy="0.32em" textAnchor="end" fontFamily="var(--mono)" fontWeight={600} pointerEvents="none" fill="var(--fg)">{forestPct(S.pooled)}{narrow ? '' : ` [${forestCi(plo)}, ${forestCi(phi)}]`}</text>
        </svg>
      )}
      {tip && <ChartTooltip x={tip.x} y={tip.y} width={w}>{tip.body}</ChartTooltip>}
    </div>
  )
}
