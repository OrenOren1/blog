#!/usr/bin/env node
// Build the Credentials & Access Platform deck.
// - Reads about-slide.md and splices it as slide 2 of slides.md.
// - Emits slides.generated.md.
// - With no flags: runs `slidev build` writing to ../../public/presentations/credentials-access-platform/.
// - With --dev:    runs `slidev` dev server.
// - With --export: runs `slidev export` to PDF.

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BLOG_ROOT = resolve(HERE, "..", "..");
const ABOUT_SLIDE_PATH = resolve(HERE, "about-slide.md");
const SLIDES_SRC = resolve(HERE, "slides.md");
const SLIDES_OUT = resolve(HERE, "slides.generated.md");
const PUBLIC_OUT = resolve(BLOG_ROOT, "public/presentations/credentials-access-platform");
const BASE_PATH = "/presentations/credentials-access-platform/";

function htmlToMarkdown(html) {
  const md = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<BaseLayout[^>]*>/g, "")
    .replace(/<\/BaseLayout>/g, "")
    .replace(/<div[^>]*>/g, "")
    .replace(/<\/div>/g, "")
    // Drop the top-level <h1>About</h1> — the slide already has a title.
    .replace(/<h1[^>]*>\s*About\s*<\/h1>/gi, "")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/g, (_, t) => `\n## ${t.trim()}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/g, (_, t) => `\n### ${t.trim()}\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/g, (_, t) => `\n#### ${t.trim()}\n`)
    .replace(/<ul[^>]*>/g, "\n")
    .replace(/<\/ul>/g, "\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/g, (_, t) => `- ${t.replace(/\s+/g, " ").trim()}\n`)
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/g, (_, t) => `**${t.trim()}**`)
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/g, (_, t) => `*${t.trim()}*`)
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<a[^>]*href={[^}]+}[^>]*>([\s\S]*?)<\/a>/g, (_, t) => t.trim())
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, h, t) => `[${t.trim()}](${h})`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/g, (_, t) => `\n${t.replace(/\s+/g, " ").trim()}\n`)
    .replace(/\{[^}]*\}/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  // Strip every line's leading whitespace so markdown doesn't treat 4+ spaces
  // as an indented code block.
  return md
    .split("\n")
    .map((l) => l.replace(/^\s+/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function loadAboutSlide() {
  // about-slide.md owns the slide markup (frontmatter + body + speaker notes).
  // Edit that file to change slide 2; this script only splices it into place.
  return readFileSync(ABOUT_SLIDE_PATH, "utf8").trim();
}

function spliceAboutAsSlide2(slidesSrc, aboutSlideBody) {
  // Slides are separated by lines that are exactly `---`.
  // The file starts with a YAML frontmatter that is also between `---` lines,
  // but everything before the first slide body is "slide 1" frontmatter + content.
  // Strategy: split on `\n---\n`, treat parts in pairs (frontmatter,content)...
  // Simpler: locate end of slide 1 (the second occurrence of a line `---` after start of file
  // is the closing of slide-1's frontmatter; the third is the slide-1/slide-2 separator).
  const lines = slidesSrc.split("\n");
  let sepCount = 0;
  let insertAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      sepCount++;
      // 1st: open of slide-1 frontmatter
      // 2nd: close of slide-1 frontmatter
      // 3rd: separator before slide-2 → we want to insert the About slide here as the new slide-2
      if (sepCount === 3) {
        insertAt = i;
        break;
      }
    }
  }
  if (insertAt === -1) {
    throw new Error("Could not locate slide-1/slide-2 boundary in slides.md");
  }
  const before = lines.slice(0, insertAt + 1).join("\n");
  const after = lines.slice(insertAt + 1).join("\n");
  return `${before}\n${aboutSlideBody}\n---\n${after}`;
}

function run(cmd, args, opts = {}) {
  console.log(`▶ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: HERE, ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`);
  }
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

// ----- main -----
const mode = process.argv.includes("--dev")
  ? "dev"
  : process.argv.includes("--export")
  ? "export"
  : "build";

console.log(`• reading About slide from ${ABOUT_SLIDE_PATH}`);
const aboutSlide = loadAboutSlide();

console.log(`• reading deck source ${SLIDES_SRC}`);
let slidesSrc = readFileSync(SLIDES_SRC, "utf8");

// Strip unresolved image placeholders (PENDING_*). These get filled in by the
// blog's image pipeline (npm run blog:images); without them Vite/Rollup fails
// to resolve the import. Safe to omit visually until images are generated.
slidesSrc = slidesSrc.replace(
  /<img[^>]*src=["']PENDING_[^"']*["'][^>]*\/?>/g,
  "",
);

const generated = spliceAboutAsSlide2(slidesSrc, aboutSlide);

writeFileSync(SLIDES_OUT, generated, "utf8");
console.log(`• wrote ${SLIDES_OUT}`);

const slidevBin = resolve(HERE, "node_modules/.bin/slidev");
if (!existsSync(slidevBin)) {
  throw new Error("Slidev not installed. Run `npm install` in this folder first.");
}

if (mode === "dev") {
  run(slidevBin, ["slides.generated.md", "--open"]);
} else if (mode === "export") {
  run(slidevBin, ["export", "slides.generated.md"]);
} else {
  ensureDir(PUBLIC_OUT);
  run(slidevBin, [
    "build",
    "slides.generated.md",
    "--base",
    BASE_PATH,
    "--out",
    PUBLIC_OUT,
  ]);
  materializeSpaFallbacks(PUBLIC_OUT, generated);
  console.log(`✔ static deck at ${PUBLIC_OUT}`);
  console.log(`  serve route:    ${BASE_PATH}`);
  console.log(`  presenter view: ${BASE_PATH}presenter/`);
}

function countSlides(slidesMd) {
  // Slides are separated by `---` lines. The first `---/---` pair is slide 1's
  // frontmatter; each subsequent `---` line opens the next slide.
  const sepLines = slidesMd.split("\n").filter((l) => l.trim() === "---").length;
  // sepLines = 1 (open frontmatter) + (slideCount - 1) * 2 (each new slide has open `---` and close-of-frontmatter `---`)
  // For slides without frontmatter, the inter-slide `---` counts as 1.
  // Simpler heuristic: split on `\n---\n` and count text blocks that aren't pure YAML.
  const parts = slidesMd.split(/\n---\n/);
  // Heuristic: every other part (after the first frontmatter) is content, but
  // some slides have their own frontmatter. Pair scan:
  let count = 0;
  let i = 0;
  while (i < parts.length) {
    // skip an initial frontmatter-looking block
    if (i === 0 && /^---\s/.test(slidesMd)) {
      // first part is content under slide-1 frontmatter; that's slide 1
      count++;
      i++;
      continue;
    }
    // if this part looks like YAML frontmatter (key: value lines mostly), it's
    // the slide header — the *next* part is the slide body.
    const looksLikeFm = /^(?:[a-zA-Z][\w-]*:\s|---)/m.test(parts[i]) &&
                        !/^#\s/m.test(parts[i]);
    if (looksLikeFm && i + 1 < parts.length) {
      count++;
      i += 2;
    } else {
      count++;
      i += 1;
    }
  }
  return Math.max(count, sepLines); // fallback floor
}

function materializeSpaFallbacks(outDir, slidesGenerated) {
  // Astro / GH Pages / plain static hosts don't honor Slidev's _redirects.
  // Mirror index.html into the SPA route paths so direct URL loads work.
  const indexSrc = resolve(outDir, "index.html");
  if (!existsSync(indexSrc)) return;

  const slideCount = countSlides(slidesGenerated);
  const fixedRoutes = ["presenter", "overview", "notes", "print"];

  for (const route of fixedRoutes) {
    const dir = resolve(outDir, route);
    ensureDir(dir);
    copyFileSync(indexSrc, resolve(dir, "index.html"));
  }
  for (let n = 1; n <= slideCount; n++) {
    const slideDir = resolve(outDir, String(n));
    ensureDir(slideDir);
    copyFileSync(indexSrc, resolve(slideDir, "index.html"));
    const presDir = resolve(outDir, "presenter", String(n));
    ensureDir(presDir);
    copyFileSync(indexSrc, resolve(presDir, "index.html"));
  }
  console.log(`• materialized SPA fallbacks for ${slideCount} slides`);
}
