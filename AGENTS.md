# AGENTS.md

High-signal guidance for AI agents working in this Astro portfolio repo.

## Runtime and Commands

- Local runtime is Node 20+ (`Taskfile.yaml` pins `20.17.0`); CI uses Node 22.
- Primary commands from `package.json`:
  - `npm run dev` (Astro dev server)
  - `npm run build` (production build)
  - `npm run preview` (preview built output)
  - `npm run site:brand-stamp` (optional: Gemini Nano Banana → PNG via `--brand-stamp-out`; the **site header** stamp is an inline SVG in `Header.astro`, vintage sepia seal style)
- Task runner equivalents:
  - `task setup` (create `.nodeenv` + install deps)
  - `task dev`, `task build`, `task preview`
  - `task dev` — prints **local URLs** (site + `/blog/…/` for `IMAGES_POST`), then `astro dev` on **127.0.0.1:4321** (see `DEV_ORIGIN` in `Taskfile.yaml`). Run `task dev:links` anytime to print links without starting the server.
  - `task dev GENIMAGES=1` — runs `npm run blog:images` on the default draft (see `DEFAULT_IMAGES_POST` in `Taskfile.yaml`), then starts the dev server in the **same** terminal (blocks until images finish). Override path: `task dev GENIMAGES=1 IMAGES_POST=src/content/blog/drafts/other.md`
  - `task dev GENIMAGES=bg` — runs **images then dev** in a **background** subshell (task exits right away); combined log: `scripts/blog-images-then-dev.log`, PID in `scripts/blog-images-then-dev.pid`. Follow with `tail -f scripts/blog-images-then-dev.log` until you see the Astro “ready” line.
  - `task dev-genimages` — shorthand for `task dev GENIMAGES=1`
  - `task dev-genimages-bg` — shorthand for `task dev GENIMAGES=bg`

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
- **IMAGE_PROMPT pipeline** (human-in-the-loop, single-image refresh, push & live site): [docs/blog-image-pipeline.md](docs/blog-image-pipeline.md).

### IMAGE_PROMPT → ImgBB (`task blog:images`)

Drafts can use `[IMAGE_PROMPT: ...]` (see skill). The script generates an image, uploads to [ImgBB](https://api.imgbb.com/), and replaces each marker with an HTML comment that **archives the original prompt** (base64url, one line) plus the `![alt](https://i.ibb.co/…)` line so slots stay obvious. Disable comments with `BLOG_IMAGES_ARCHIVE_PROMPTS=0`.

**Gemini (Nano Banana / Nano Banana Pro)** — default when a Gemini key is present (`auto`):

- Create an API key in [Google AI Studio](https://aistudio.google.com/apikey) (billing / Gemini Pro eligibility is on your Google account).
- `export GEMINI_API_KEY=...` and/or `export GEMINI_API_KEYS=key2,key3` (comma-separated fallbacks).
- **Or** put keys in repo-root `.googleAI-token` (gitignored): **one API key per line** (lines starting with `#` are skipped). Optional second file `.gemini-api-key` with more lines. If a request returns **429 / 401 / 403**, the script tries the next key in order.
- Default **model order** (unless `GEMINI_IMAGE_MODEL_CHAIN` is set): **`gemini-3-pro-image-preview` → `gemini-3.1-flash-image-preview` → `gemini-2.5-flash-image`** — Pro first for complex prompts and diagrams; Flash models are fallbacks. Set `GEMINI_IMAGE_MODEL` to try one model first, then the rest of the default chain. See [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation).
- Optional: **`GEMINI_IMAGE_ASPECT_RATIO`** (default `16:9`) and **`GEMINI_IMAGE_SIZE`** (`512` \| `1K` \| `2K` \| `4K`, default `2K`; applies to Gemini **3.x** image models only, not `gemini-2.5-flash-image`).
- Optional: **`GEMINI_IMAGE_EXTRA_INSTRUCTION`** — extra paragraph appended to the image system prompt (e.g. stricter “no substitutions” or brand rules).

**OpenAI (DALL-E 3)** — used when `IMAGE_GEN_PROVIDER=openai` or when only `OPENAI_API_KEY` is set in `auto` mode:

```bash
export OPENAI_API_KEY=sk-...
```

**ImgBB:** `export IMGBB_API_KEY=...` or repo-root `.imgbb-token` (gitignored).

```bash
# Preferred (uses repo Node from Task install deps):
task blog:images -- src/content/blog/drafts/your-post.md
task blog:images:draft
# `blog:images:draft` runs on IMAGES_POST from Taskfile.yaml (defaults to DEFAULT_IMAGES_POST); override per run: IMAGES_POST=…

IMAGE_GEN_PROVIDER=openai task blog:images -- src/content/blog/drafts/your-post.md
# optional: first generated image also becomes front matter `image:` (when still a placeholder)
task blog:images -- src/content/blog/drafts/your-post.md --use-first-as-cover
```

Equivalent without Task: `npm run blog:images -- <path> [flags]`.

**Optional PNG stamp:** `npm run site:brand-stamp` runs `node scripts/imgbb-resolve-prompts.mjs --brand-stamp-out public/images/by-oren-sultan-stamp.png` with `GEMINI_IMAGE_SIZE=512` (see `package.json`). Requires **Gemini** only. Override art with **`BRAND_STAMP_PROMPT`**. The live header uses **coded SVG** (`Header.astro`) + `#stamp-distort-heavy` in `BaseLayout.astro` for the vintage seal look.

If Gemini returns **429** with `free_tier` and `limit: 0` for image metrics, that API key’s project has no image-generation quota yet — turn on billing for the Gemini API in [Google AI Studio](https://aistudio.google.com/) (or Cloud billing for the same project), or run with `IMAGE_GEN_PROVIDER=openai` and `OPENAI_API_KEY`. See [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

If a run **hangs**, each Gemini call uses **`GEMINI_REQUEST_TIMEOUT_MS`** (default 180s) and retries **503 / 504 / 429** on the same key (`GEMINI_TRANSIENT_RETRIES`, default 5, with backoff).

**Nano Banana (Gemini image) model chain:** unless you set `GEMINI_IMAGE_MODEL_CHAIN`, order is **`gemini-3-pro-image-preview` → `gemini-3.1-flash-image-preview` → `gemini-2.5-flash-image`**. For a **flash-first** run (lower latency / less Pro quota use), set e.g. `GEMINI_IMAGE_MODEL_CHAIN=gemini-3.1-flash-image-preview,gemini-2.5-flash-image,gemini-3-pro-image-preview`. Override the full order with `GEMINI_IMAGE_MODEL_CHAIN=model1,model2,…`.

**Detached run:** `task blog:images -- --background path/to/post.md` — exits immediately while work continues; log to **`scripts/blog-images-resolve.log`** (`tail -f` that file).

**Parallel images:** `GEMINI_PARALLEL=6` (or `BLOG_IMAGES_PARALLEL`) runs up to that many generate+ImgBB jobs at once (default **4**, max **12**). Use `GEMINI_PARALLEL=1` for a strict queue. Optional `GEMINI_PARALLEL_STAGGER_MS=300` spaces starts slightly to reduce burst **429**s.

`--dry-run` lists prompts without calling APIs or modifying the file. Cover / social preview: wrap the hero prompt with `<!-- blog:image role="cover" id="slug" -->` … `<!-- /blog:image -->` (see `.agent/skills/blog/SKILL.md`).