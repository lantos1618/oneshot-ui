import { type ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import { DEFAULT_THEME, FONT_CSS, THEME_LEGACY_KEY, THEME_STORAGE_KEY, THEME_TOKEN_NAMES, THEME_VALUE_SOURCE, TOKENS, ThemeProvider, type ThemeSettings, UIHosts, cn, themeStyle, themeTokens, useTheme } from './core'

export type UIProviderProps = {
  children: ReactNode
  className?: string
  /** Settings to start from before the user picks anything (and what Reset returns to), e.g. { theme: 'nord', mode: 'dark' }. */
  defaultTheme?: Partial<ThemeSettings>
  /** localStorage key for the saved appearance (default 'ui-theme:v1'; a value under the old 'ui-theme' key is migrated once). Pass the same key to ThemeScript. */
  storageKey?: string
  /** Remember the user's theme in localStorage (default true). */
  persist?: boolean
  /**
   * Load Geist and the theme fonts from Google Fonts (default false). Off: nothing is fetched from outside your origin
   * and --font falls back to the system stack (ui-sans-serif, system-ui…). On: requests go to fonts.googleapis.com and
   * fonts.gstatic.com (allow them in your CSP: style-src and font-src).
   */
  fonts?: boolean
  /**
   * Where the theme's CSS variables go. 'html' (default): on <html>, with the page background themed too.
   * 'self': on the provider's own `.ui-root` wrapper only, leaving the host page alone (overlays portal into it).
   */
  target?: 'html' | 'self'
  /** CSP nonce for the `<style>` elements UIProvider renders (the same value as your `style-src 'nonce-…'`). */
  nonce?: string
  /**
   * Render the token `<style>` (default true). Set false under a strict CSP without nonces and link the same CSS
   * instead: `import '@lyndon/ui/tokens.css'` (or `<link rel="stylesheet" href=".../dist/tokens.css">`). With `fonts`
   * on, the Google Fonts stylesheet is then added as a `<link>` rather than an inline `@import`.
   */
  injectStyles?: boolean
  /**
   * Apply a theme share link on load (default false): a valid `#theme=…` or `?theme=…` code (themeShareUrl, the
   * appearance panel's Copy share link) replaces the saved appearance and is saved, then the parameter is removed
   * from the address bar. The code is untrusted input and is validated like saved settings; anything else is ignored.
   */
  themeFromUrl?: boolean
}

/** The page background and text colour, on `html` and `body` (so a host page's own body background can't show through): added with target="html" (dist/tokens.css carries the same rule). */
const PROVIDER_PAGE_CSS = 'html,html body{background:var(--bg);color:var(--fg)}'

/** The Google Fonts stylesheet behind FONT_CSS, for a `<link>` when inline styles are off. */
const PROVIDER_FONT_HREF = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap'

/**
 * Wrap your app once. Injects the tokens (and, with `fonts`, the Geist import), applies the theme, hosts page-level UI
 * (the toast region, mounted on the first `useToast()` toast) inside the themed `.ui-root` wrapper, and turns motion off
 * for reduced-motion users. Makes no outside requests unless `fonts`.
 */
export function UIProvider({ children, className, defaultTheme, storageKey, persist, fonts = false, target = 'html', nonce, injectStyles = true, themeFromUrl = false }: UIProviderProps) {
  return (
    <MotionConfig reducedMotion="user" nonce={nonce}>
      {fonts && (injectStyles ? <style nonce={nonce}>{FONT_CSS}</style> : <link rel="stylesheet" href={PROVIDER_FONT_HREF} nonce={nonce} />)}
      {injectStyles && <style nonce={nonce}>{(target === 'html' ? TOKENS + '\n' + PROVIDER_PAGE_CSS : TOKENS)}</style>}
      <ThemeProvider defaultSettings={defaultTheme} storageKey={storageKey} persist={persist} fonts={fonts} target={target} fromUrl={themeFromUrl}>
        <UIProviderRoot className={className}>
          {children}
          <UIHosts />
        </UIProviderRoot>
      </ThemeProvider>
    </MotionConfig>
  )
}

/** The `.ui-root` wrapper. With target="self" it carries the theme (after hydration, so server and client markup match). */
function UIProviderRoot({ className, children }: { className?: string; children: ReactNode }) {
  const { target, ready, tokens, dark } = useTheme()
  const self = target === 'self' && ready
  return <div className={cn('ui-root', className)} data-theme={self ? (dark ? 'dark' : 'light') : undefined} style={self ? themeStyle(tokens, dark) : undefined}>{children}</div>
}

const themeScriptJSON = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

/**
 * The source of ThemeScript's inline script, for frameworks that take a string (e.g. a CSP-hashed <script>).
 * It reads the saved appearance and applies data-theme, color-scheme and the saved CSS variables to <html>. The saved
 * `css` is used only when every name is a library token and every value matches the patterns themeTokens produces
 * (hex, rgba(), numbers/px, the two shadows, the font stack); otherwise the defaults (or nothing) are applied.
 * With the default key it also reads the legacy 'ui-theme' value until ThemeProvider has migrated it.
 */
export function themeScriptSource({ storageKey = THEME_STORAGE_KEY, defaultTheme, persist = true }: { storageKey?: string; defaultTheme?: Partial<ThemeSettings>; persist?: boolean } = {}) {
  const d = { ...DEFAULT_THEME, ...defaultTheme }
  const fallback = { theme: d.theme, mode: d.mode, useCustom: d.useCustom, custom: d.custom ? { dark: !!d.custom.dark } : null, css: { light: themeTokens(d, false), dark: themeTokens(d, true) } }
  const legacy = storageKey === THEME_STORAGE_KEY ? THEME_LEGACY_KEY : null
  return `(function(k,l,d,N,V){try{var e=document.documentElement,s=null,R=new RegExp(V);if(k)try{var r=localStorage.getItem(k);if(r==null&&l)r=localStorage.getItem(l);s=JSON.parse(r)}catch(x){}
if(!s||typeof s!=="object"||Array.isArray(s))s=d;var ok=function(t){if(!t||typeof t!=="object")return null;for(var n in t)if(!Object.prototype.hasOwnProperty.call(t,n)||N.indexOf(n)<0||typeof t[n]!=="string"||!R.test(t[n]))return null;return t},
m=s.mode==="light"||s.mode==="dark"||s.mode==="system"?s.mode:d.mode,u=s.useCustom===true&&s.custom&&typeof s.custom==="object",
dk=u?s.custom.dark===true:m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches),
c=s.css&&typeof s.css==="object"?s.css:((s.theme||d.theme)===d.theme&&!u?d.css:null),t=c&&ok(c[dk?"dark":"light"]);
if(t)for(var n in t)e.style.setProperty("--"+n,t[n]);e.setAttribute("data-theme",dk?"dark":"light");e.style.colorScheme=dk?"dark":"light"}catch(x){}})(${persist ? themeScriptJSON(storageKey) : 'null'},${persist ? themeScriptJSON(legacy) : 'null'},${themeScriptJSON(fallback)},${themeScriptJSON(THEME_TOKEN_NAMES)},${themeScriptJSON(THEME_VALUE_SOURCE)})`
}

/**
 * A blocking inline script for the server-rendered <head>: applies the saved theme (or the defaults and the
 * OS scheme) to <html> before the first paint, so there is no flash of the wrong theme. Give it the same
 * `storageKey`/`defaultTheme`/`persist` as UIProvider, and put `suppressHydrationWarning` on <html>, since the
 * script changes its attributes before React hydrates. Only useful with target="html" and server rendering.
 * Under a strict CSP pass your `nonce` (or hash themeScriptSource()).
 */
export function ThemeScript({ nonce, ...opts }: { storageKey?: string; defaultTheme?: Partial<ThemeSettings>; persist?: boolean; nonce?: string }) {
  return <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScriptSource(opts) }} />
}
