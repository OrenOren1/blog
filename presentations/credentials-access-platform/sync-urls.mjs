#!/usr/bin/env node
// After imgbb-resolve-prompts.mjs regenerates images and writes new
// ImgBB URLs into slide-prompts.md, this script extracts old→new URL
// mappings (from the .pre-rework.bak backup vs the new file) and
// rewrites slides.md in place so the deck picks up the new images.
//
// Usage: node sync-urls.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPTS_NEW = resolve(HERE, "slide-prompts.md");
const PROMPTS_OLD = resolve(HERE, "slide-prompts.md.pre-rework.bak");
const SLIDES = resolve(HERE, "slides.md");

if (!existsSync(PROMPTS_OLD)) {
  console.error(`✘ no backup at ${PROMPTS_OLD} — run transform-prompts.mjs first`);
  process.exit(1);
}

// Each per-slide section in slide-prompts.md has a header like
//   ## Slide N — ...    OR    ### Slide N — ...
// Followed by content including an image URL (i.ibb.co).
// We map slide number → ibb URL for both old and new files, then build
// a substitution table.

function extractUrlsBySlide(md) {
  const SECTION_RE = /^(#{2,3}) Slide (\d+) — [^\n]*$/gm;
  const URL_RE = /https:\/\/i\.ibb\.co\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+\.(?:jpg|jpeg|png)/g;
  const sections = [];
  let m;
  while ((m = SECTION_RE.exec(md)) !== null) {
    sections.push({ idx: m.index, slideNo: parseInt(m[2], 10) });
  }
  sections.push({ idx: md.length, slideNo: -1 });
  const map = new Map();
  for (let i = 0; i < sections.length - 1; i++) {
    const block = md.slice(sections[i].idx, sections[i + 1].idx);
    const urls = block.match(URL_RE) || [];
    if (urls.length > 0) {
      // Take the LAST url in the section — that's the most recently archived
      // image link sitting after the archive comment.
      map.set(sections[i].slideNo, urls[urls.length - 1]);
    }
  }
  return map;
}

const oldMd = readFileSync(PROMPTS_OLD, "utf8");
const newMd = readFileSync(PROMPTS_NEW, "utf8");
const oldUrls = extractUrlsBySlide(oldMd);
const newUrls = extractUrlsBySlide(newMd);

console.log(`• old prompts: ${oldUrls.size} urls`);
console.log(`• new prompts: ${newUrls.size} urls`);

const mapping = [];
for (const [slideNo, oldUrl] of oldUrls.entries()) {
  const newUrl = newUrls.get(slideNo);
  if (!newUrl) {
    console.warn(`  ! slide ${slideNo}: no new URL (skipping ${oldUrl})`);
    continue;
  }
  if (newUrl === oldUrl) continue; // no-op
  mapping.push({ slideNo, oldUrl, newUrl });
}

console.log(`• ${mapping.length} URL(s) to swap in slides.md`);

let slides = readFileSync(SLIDES, "utf8");
let swaps = 0;
for (const { slideNo, oldUrl, newUrl } of mapping) {
  // Escape regex metacharacters in the old URL
  const escaped = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "g");
  const before = slides;
  slides = slides.replace(re, newUrl);
  const n = (before.length - slides.length + (newUrl.length - oldUrl.length) * 0) > 0 ? 1 : 0;
  const occ = (before.match(re) || []).length;
  if (occ > 0) {
    swaps += occ;
    console.log(`  slide ${slideNo}: ${occ}× → ${newUrl.split("/").pop()}`);
  } else {
    console.warn(`  ! slide ${slideNo}: old URL not found in slides.md (${oldUrl})`);
  }
}

writeFileSync(SLIDES, slides, "utf8");
console.log(`✔ ${swaps} URL occurrence(s) replaced in ${SLIDES}`);
