/** Security helpers for model or user supplied values: safeUrl, safeMediaUrl, cssUrl, safeCssValue, safeColor. Pure; part of @lyndon/ui/core. */

/* Use these wherever a URL, colour or CSS value comes from props, data, storage or model output. */

const SAFE_URL_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:']

/** The schemes a link written in user text (markdown, the rich text editor) may use; relative URLs are always allowed. */
export const TEXT_LINK_SCHEMES: readonly string[] = ['https:', 'http:', 'mailto:', 'tel:']

/**
 * Returns `url` when it's relative (`/x`, `x`, `?q`, `#id`) or uses an allowed scheme (default http, https, mailto, tel);
 * otherwise `fallback` ('#'). Blocks `javascript:`, `data:`, `vbscript:`, `file:` and OS protocol handlers.
 */
export function safeUrl(url: string | null | undefined, { allow = SAFE_URL_SCHEMES, fallback = '#' }: { allow?: readonly string[]; fallback?: string } = {}): string {
  if (url == null) return fallback
  const u = String(url).trim()
  if (!u) return fallback
  const probe = u.replace(/[\u0000- \u007f-\u009f]/g, '') // browsers ignore these inside a scheme
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(probe)
  if (!m) return u
  return allow.includes(m[1].toLowerCase() + ':') ? u : fallback
}

/** Like `safeUrl` for media `src`: also allows `blob:` and `data:` of the given kind (image, audio or video); otherwise ''. */
export function safeMediaUrl(url: string | null | undefined, kind: 'image' | 'audio' | 'video' = 'image'): string {
  const u = safeUrl(url, { allow: ['http:', 'https:', 'blob:', 'data:'], fallback: '' })
  if (/^data:/i.test(u) && !new RegExp(`^data:${kind}/`, 'i').test(u)) return ''
  return u
}

/** A CSS `url("…")` with the value checked by `safeMediaUrl` and quotes/backslashes escaped; 'none' when unsafe. */
export const cssUrl = (url: string | null | undefined) => {
  const u = safeMediaUrl(url)
  return u ? `url("${u.replace(/["\\\n\r]/g, c => `\\${c.charCodeAt(0).toString(16)} `)}")` : 'none'
}

/**
 * Returns `value` if it's a plain CSS value (colours, numbers, lengths, `var(--x)`, `color-mix(…)`, `calc(…)`) with
 * no way to break out of a declaration or load a resource; otherwise `fallback`. Rejects `;`, braces, quotes, `url(`,
 * `expression(`, `image-set(` and `@`.
 */
export function safeCssValue(value: string | number | null | undefined, fallback = ''): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback
  if (typeof value !== 'string') return fallback
  const s = value.trim()
  if (!s || s.length > 200 || !/^[\w#%.,()\s/+*-]+$/.test(s) || /url\s*\(|expression\s*\(|image-set\s*\(/i.test(s)) return fallback
  return s
}

/** `safeCssValue` for colours, falling back to `currentColor`. */
export const safeColor = (color: string | null | undefined, fallback = 'currentColor') => safeCssValue(color, fallback) || fallback
