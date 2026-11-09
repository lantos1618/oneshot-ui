# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| Latest 0.x minor (currently 0.1) | Yes: security fixes are released as a new patch or minor |
| Older 0.x | No: upgrade to the latest 0.x |

After 1.0, the current major and the previous major get security fixes.

The copied single files (`dist-single/*.tsx`) are covered in the same way, but they don't update themselves:
re-copy them from the fixed release.

## Reporting a vulnerability

Please report privately through **GitHub Private Vulnerability Reporting** on
[lantos1618/oneshot-ui](https://github.com/lantos1618/oneshot-ui/security/advisories/new) (Security tab → "Report a
vulnerability"). Don't open a public issue, pull request or discussion for a suspected vulnerability.

Include what you can: the affected component and version, a minimal reproduction or proof of concept, the impact you
expect, and whether it needs a particular prop, browser or server setup.

## What happens next

| Step | Target |
| --- | --- |
| Acknowledgement | within 3 business days |
| Triage (confirmed or not, with a severity) | within 7 days |
| Fix released for High and Critical | within 30 days (90 days at most, for hard cases) |
| Fix for Medium and Low | in the next regular release |

We coordinate disclosure with you: the fix ships first, then a GitHub Security Advisory (with a CVE where it applies)
that credits you unless you'd rather not be named.

## Scope

In scope:

- The npm package `@lyndon/ui`: everything under `dist/` and the published `dist-single/` files.
- The build scripts that produce them (`scripts/`), and the package metadata.

Out of scope:

- The demo site / showcase (`src/showcase`, `index.html`), except where it shows a flaw in the library itself.
- Vulnerabilities that need an attacker who can already run script on your origin, or change your source code.
- Issues in your own handling of the values the components give you (see the trust boundaries below), and in
  dependencies you install alongside (React, Motion, Tailwind): report those upstream.

## Trust boundaries

The components run in the user's browser with your page's privileges. They treat these as untrusted and handle them
defensively:

- **Props from data, stored content and model output**: hrefs and image sources pass through `safeUrl` /
  `safeMediaUrl`, colours and CSS values through `safeColor` / `safeCssValue`, CSS `url()` through `cssUrl`.
  Rich text is sanitized on input and output; model HTML is previewed in a sandboxed frame without scripts.
- **Same-origin storage**: the saved theme in `localStorage` is validated field by field on every read
  (including changes from other tabs); invalid values fall back to the defaults and junk is removed.
- **User input that drives computation**: the data grid's regex search, chart series, toasts and JSON viewer have
  size and time limits so one input can't freeze or crash the tab.

They do **not** replace server-side checks. Your server must still validate and sanitize rich-text HTML, uploaded
files (type, size, content), mention ids, and every action an AI approval prompt gates; the approval components only
gate actions you wire through their callbacks. `FileUpload`'s `accept` is a convenience filter, not validation.

The library makes no network requests of its own unless `UIProvider fonts` is on (Google Fonts). See the README's
"Content Security Policy" and "Security and trust boundaries" sections for the CSP and framing advice
(`frame-ancestors`) that go with it.

## Verifying releases

- **npm**: `npm audit signatures` checks the registry signatures of what you installed. Releases published through
  CI with npm provenance (see the README's "CI" section) also show the source commit
  on the npm page: compare it with the tag.
- **Single files**: each `dist-single/*.tsx` starts with a stamp naming the version, the commit it was built from
  and the sha256 of the rest of the file. `dist-single/SHA256SUMS` lists the sha256 of each whole file:

  ```sh
  cd node_modules/@lyndon/ui/dist-single && sha256sum -c SHA256SUMS
  ```

  For a copy you pasted into your project, compare its stamp with the release you meant to copy, and re-copy it after
  every security release.
- **Rebuild**: `pnpm install --frozen-lockfile && pnpm build` from the tagged commit reproduces `dist/` and
  `dist-single/`.
