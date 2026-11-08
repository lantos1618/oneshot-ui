# Security review: injection and content handling

PoCs (Chromium/Playwright and Node) in the session scratchpad `sec1/`. Threat model: attacker controls a prop value,
stored content, LLM output, dropped/pasted content, a file, or same-origin localStorage.

| # | Sev | Where | Issue | Fix |
|---|---|---|---|---|
| 1 | **High** | editor `RichTextEditor` (`body.current.innerHTML = defaultValue`) | Stored HTML executes on mount (`<img onerror>` ran); `onChange` re-emits the payload | Sanitize `defaultValue`, drops and `onChange` output with one allowlist (p, h2, h3, ul, ol, li, b, i, u, s, code, blockquote, a, br; `href` https/mailto only; no other attributes); `sanitize?: (html) => string` prop for DOMPurify |
| 2 | Med | editor `RichTextEditor`, `MentionsInput`: no drop handling | Dropped HTML keeps iframes, forms with password inputs, tracking images, inline style (full-page overlay), `data:`/`vbscript:` hrefs; dropped spans forge mention/command segments | Handle `onDrop` / `beforeinput` (insertFromDrop) like paste: plain text or sanitized HTML; mentions get `data-id`, segments rebuilt only from tokens the component created; add `id` to `MentionSegment` |
| 3 | Med | code `highlightCode` string patterns `"(?:\\.|[^"])*"` (and `'`, backtick; js/py/sh/json) | Catastrophic backtracking: 48 backslashes = 55 s in Node; a CodeBlock froze the page 6.3 s | `"(?:\\.|[^"\\])*"` everywhere; per-line length cap |
| 4 | Med | aiagent `AiPreview` (srcdoc, `sandbox="allow-same-origin"`) | Scripts blocked, but model HTML loads remote resources (img, CSS `@import`, `url()`): zero-click exfiltration; links navigate the frame (phishing in-app) | CSP meta first in `<head>`: `default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: blob:`; `<base target="_blank">` without allow-popups; optional `allowRemote` |
| 5 | Med/Low | core `themeLoad`/`themePalette`/`themeTokens`, ThemeProvider storage listener, provider `themeScriptSource` (applies stored `css`) | Shallow validation: bad `variant` crashes the whole tree on every load; `custom.v`/`css` values written raw into CSS variables (`bg: url(https://x)` loads remote images); `font` string breaks out of the preview `<style>` | Validate all stored fields (hex per BASE key, integer in-range variant, clamped radius, font ∈ FONTS); clamp in themePalette; inline script ignores stored css unless every value matches a safe pattern (or recomputes); escape/validate in `themeCSS` |
| 6 | Low | inline styles from data: aichat `ChatSources` color, ai `AiSourceCardView`, collab ~198, charts ~613/661, media `Lightbox` `url(${src})` | With SSR, React writes style strings without stripping `;` → a model "colour" adds declarations (full-page overlay PoC), persists after hydration | `safeColor()` (CSS colour / `var(--token)` regex, or `CSS.supports` client-side); quote/escape `url("…")` |
| 7 | Low | href props without scheme allowlist: `ChatSources.href`, `MegaMenu`/`Breadcrumbs`/`NavList` | React 19 neutralises `javascript:`, but `data:`, `vbscript:`, `ms-msdt:`, `search-ms:`, `file:` pass | Shared `safeUrl()` (https, http, mailto, relative, `#`) on every data-driven href/src |
| 8 | Low | code `lcsDiff` | O(m·n) memory: a 10k×10k diff exhausts the tab | Cap input (fallback "changed" view) or Myers/Hirschberg |
| 9 | Info | forms `FileUpload` | Dropped files bypass `accept` | Filter drops by `accept`; document server-side validation |
| 10 | Info | datagrid `gridCompileRg` | User regex can freeze own tab | Length/time cap (matters if an app pre-fills from a URL) |
| 11 | Info | data `JsonViewer` | Cyclic data → unbounded recursion | `seen` WeakSet |
| 12 | Info | aiagent `AiPreview` | allow-same-origin without allow-scripts is safe today | Comment: never add allow-scripts; match font host exactly |

## Verified safe
- Only innerHTML uses: ThemeScript (safe), editor (#1), mentions clear.
- AiPreview sandbox blocks script, event handlers, nested frames, object/embed, javascript: forms/links, top navigation, popups, meta refresh.
- ThemeScript: `storageKey`/`defaultTheme` with `</script>`, `<!--`, U+2028 can't break out; nonce attribute-escaped; font URLs from a fixed allowlist.
- Appearance panel inputs are constrained (type=color, numeric slider, FONTS buttons).
- ⌘K link insertion forces https/mailto; paste is text/plain only.
- Highlighters and JSON viewer build React nodes; chat answers render as text; Citation shows hostname only.
- Media/avatar files read as data URLs into `<img>` (no SVG script); object URLs revoked.
- No `target="_blank"`, no `postMessage`/`message` listeners; selectors use `CSS.escape`; build scripts local-only.

## Secure defaults to adopt
1. `safeUrl()` in utils for every data-driven href/src.
2. Sanitize-by-default in RichTextEditor (+ `sanitize` prop).
3. `safeColor()`/`safeCssValue()` on every style interpolation and theme value; validate everything from storage.
4. CSP meta in every generated srcdoc; never allow-scripts with allow-same-origin.
5. Regexes without overlapping alternatives; size caps for highlighter and diff.
6. README "Security and trust boundaries" section.
