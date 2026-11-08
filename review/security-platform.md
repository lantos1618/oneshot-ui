# Security review: platform, supply chain, DoS, CSP

PoCs in the session scratchpad `sec2/`. No Critical findings; `pnpm audit` (prod and full) reports 0 advisories,
0 runtime dependencies, lockfile v9 with sha512 integrity, no install hooks, clean tarball (62 files, no sourcemaps,
no local paths, no secrets).

| # | Sev | Where | Issue | Fix |
|---|---|---|---|---|
| 1 | Med | code `highlightCode` (CODE_JS/py/sh/json string patterns); aiagent `AI_HL_RE` (quadratic) | ReDoS: 44 backslashes = 8 s in Chrome; unterminated strings quadratic | `"(?:[^"\\]|\\.)*"`; skip highlighting lines > ~2000 chars; fix AI_HL_RE |
| 2 | Med (High with real tools) | aichat `AgentComposer` run1/streamDone/decide | `onSend` acts before the approval card; Deny has no host callback yet says "Nothing was changed"; whether to ask is a regex over the user's text; card shows model prose, not the action; appears under the pointer | `onApprovalRequest(action) => Promise<boolean>` awaited before tools; host-supplied structured summary (tool, args, recipients); ~500 ms click delay; honest wording |
| 3 | Med | ai `PermissionRequest` | `onDecide` fires before sending; edited draft never reaches the host; Undo has no callback but claims nothing was sent; progress simulated | `onDecide(allowed, always, draft)`, `onUndo(): Promise<boolean>`, progress from props |
| 4 | Med (availability) | core `themeLoad`/`themePalette`/`rgb` | Tampered/old stored settings white-screen the app permanently (crash before save; storage event spreads to all tabs) | Strict validation (integer in-range variant, hex palette values, font ∈ FONTS, clamped radius), never throw, `removeItem` on failure, versioned key `ui-theme:v1` |
| 5 | Low | `custom.v.*` and ThemeScript `s.css.*` | Stored values can make the browser fetch any URL (`bg: url(...)`) | Validate as #4; ThemeScript accepts only known token names and safe value patterns |
| 6 | Low | datagrid `gridCompileRg`/visible/hits/gridMark | User regex freezes the tab (13 s and 38 s+); runs 3× per cell; no debounce | Cap ~200 chars, debounce ~150 ms, reject nested quantifiers or literal mode, time budget, compute once per cell |
| 7 | Low | datagrid text query schema (`Object.fromEntries`) | `constructor`/`__proto__` fields validate, are ignored, then crash `gridSerialise` (no real pollution) | `Object.create(null)` / `Map` / `Object.hasOwn` |
| 8 | Low | `Math.max(...arr)`/`Math.min(...arr)` ×28 (charts 16, diagrams 5, media 3, core 2, geo 1, scheduler 1); `lcsDiff` eager O(m·n); NetworkGraph O(n²)/frame; DataGrid no virtualization; unbounded toasts; StreamingText O(n²) | RangeError above ~125k points; memory exhaustion | Reduce loops; `maxPoints`/downsampling; lazy capped diff (Myers); virtualize grid; toast cap ~5 |
| 9 | Low | media `AvatarCropper` | Reads any file whole as data URL; needs `img-src data:` | Size cap; object URL + revoke; dimension check |
| 10 | Med (privacy) | `FONT_CSS` in UIProvider, appearance `loadFont`, AI canvas iframe | 6 requests to Google Fonts by default (GDPR); `fonts` flag is a module global set in an effect (last provider wins) | Make Google Fonts opt-in / self-host; flag via context, not a global |
| 11 | Med (compat) | UIProvider `<style>` (TOKENS, FONT_CSS), media data:/blob: URLs, SSR style attributes | Strict CSP blocks inline styles; no `nonce` on UIProvider | `nonce` prop; `dist/tokens.css` + `injectStyles={false}`; document a minimal CSP (below) |
| 12 | Low/Info | feedback `HoldToConfirm`; overlay focus trap | Works in frames, duration may be 0; trap escapable when no focusables, background not inert | Doc `frame-ancestors 'none'`, minimum duration; document-level Escape/Tab while open, `inert` background |
| 13 | Info | release process | No `prepublishOnly`, `packageManager`, `engines`; dist can be stale | `"prepublishOnly": "pnpm build && pnpm test:ssr"`; packageManager; engines |
| 14 | Low | dist-single files | No version/commit/checksum; no update channel | Stamp version + commit + sha256 in headers; publish SHA256SUMS (signed); "re-copy on each security release" |

## Minimal CSP for consumers
```
default-src 'self'; script-src 'self' 'nonce-{N}'; style-src 'self' 'nonce-{N}'; style-src-attr 'unsafe-inline';
img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self';
object-src 'none'; base-uri 'none'; frame-ancestors 'none'
```
With Google Fonts: add `https://fonts.googleapis.com` to style-src and `https://fonts.gstatic.com` to font-src.
`data:`/`blob:` only needed for media, avatar and signature components.

## SECURITY.md outline
Supported versions (latest 0.x minor; after 1.0 current + previous major) · reporting via GitHub Private
Vulnerability Reporting (no public issues) · acknowledge 3 business days, triage 7, fix High/Critical within 30
(max 90), coordinated disclosure with GHSA/CVE and credit · scope: npm package + dist-single (not the demo) ·
trust boundaries · verifying releases (npm provenance, `npm audit signatures`, dist-single SHA256SUMS).

## CI security checks (when CI exists)
`pnpm install --frozen-lockfile`; `pnpm audit --prod --audit-level=moderate` (blocking); lockfile-lint;
CodeQL security-extended + Semgrep p/react, p/xss and custom rules (innerHTML, srcDoc + allow-scripts,
non-literal RegExp, nested quantifiers via eslint-plugin-regexp, `Math.max(...`, unvalidated JSON.parse of storage);
OpenSSF Scorecard; zizmor; actions pinned to SHAs; least-privilege permissions; trusted publishing with
provenance and 2FA; pack diff check (no .map, local paths, secrets via gitleaks); rebuild-and-diff dist.
