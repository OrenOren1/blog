# AGENTS.md

High-signal guidance for AI agents working in this Astro portfolio repo.

## Runtime and Commands

- Local runtime is Node 20+ (`Taskfile.yaml` pins `20.17.0`); CI uses Node 22.
- Primary commands from `package.json`:
  - `npm run dev` (Astro dev server)
  - `npm run build` (production build)
  - `npm run preview` (preview built output)
- Task runner equivalents:
  - `task setup` (create `.nodeenv` + install deps)
  - `task dev`, `task build`, `task preview`

## Verification Expectations

- There is no repo-defined test/lint/typecheck script in `package.json`; do not invent one.
- Treat `npm run build` as the required verification step for code/content changes.
- CI deploy flow is build-only (`npm ci` -> `npm run build` -> Pages deploy).

## Content System (Astro)

- Source of truth is `src/content.config.ts`.
- Blog content lives under `src/content/blog/**/[!_]*.{md,mdx}`.
  - Files/dirs starting with `_` are excluded by loader pattern.
- Blog URLs are generated from collection entry IDs (`/blog/${post.id}/`) via `src/lib/posts.ts` and `src/pages/blog/[...slug].astro`.
- `minutesRead` is auto-populated by `remark-reading-time.mjs`; do not set it manually.

## Publishing Flags and SEO Behavior

- `draft: true` excludes posts from public listing and page generation (`getPosts` / `getStaticPaths`).
- `unlisted: true` keeps posts reachable but removes them from sitemap.

## Known Repo Gotchas

- Do not edit generated output directories: `dist/` and `.astro/`.

## Blog Work

- For drafting/refining posts, use `.agent/skills/blog/SKILL.md` as the workflow and frontmatter contract.
- Keep post paths aligned with existing conventions in `src/content/blog/` subfolders (`kubernetes/`, `gitops/`, `ai-ml/`, `platform/`).