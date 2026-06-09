# Credentials & Access Platform — Slidev deck

**This folder is the single source of truth for the deck.** Edit here.

## Files

| File                   | Owns                                                         |
| ---------------------- | ------------------------------------------------------------ |
| `slides.md`            | Deck source — frontmatter + slides 1..N (Slidev markdown)    |
| `about-slide.md`       | Slide 2 (About Me / Tikal card) — spliced in by `build.mjs`  |
| `slide-prompts.md`     | Image-generation prompts (kid-art accents). Source of truth for the Gemini → ImgBB pipeline. |
| `AD.md`                | Architecture Description — the upstream that the deck distils |
| `pres.md`              | Original pres.md (R&W presentation spec — historical)        |
| `components/`          | Vue components used in slides (`FloatingIcon`, `GlassCard`, `Card3D`, `CardGrid`) |
| `style.css`            | Deck-wide CSS (Tikal palette, about-card, deck-menu polish)  |
| `public/`              | Static assets (photo, octopus, wordmark)                     |
| `global-top.vue`       | Custom top-right slide-navigator dropdown                    |
| `build.mjs`            | Build script — splices About slide, runs `slidev build`, materializes SPA fallbacks |
| `slides.generated.md`  | Generated — DO NOT EDIT. Output of `build.mjs`               |

## Workflows

### Dev (live reload)
From the blog root:
```sh
npm run presentations:dev
```

### Build (for CI / production)
From the blog root:
```sh
npm run build         # builds all decks → astro build → dist/
```

The deck lands at `public/presentations/credentials-access-platform/` (dev) and `dist/presentations/credentials-access-platform/` (CI).

### Add a new deck
1. `mkdir presentations/<new-slug>/` with its own `package.json`, `build.mjs`, `slides.md`.
2. Add an entry to `src/data/presentations.json`.
3. Done — root scripts (`scripts/presentations.mjs`) discover it automatically.

### Regenerate kid-art images
Edit the relevant block in `slide-prompts.md` (change the archived `<!-- image_prompt:archive ... -->` block back to `[IMAGE_PROMPT: ...]`), then from the blog root:
```sh
GEMINI_IMAGE_ASPECT_RATIO=1:1 node scripts/imgbb-resolve-prompts.mjs presentations/credentials-access-platform/slide-prompts.md
```
The script only processes pending markers — existing archives are safe.

## URL routes (production)

| Route                                                          | What                                                |
| -------------------------------------------------------------- | --------------------------------------------------- |
| `/presentations/`                                              | Blog index of all decks                             |
| `/presentations/credentials-access-platform/`                  | Open the deck                                       |
| `/presentations/credentials-access-platform/<n>/`              | Jump to slide N                                     |
| `/presentations/credentials-access-platform/presenter/`        | Presenter mode (notes + next-slide + timer)        |
| `/presentations/credentials-access-platform/overview/`         | Slide grid                                          |
| `/presentations/credentials-access-platform/notes/`            | Speaker notes only                                  |
