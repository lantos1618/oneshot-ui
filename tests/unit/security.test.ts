// Security helpers: the payloads from review/security-content.md (and the usual suspects) must come out harmless.
import { describe, expect, it } from 'vitest'
import { cssUrl, safeColor, safeCssValue, safeMediaUrl, safeUrl } from '../../src/lib/utils'
import { sanitizeRichText } from '../../src/lib/editor'

const BAD_URLS = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  '  javascript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  'java\rscript:alert(1)',
  '\u0001javascript:alert(1)',
  'javascript\u0000:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  'ms-msdt:/id PCWDiagnostic',
  'search-ms:query=x&crumb=location:\\\\evil',
  'blob:https://example.com/0f0f',
]

describe('safeUrl', () => {
  it.each(BAD_URLS)('blocks %j', url => {
    expect(safeUrl(url)).toBe('#')
    expect(safeUrl(url, { fallback: '' })).toBe('')
  })
  it.each(['https://example.com/a?b=c#d', 'http://example.com', 'mailto:a@example.com', 'tel:+441234', '/docs', 'docs/page', '?q=1', '#section', '//cdn.example.com/x'])(
    'keeps %j', url => expect(safeUrl(url)).toBe(url))
  it('trims surrounding whitespace from allowed URLs', () => expect(safeUrl('  https://example.com  ')).toBe('https://example.com'))
  it.each([null, undefined, '', '   '])('falls back for %j', v => expect(safeUrl(v)).toBe('#'))
  it('honours a custom allowlist', () => {
    expect(safeUrl('mailto:a@b.c', { allow: ['https:'] })).toBe('#')
    expect(safeUrl('https://x.test', { allow: ['https:'] })).toBe('https://x.test')
    expect(safeUrl('http://x.test', { allow: ['https:'], fallback: 'about:blank' })).toBe('about:blank')
  })
})

describe('safeMediaUrl', () => {
  it('allows http(s), blob and data URLs of the right kind', () => {
    expect(safeMediaUrl('https://img.test/a.png')).toBe('https://img.test/a.png')
    expect(safeMediaUrl('blob:https://app.test/1234')).toBe('blob:https://app.test/1234')
    expect(safeMediaUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(safeMediaUrl('data:audio/mpeg;base64,AAAA', 'audio')).toBe('data:audio/mpeg;base64,AAAA')
    expect(safeMediaUrl('data:video/mp4;base64,AAAA', 'video')).toBe('data:video/mp4;base64,AAAA')
  })
  it.each(['javascript:alert(1)', 'vbscript:x', 'file:///c:/x.png', 'data:text/html,<script>alert(1)</script>', 'DATA:text/html,x', 'data:application/javascript,alert(1)'])(
    'blocks %j', url => expect(safeMediaUrl(url)).toBe(''))
  it('rejects a data URL of another kind', () => {
    expect(safeMediaUrl('data:image/png;base64,AAAA', 'video')).toBe('')
    expect(safeMediaUrl('data:video/mp4;base64,AAAA', 'image')).toBe('')
  })
  it('returns empty for nothing', () => { expect(safeMediaUrl(null)).toBe(''); expect(safeMediaUrl(undefined)).toBe('') })
})

describe('cssUrl', () => {
  it('wraps a safe URL in url("…")', () => expect(cssUrl('https://img.test/a.png')).toBe('url("https://img.test/a.png")'))
  it.each(['javascript:alert(1)', 'data:text/html,x', '', null, undefined])('gives none for %j', v => expect(cssUrl(v)).toBe('none'))
  it.each([
    'https://x.test/a.png"); background: url("https://evil.test/track',
    'https://x.test/a\\"); color: red; x: ("',
    'https://x.test/a.png\n}body{display:none}',
    'https://x.test/a.png\r");@import "https://evil.test/x.css',
  ])('cannot break out of the url() for %j', payload => {
    const out = cssUrl(payload)
    expect(out.startsWith('url("')).toBe(true)
    expect(out.endsWith('")')).toBe(true)
    const inner = out.slice(5, -2)
    expect(inner).not.toMatch(/["\n\r]/) // quotes and newlines are escaped as \22 , \a , \d
    expect(inner.replace(/\\[0-9a-f]{1,6} /gi, '')).not.toMatch(/\\/) // the only backslashes left are hex escapes
  })
})

describe('safeCssValue / safeColor', () => {
  it.each(['#fff', '#1a2b3c80', 'red', 'rgb(1, 2, 3)', 'rgba(0,0,0,.5)', 'hsl(210 40% 50%)', 'var(--accent)', 'color-mix(in srgb, var(--ok) 50%, transparent)', 'calc(100% - 4px)', '12px', '1.5rem', '0 1px 2px rgba(0,0,0,.1)'])(
    'keeps %j', v => expect(safeCssValue(v)).toBe(v))
  it.each([
    'red;position:fixed;inset:0',
    'red; background-image: url(https://evil.test/x)',
    'url(https://evil.test/x)',
    'URL (https://evil.test/x)',
    'u\\72l(https://evil.test/x)',
    'expression(alert(1))',
    'image-set("https://evil.test/x" 1x)',
    'image-set(x 1x)',
    '}body{display:none',
    'red}',
    '"quoted"',
    "'quoted'",
    '@import "x"',
    'red !important',
    '<style>',
    'a'.repeat(201),
  ])('rejects %j', v => {
    expect(safeCssValue(v)).toBe('')
    expect(safeCssValue(v, 'inherit')).toBe('inherit')
  })
  it('handles numbers and nullish input', () => {
    expect(safeCssValue(12)).toBe('12')
    expect(safeCssValue(Number.NaN, 'x')).toBe('x')
    expect(safeCssValue(Infinity)).toBe('')
    expect(safeCssValue(null, 'fb')).toBe('fb')
    expect(safeCssValue(undefined)).toBe('')
  })
  it('safeColor falls back to currentColor', () => {
    expect(safeColor('#123456')).toBe('#123456')
    expect(safeColor('var(--c2)')).toBe('var(--c2)')
    expect(safeColor('red;background:url(//evil.test)')).toBe('currentColor')
    expect(safeColor(null)).toBe('currentColor')
    expect(safeColor('}', 'black')).toBe('black')
  })
})

/* sanitizeRichText ─────────────────────────────────────────────────────────── */

const ALLOWED = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u', 's', 'code', 'pre', 'blockquote', 'a', 'br'])
/** Every element is on the allowlist, the only attribute is href on links, and every href is http(s)/mailto/relative. */
function expectInert(html: string) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  for (const el of doc.body.querySelectorAll('*')) {
    expect(ALLOWED, `<${el.tagName.toLowerCase()}> survived`).toContain(el.tagName.toLowerCase())
    const attrs = [...el.attributes].map(a => a.name)
    expect(attrs, `attributes on <${el.tagName.toLowerCase()}>`).toEqual(el.tagName === 'A' ? ['href'] : [])
    if (el.tagName === 'A') expect(safeUrl(el.getAttribute('href'), { allow: ['https:', 'http:', 'mailto:'], fallback: 'BLOCKED' })).not.toBe('BLOCKED')
  }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT)
  expect(walker.nextNode(), 'comment survived').toBeNull()
}

const RICH_PAYLOADS: [name: string, html: string][] = [
  ['img onerror', '<p>Hi<img src=x onerror="alert(1)"></p>'],
  ['svg onload', '<svg onload=alert(1)><circle r=4 /></svg>after'],
  ['svg script', '<svg><script>alert(1)</script></svg>'],
  ['script tag', '<script>alert(1)</script><p>text</p>'],
  ['style tag', '<style>@import "https://evil.test/x.css"; body{display:none}</style>visible'],
  ['inline style overlay', '<div style="position:fixed;inset:0;background:red">phish</div>'],
  ['javascript link', '<a href="javascript:alert(1)">click</a>'],
  ['mixed-case javascript link', '<a href="JaVaScRiPt:alert(1)">click</a>'],
  ['entity-encoded javascript link', '<a href="java&#x09;script:alert(1)">click</a>'],
  ['entity-encoded colon', '<a href="javascript&colon;alert(1)">click</a>'],
  ['data link', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
  ['vbscript link', '<a href="vbscript:msgbox(1)">x</a>'],
  ['link with handlers', '<a href="https://ok.test" onclick="alert(1)" style="color:red" target="_blank">ok</a>'],
  ['iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ['object / embed', '<object data="x.swf"></object><embed src="x.swf">'],
  ['form with password', '<form action="https://evil.test"><input type="password" name="p"><button formaction="javascript:alert(1)">Go</button></form>'],
  ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.test">'],
  ['base href', '<base href="https://evil.test/">'],
  ['template', '<template><img src=x onerror=alert(1)></template>'],
  ['noscript mXSS', '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>'],
  ['math mXSS', '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>'],
  ['comment', '<!-- <img src=x onerror=alert(1)> -->text'],
  ['attributes on allowed tags', '<p class="x" id="y" data-x="1" onmouseover="alert(1)"><b title="t">bold</b></p>'],
  ['tracking image', '<p><img src="https://track.test/pixel.gif" width=1 height=1></p>'],
  ['textarea / select', '<textarea>secret</textarea><select><option>x</option></select>'],
  ['nested unknown tags', '<section><article><span onclick=x>deep <em>text</em></span></article></section>'],
]

describe('sanitizeRichText', () => {
  it.each(RICH_PAYLOADS)('neutralises: %s', (_name, html) => {
    const out = sanitizeRichText(html)
    expectInert(out)
    expect(out).not.toMatch(/on\w+=|javascript:|vbscript:|<script|<style|<iframe|<img|<svg|<input|<form|style=/i)
    expect(sanitizeRichText(out)).toBe(out) // stable: sanitising again changes nothing (no mutation XSS)
  })

  it('keeps allowed formatting and safe links', () => {
    const html = '<h2>Title</h2><p>Some <b>bold</b>, <i>italic</i>, <u>u</u>, <s>s</s> and <code>code</code>.</p><ul><li>one</li></ul><ol><li>two</li></ol><blockquote>q</blockquote><p><a href="https://example.com/x">link</a> <a href="mailto:a@b.c">mail</a> <a href="/rel">rel</a><br></p>'
    expect(sanitizeRichText(html)).toBe(html)
  })

  it('maps aliases onto the allowlist', () => {
    expect(sanitizeRichText('<h1>a</h1><div>b</div><del>c</del><strike>d</strike><ins>e</ins><h5>f</h5>')).toBe('<h2>a</h2><p>b</p><s>c</s><s>d</s><u>e</u><h3>f</h3>')
  })

  it('unwraps unsafe links but keeps their text', () => {
    expect(sanitizeRichText('<p><a href="javascript:alert(1)">click <b>me</b></a></p>')).toBe('<p>click <b>me</b></p>')
  })

  it('drops script, style and frame content entirely', () => {
    expect(sanitizeRichText('a<script>evil()</script>b<style>x{}</style>c<iframe>d</iframe>e')).toBe('abce')
  })

  it('escapes text so it cannot become markup', () => {
    const out = sanitizeRichText('<p>&lt;img src=x onerror=alert(1)&gt;</p>')
    expect(out).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>')
  })

  it('survives absurd nesting without a stack overflow', () => {
    const deep = '<div>'.repeat(5000) + 'core' + '</div>'.repeat(5000)
    const out = sanitizeRichText(deep)
    expect(out).toContain('core')
    expectInert(out)
  }, 20_000) // jsdom parsing 5000 levels is slow on a loaded machine; the assertion is about not overflowing the stack

  it('handles non-string input', () => {
    expect(sanitizeRichText(null as unknown as string)).toBe('')
    expect(sanitizeRichText(undefined as unknown as string)).toBe('')
  })

  it('escapes everything to text when there is no DOMParser (SSR)', () => {
    const real = globalThis.DOMParser
    try {
      // @ts-expect-error simulate the server
      delete globalThis.DOMParser
      expect(sanitizeRichText('<img src=x onerror="alert(1)">&\'')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;')
    } finally { globalThis.DOMParser = real }
  })
})
