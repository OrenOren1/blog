# Blog image pipeline (IMAGE_PROMPT → Gemini → ImgBB)

This document describes the **finished** in-repo workflow for AI-generated illustrations: markers in Markdown, `scripts/imgbb-resolve-prompts.mjs`, Task helpers, and how humans stay in the loop.

## What shipped

| Piece | Role |
|--------|------|
| `[IMAGE_PROMPT: …]` | Authoring marker in `.md` (see `.agent/skills/blog/SKILL.md`). |
| `<!-- blog:image role="cover" … -->` | Optional hero wrapper; `image:` in front matter updates when it still points at `/images/blog/…` or is empty. |
| `npm run blog:images` / `task blog:images` | Calls Gemini (default) or OpenAI, uploads to ImgBB, replaces markers with `![alt](url)`. |
| `<!-- image_prompt:archive … b64=… -->` | Default-on archive of the exact prompt above each figure (`BLOG_IMAGES_ARCHIVE_PROMPTS=0` to skip). |
| `Taskfile.yaml` | `task dev:links`, `task blog:images:draft`, `task dev GENIMAGES=1` / `bg`, `DEV_ORIGIN` for printed localhost URLs. |
| `src/styles/global.css` | `.post-content img` uses `max-width: 100%` so wide ImgBB assets don’t break the column. |

Secrets stay **out of git**: `.googleAI-token`, `.imgbb-token`, `.gemini-api-key` (see `.gitignore`). Use [AGENTS.md](../AGENTS.md) for env vars and limits.

## Human-in-the-loop — when to intervene

Use a **human gate** whenever automation shouldn’t ship unchecked:

1. **Before the first `blog:images` run** — Review prompts for sensitive client details, trademarked logos you must not generate, or wording that could produce unsafe output.
2. **After generation** — Open the local post (`task dev:links` → copy `/blog/…/` URL). Skim each image for metaphor accuracy, accidental text on images, and layout.
3. **Before merge to `main`** — Treat image URLs like code: wrong hero affects OG cards and social previews.
4. **Production deploy** — CI builds static HTML; there is no separate “image CDN” step beyond ImgBB. If a post must stay private, use `draft: true` or `unlisted: true` per [AGENTS.md](../AGENTS.md).

Optional **full automation** is appropriate only for personal drafts, smoke tests, or when prompts are short and low-risk.

## Changing a single picture

You do **not** have to regenerate the whole post.

### Option A — Restore one marker (recommended)

1. Find the figure’s archive line: `<!-- image_prompt:archive index=N … b64=… -->`.
2. Decode the prompt (Node):  
   `node -e "console.log(Buffer.from('PASTE_B64', 'base64url').toString('utf8'))"`
3. Remove that archive line **and** the following `![…](https://i.ibb.co/…)` line.
4. Paste either a bare marker or the full cover wrapper, e.g.  
   `[IMAGE_PROMPT: …your revised brief…]`
5. Run on the file:  
   `task blog:images -- path/to/post.md`  
   (Only slots that are still `[IMAGE_PROMPT:]` are processed; unchanged images stay as-is **only if** you didn’t delete them — the script replaces **markers**, not existing images. So you only remove the one pair you want to redo.)

**Note:** The script processes **all** `[IMAGE_PROMPT:]` markers in the file in one run. If other markers still exist, they will be regenerated too. To refresh **one** image while leaving others untouched, temporarily move other prompts out (or split work into two commits) — or accept one full pass if all markers are present.

### Option B — Manual asset swap

Keep the markdown `![alt](url)` and overwrite the meaning by uploading a new file to ImgBB and editing the URL in the post (no script). Good for quick fixes when you already have an image file.

## Prepare the repo to push

```bash
git status
git diff
```

Checklist:

- [ ] No token files tracked: `.imgbb-token`, `.googleAI-token`, `.gemini-api-key` must stay **ignored** and uncommitted.
- [ ] No huge logs: `scripts/blog-images-resolve.log`, `scripts/blog-images-then-dev.log` are gitignored.
- [ ] `npm run build` passes (required verification for this repo).
- [ ] Optional: `task dev:links` to sanity-check the default post URL.

Then:

```bash
git add -A
git commit -m "feat(blog): IMAGE_PROMPT pipeline, Task preview URLs, responsive images"
git pull --rebase origin main   # if others pushed meanwhile
git push origin main
```

## Updating the live site

This repo’s **site** URL is configured in `astro.config.mjs` (`site`). Deployment is **build output** (`dist/`) to your host (e.g. GitHub Pages or another static host) via your existing CI — see AGENTS: *“CI deploy flow is build-only”*.

After `git push` to the branch CI watches:

1. Pipeline runs `npm ci` and `npm run build`.
2. Published HTML includes the new Markdown and ImgBB `https://i.ibb.co/…` links (no extra deploy step for images).
3. Purge CDN cache if your host caches HTML aggressively.

If the live post still shows old images, hard-refresh the browser or check CDN; ImgBB URLs change when you regenerate.

## Feature status

**Done for this repo:** marker parsing, Gemini/OpenAI generation, ImgBB upload, parallel runs, prompt archives, Task UX, responsive CSS, and agent docs (`AGENTS.md`, `.agent/skills/blog/SKILL.md`). Further improvements (e.g. “regenerate slot 3 only” without touching others) would be a follow-up enhancement.
