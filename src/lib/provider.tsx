import { type ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import { DEFAULT_THEME, FONT_CSS, PAGE_CSS, TOKENS, ThemeProvider, type ThemeSettings, cn, themeStyle, themeTokens, useTheme } from './core'
import { ToastProvider } from './feedback'

export type UIProviderProps = {
  children: ReactNode
  className?: string
  /** Settings to start from before the user picks anything (and what Reset returns to), e.g. { theme: 'nord', mode: 'dark' }. */
  defaultTheme?: Partial<ThemeSettings>
  /** localStorage key for the saved appearance (default 'ui-theme'). Pass the same key to ThemeScript. */
  storageKey?: string
  /** Remember the user's theme in localStorage (default true). */
  persist?: boolean
  /** Load Geist and the theme fonts from Google Fonts (default true). false: nothing is fetched; --font falls back to system-ui. */
  fonts?: boolean
  /**
   * Where the theme's CSS variables go. 'html' (default): on <html>, with the page background themed too.
   * 'self': on the provider's own `.ui-root` wrapper only, leaving the host page alone (overlays portal into it).
   */
  target?: 'html' | 'self'
}

/**
 * Wrap your app once. Injects the tokens (and the Geist import unless `fonts={false}`), applies the theme,
 * hosts toasts inside the themed `.ui-root` wrapper, and turns motion off for reduced-motion users.
 */
export function UIProvider({ children, className, defaultTheme, storageKey, persist, fonts = true, target = 'html' }: UIProviderProps) {
  return (
    <MotionConfig reducedMotion="user">
      {fonts && <style>{FONT_CSS}</style>}
      <style>{target === 'html' ? TOKENS + '\n' + PAGE_CSS : TOKENS}</style>
      <ThemeProvider defaultSettings={defaultTheme} storageKey={storageKey} persist={persist} fonts={fonts} target={target}>
        <UIProviderRoot className={className}>
          <ToastProvider>{children}</ToastProvider>
        </UIProviderRoot>
      </ThemeProvider>
    </MotionConfig>
  )
}

/** The `.ui-root` wrapper; with target="self" it carries the theme (after hydration, so server and client markup match). */
function UIProviderRoot({ className, children }: { className?: string; children: ReactNode }) {
  const { target, ready, tokens, dark } = useTheme()
  const self = target === 'self' && ready
  return <div className={cn('ui-root', className)} data-theme={self ? (dark ? 'dark' : 'light') : undefined} style={self ? themeStyle(tokens, dark) : undefined}>{children}</div>
}

const themeScriptJSON = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')

/**
 * The source of ThemeScript's inline script, for frameworks that take a string (e.g. a CSP-hashed <script>).
 * It reads the saved appearance and applies data-theme, color-scheme and every CSS variable to <html>.
 */
export function themeScriptSource({ storageKey = 'ui-theme', defaultTheme, persist = true }: { storageKey?: string; defaultTheme?: Partial<ThemeSettings>; persist?: boolean } = {}) {
  const d = { ...DEFAULT_THEME, ...defaultTheme }
  const fallback = { theme: d.theme, mode: d.mode, useCustom: d.useCustom, custom: d.custom, css: { light: themeTokens(d, false), dark: themeTokens(d, true) } }
  return `(function(k,d){try{var e=document.documentElement,s=null;if(k)try{s=JSON.parse(localStorage.getItem(k))}catch(x){}
if(!s||typeof s!=="object")s=d;var c=s.css||((s.theme||"default")===d.theme&&!s.useCustom?d.css:null),m=s.mode||d.mode,
dk=s.useCustom&&s.custom?!!s.custom.dark:m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches),t=c&&c[dk?"dark":"light"];
if(t)for(var n in t)e.style.setProperty("--"+n,t[n]);e.setAttribute("data-theme",dk?"dark":"light");e.style.colorScheme=dk?"dark":"light"}catch(x){}})(${persist ? themeScriptJSON(storageKey) : 'null'},${themeScriptJSON(fallback)})`
}

/**
 * A blocking inline script for the server-rendered <head>: applies the saved theme (or the defaults and the
 * OS scheme) to <html> before the first paint, so there is no flash of the wrong theme. Give it the same
 * `storageKey`/`defaultTheme`/`persist` as UIProvider, and put `suppressHydrationWarning` on <html>, since the
 * script changes its attributes before React hydrates. Only useful with target="html" and server rendering.
 */
export function ThemeScript({ nonce, ...opts }: { storageKey?: string; defaultTheme?: Partial<ThemeSettings>; persist?: boolean; nonce?: string }) {
  return <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScriptSource(opts) }} />
}
