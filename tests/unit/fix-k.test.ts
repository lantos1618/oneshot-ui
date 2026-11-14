// Package K: build scripts, docs data, the theme script in index.html, and theme export.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEME_EXPORT_FORMATS, themeExport, themeToCSS, themeToDTCG, themeToDTCGTokens, themeToShadcn, themeToTailwind, themeToTokensStudio } from '../../src/lib/themeexport'
import { themeScriptSource } from '../../src/lib/provider'
import { TAG_CARDS } from '../../src/showcase/tags'
import { codeExampleFor } from '../../scripts/showcase-code'
import { docsDemos, showcaseSections } from '../../scripts/showcase-sections'
import { THEME_SCRIPT_MARK, themeScript, themeScriptHtml } from '../../scripts/theme-script'
import { assertPlaced, bundleOf } from '../../scripts/tiers.mjs'

const root = join(__dirname, '../..')

describe('single-file bundles (build-single)', () => {
  it('refuses a module that is in no bundle', () => {
    expect(() => assertPlaced(['charts.tsx', 'index.ts', 'brand-new.tsx'], 'build-single')).toThrow(/brand-new/)
    expect(bundleOf('brand-new')).toBeUndefined()
  })
})

describe('docs demos (build-docs-data)', () => {
  const sections = showcaseSections(root)
  const items = [...new Set(Object.values(TAG_CARDS).flatMap(c => c.items))].map(name => ({ name, title: name, exports: [] }))
  const { demos, unknownCards } = docsDemos(items, sections, TAG_CARDS)

  it('finds every TAG_CARDS title among the section cards, including cards rendered by helper components', () => {
    expect(unknownCards).toEqual([])
    const charts = sections.find(s => s.id === 'charts')!.specs.map(s => s.title)
    expect(charts).toEqual(expect.arrayContaining(['Sparklines', 'Treemap', 'Tags over time']))
  })

  it('gives every item TAG_CARDS names a demo with a card that names it', () => {
    for (const it of items) {
      const d = demos[it.name]
      expect(d, it.name).toBeDefined()
      expect(d.titles.some(t => TAG_CARDS[t].items.includes(it.name)), `${it.name}: ${d.titles}`).toBe(true)
    }
    expect(demos['spark-chart'].titles).toEqual(['Sparklines'])
    expect(demos.treemap.titles).toEqual(['Treemap'])
  })

  it('scores a helper-rendered card by its own children, not by the card before it', () => {
    const { demos: scored } = docsDemos([{ name: 'x', title: 'Unrelated title', exports: ['SparkChart'] }], sections, {})
    expect(scored.x?.titles).toContain('Sparklines')
    expect(scored.x?.titles).not.toContain('Candlestick')
  })
})

describe('view-code drawer examples', () => {
  it('imports chart components from ./ui-charts and marks showcase-only imports', () => {
    const file = 'src/showcase/ChartsSection.tsx', src = readFileSync(join(root, file), 'utf8')
    const ex = codeExampleFor('Treemap', { [`./${file}`]: src })!
    expect(ex.code).toMatch(/import \{[^}]*\bTreemap\b[^}]*\} from '\.\/ui-charts'/)
    const tags = codeExampleFor('Tags over time', { [`./${file}`]: src })!
    for (const line of tags.code.split('\n').filter(l => /from '\.\.\//.test(l))) expect(line).toMatch(/\/\/ /)
  })
})

describe('theme script in index.html', () => {
  it('fills the placeholder with themeScriptSource(), and throws without a placeholder or a script', () => {
    const html = themeScriptHtml(`<head>${THEME_SCRIPT_MARK}</head>`, themeScriptSource())
    expect(html).toBe(`<head><script>${themeScriptSource()}</script></head>`)
    expect(() => themeScriptHtml('<head></head>', themeScriptSource())).toThrow(/placeholder/)
    expect(() => themeScriptHtml(`<head>${THEME_SCRIPT_MARK}</head>`, '')).toThrow(/no script/)
  })

  it('the plugin builds the script from the library source', async () => {
    const out = await themeScript({ root }).transformIndexHtml(readFileSync(join(root, 'docs/index.html'), 'utf8'))
    expect(out).toContain(`<script>${themeScriptSource()}</script>`)
    expect(readFileSync(join(root, 'index.html'), 'utf8')).toContain(THEME_SCRIPT_MARK)
  })
})

describe('theme export', () => {
  const source = (bg: string, fg: string) => ({ label: 'T', modes: { light: { bg, fg } } })

  it('shadcn and DTCG read short hex like the CSS export', () => {
    const shadcn = themeToShadcn(source('#fff', '#000'))
    expect(shadcn).toContain('--background: oklch(1 0 0);')
    expect(shadcn).toContain('--foreground: oklch(0 0 0);')
    const color = themeToDTCGTokens(source('#fff', '#000')).color as Record<string, { $value: { hex: string; components: number[] } }>
    expect(color.bg.$value).toMatchObject({ hex: '#ffffff', components: [1, 1, 1] })
    expect(color.fg.$value).toMatchObject({ hex: '#000000', components: [0, 0, 0] })
    expect(themeToCSS(source('#fff', '#000'))).toContain('--bg: #fff;')
  })

  it('keeps the alpha of 8-digit hex and rgba() tokens', () => {
    const color = themeToDTCGTokens(source('#FFFFFF80', 'rgba(0,0,0,0.5)')).color as Record<string, { $value: { alpha?: number; hex: string } }>
    expect(color.bg.$value.alpha).toBeCloseTo(128 / 255, 3)
    expect(color.bg.$value.hex).toBe('#ffffff')
    expect(color.fg.$value.alpha).toBe(0.5)
    expect(themeToShadcn(source('#FFFFFF80', '#000'))).toContain('--background: oklch(1 0 0 / 50.2%);')
  })

  it('has its own exporter for every format, each in that format', () => {
    const input = source('#FFFFFF', '#000000')
    expect(THEME_EXPORT_FORMATS.map(f => f.id)).toEqual(['css', 'tailwind', 'shadcn', 'dtcg', 'tokens-studio'])
    const out = Object.fromEntries(THEME_EXPORT_FORMATS.map(({ id }) => [id, themeExport(id, input)]))
    expect(out.css).toBe(themeToCSS(input))
    expect(out.css).toContain('--bg: #FFFFFF;')
    expect(out.tailwind).toBe(themeToTailwind(input))
    expect(out.tailwind).toMatch(/@theme\b/)
    expect(out.tailwind).toMatch(/--color-[\w-]+: /)
    expect(out.shadcn).toBe(themeToShadcn(input))
    expect(out.shadcn).toContain('--background: oklch(1 0 0);')
    expect(out.dtcg).toBe(themeToDTCG(input))
    const dtcg = JSON.parse(out.dtcg) as { color: Record<string, { $value: { hex: string } }> }
    expect(dtcg.color.bg).toMatchObject({ $value: { hex: '#ffffff' } })
    expect(out['tokens-studio']).toBe(themeToTokensStudio(input))
    const studio = JSON.parse(out['tokens-studio']) as { light: { color: Record<string, { value: string; type: string }> }; $themes: unknown[] }
    expect(studio.light.color.bg).toEqual({ value: '#FFFFFF', type: 'color' })
    expect(Array.isArray(studio.$themes)).toBe(true)
    expect(() => themeExport('nope' as never, input)).toThrow(/nope/)
  })
})
