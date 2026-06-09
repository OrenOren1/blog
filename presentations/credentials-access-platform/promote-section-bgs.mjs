#!/usr/bin/env node
// For every `layout: section` slide in slides.md, lift its inline kid-art
// <div><img src="..." alt="kids-book accent ..." /></div> into the slide's
// frontmatter as `background: <url>`, then delete the inline wrapper.
// Result: section slides combine the chalk art natively with no foreground
// wrapper to fight with — like the cover and thank-you already do.

import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(HERE, "slides.md");
const BACKUP = resolve(HERE, "slides.md.pre-section-bg.bak");

const src = readFileSync(FILE, "utf8");
copyFileSync(FILE, BACKUP);
console.log(`• backup → ${BACKUP}`);

// Split into slide blocks. Slides are separated by lines that are exactly `---`.
// A slide has a frontmatter (between first two `---`) then body.
// We process each slide body that contains a section layout.
const slides = [];
{
  const lines = src.split("\n");
  let cur = [];
  for (const line of lines) {
    cur.push(line);
    if (line.trim() === "---") {
      // boundary — keep accumulating; the splitter is the `---` at slide boundary
    }
  }
  // Simpler: split on slide-boundary `---` lines but preserve frontmatter `---` pairs.
  // Strategy: parse linearly, tracking whether we're inside a frontmatter block.
}

// Linear parse: walk lines, identify slides as (frontmatter, body).
function parseSlides(text) {
  const lines = text.split("\n");
  const slides = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() !== "---") {
      // skip any prose between slides (shouldn't happen at top level)
      const fmStart = i;
      while (i < lines.length && lines[i].trim() !== "---") i++;
      slides.push({ kind: "raw", lines: lines.slice(fmStart, i) });
      continue;
    }
    // We're at a slide-boundary `---`. Frontmatter starts at i+1.
    const fmStart = i + 1;
    let j = fmStart;
    while (j < lines.length && lines[j].trim() !== "---") j++;
    if (j >= lines.length) break;
    const fm = lines.slice(fmStart, j);
    const bodyStart = j + 1;
    let k = bodyStart;
    while (k < lines.length && lines[k].trim() !== "---") k++;
    const body = lines.slice(bodyStart, k);
    slides.push({ kind: "slide", fm, body });
    i = k;
  }
  return slides;
}

const slides2 = parseSlides(src);

const KID_DIV =
  /<div\s+style="[^"]*position:\s*absolute[^"]*"[^>]*>\s*<img\s+src="([^"]+)"\s+alt="(kids-book[^"]*)"[^>]*\/>\s*<\/div>/i;

let promoted = 0;
for (const s of slides2) {
  if (s.kind !== "slide") continue;
  const isSection = s.fm.some((l) => /^\s*layout\s*:\s*section\s*$/.test(l));
  if (!isSection) continue;
  // Find the inline kid-art div in the body
  const joined = s.body.join("\n");
  const m = joined.match(KID_DIV);
  if (!m) continue;
  const url = m[1];
  // Add `background: <url>` to frontmatter if not already present
  const hasBg = s.fm.some((l) => /^\s*background\s*:/.test(l));
  if (!hasBg) s.fm.push(`background: ${url}`);
  // Remove the div from the body
  const newBody = joined.replace(KID_DIV, "").replace(/\n{3,}/g, "\n\n").trim();
  s.body = newBody.split("\n");
  promoted++;
}

// Reassemble
const out = [];
let first = true;
for (const s of slides2) {
  if (s.kind === "raw") {
    out.push(...s.lines);
    continue;
  }
  out.push("---");
  out.push(...s.fm);
  out.push("---");
  out.push("");
  out.push(...s.body);
  out.push("");
}

writeFileSync(FILE, out.join("\n"), "utf8");
console.log(`✔ promoted ${promoted} section slide(s) to native background:`);
