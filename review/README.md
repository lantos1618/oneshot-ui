# Review findings

All findings below were fixed in 0.2.0 (each security PoC was re-run and no longer exploits).

- `bugs.md` — correctness, leaks, events, accessibility, performance (36 findings)
- `reuse.md` — duplication and the shared pieces that replaced it
- `package.md` — SSR safety, public API, types, packaging, docs
- `migration.md` — module fixes left by the packaging round
- `security-content.md` — injection and content handling (1 High, 4 Medium, PoC-backed)
- `security-platform.md` — supply chain, ReDoS, approvals, storage, CSP, resource limits

Known accepted residuals: the DataGrid regex heuristic can't catch every slow pattern (bounded by a 500-char
cell cap and a 120 ms budget); RichTextEditor moves of in-editor text are left to the browser; demo-only showcase
tools (CodeDrawer, DesignQA) are out of scope.
