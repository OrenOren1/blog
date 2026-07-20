#!/usr/bin/env node
// Build the Least-Privilege High-Level deck.
// - With no flags: runs `slidev build` writing to ../../public/presentations/least-privileges-implemented/,
//   then materializes SPA fallbacks so /presenter/, /notes/, /print/, /overview/, and /<n>/
//   direct URLs work on hosts (GitHub Pages, Astro) that don't honor Slidev's _redirects.
// - With --dev:    runs `slidev` dev server.
// - With --export: runs `slidev export` to PDF.

import { readFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BLOG_ROOT = resolve(HERE, "..", "..", "..");
const SLIDES_SRC = resolve(HERE, "slides.md");
const PUBLIC_OUT = resolve(BLOG_ROOT, "public/presentations/least-privileges-implemented");
const BASE_PATH = "/presentations/least-privileges-implemented/";

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

function countSlides(slidesMd) {
  // Every slide has an open `---` and close `---` for its frontmatter.
  // Slide 1's frontmatter is merged with global, so it shares a `---` pair too.
  // Count `^---$` lines and divide by 2.
  const sepLines = slidesMd.split("\n").filter((l) => l.trim() === "---").length;
  return Math.max(1, Math.floor(sepLines / 2));
}

function materializeSpaFallbacks(outDir, slidesMd) {
  const indexSrc = resolve(outDir, "index.html");
  if (!existsSync(indexSrc)) return;

  const slideCount = countSlides(slidesMd);
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

const mode = process.argv.includes("--dev")
  ? "dev"
  : process.argv.includes("--export")
  ? "export"
  : "build";

const slidesSrc = readFileSync(SLIDES_SRC, "utf8");
const slidevBin = resolve(HERE, "node_modules/.bin/slidev");
if (!existsSync(slidevBin)) {
  throw new Error("Slidev not installed. Run `npm install` in this folder first.");
}

if (mode === "dev") {
  run(slidevBin, ["slides.md", "--open"]);
} else if (mode === "export") {
  run(slidevBin, ["export", "slides.md"]);
} else {
  ensureDir(PUBLIC_OUT);
  run(slidevBin, ["build", "slides.md", "--base", BASE_PATH, "--out", PUBLIC_OUT]);
  materializeSpaFallbacks(PUBLIC_OUT, slidesSrc);
  console.log(`✔ static deck at ${PUBLIC_OUT}`);
  console.log(`  main view:      ${BASE_PATH}`);
  console.log(`  presenter view: ${BASE_PATH}presenter/`);
  console.log(`  notes view:     ${BASE_PATH}notes/`);
}
