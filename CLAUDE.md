# Kuaiyou Open Source — agent notes

## Deferred decisions (do not re-open unless explicitly asked)

### Website repo split

- Marketing site lives in **`kuaiyou-app/kuaiyou-website`** (sibling checkout recommended).
- Do **not** re-add a `website/` package to this monorepo unless explicitly asked.

### Next.js 14 → 16 upgrade — **WON'T DO** (website repo)

- Decision lives in `kuaiyou-website/CLAUDE.md`. Do not major-upgrade Next for CVE hygiene.

### Related pinned stack

- MCP server: Node ≥18 (CI matrix 18/20). Do not couple MCP Node floor to a Next major.
- Primary Node for scripts: `.nvmrc` → 20.
