#!/usr/bin/env node
// Bind all 25 chalk-art images locally and wire one into each content slide
// of slides.md. The 2 hero pictures (cover + thank-you) are already bound.
//
// Mapping is: <3032 source slide N> → <prompts-md slide N URL> → chalk-NN.jpg
// Slide 1 (cover) and slide 27 (thank-you) are skipped — they have their
// own hero JPGs already.

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SLIDES = resolve(HERE, "slides.md");
const PUBLIC = resolve(HERE, "public");
const BACKUP = resolve(HERE, "slides.md.pre-chalk-bind.bak");

// 3032-source-slide-N → ImgBB URL + alt text. Slide 1 (cover) and 27 (thank-you) skipped.
const MAPPING = {
  2:  { url: "https://i.ibb.co/CgQX4SM/img-2.jpg",   alt: "kids-book accent — rabbit with broken key" },
  3:  { url: "https://i.ibb.co/PXTNmVt/img-4.jpg",   alt: "kids-book accent — smiling anchor character" },
  4:  { url: "https://i.ibb.co/HfvH9MCY/img-6.jpg",  alt: "kids-book accent — sealed black box peeking eyes" },
  5:  { url: "https://i.ibb.co/LXbVHhSh/img-8.jpg",  alt: "kids-book accent — gear character mid-turn" },
  6:  { url: "https://i.ibb.co/pBmRCWM2/img-9.jpg",  alt: "kids-book accent — interlocking puzzle pieces" },
  7:  { url: "https://i.ibb.co/0pHnggYm/img-10.jpg", alt: "kids-book accent — row of tiny mascots" },
  8:  { url: "https://i.ibb.co/zHsXwfRQ/img-15.jpg", alt: "kids-book accent — three heads peering through magnifying glass" },
  9:  { url: "https://i.ibb.co/ZpDBbLrc/img-11.jpg", alt: "kids-book accent — robot and human shaking hands" },
  10: { url: "https://i.ibb.co/BVG6R8bZ/img-12.jpg", alt: "kids-book accent — robot handing envelope to server" },
  11: { url: "https://i.ibb.co/93rWdw1Q/img-13.jpg", alt: "kids-book accent — big key with mini-keys dangling" },
  12: { url: "https://i.ibb.co/Q3tM1yWv/img-14.jpg", alt: "kids-book accent — pager with on-call bandana" },
  13: { url: "https://i.ibb.co/1tDRcvh0/img-16.jpg", alt: "kids-book accent — open ledger book character" },
  14: { url: "https://i.ibb.co/rjtBdwL/img-17.jpg",  alt: "kids-book accent — stack of folders with padlocks" },
  15: { url: "https://i.ibb.co/JjBpgHct/img-18.jpg", alt: "kids-book accent — treasure map with winding path" },
  16: { url: "https://i.ibb.co/HTbjjzSz/img-19.jpg", alt: "kids-book accent — friendly cargo ship" },
  17: { url: "https://i.ibb.co/0ygM48WC/img-22.jpg", alt: "kids-book accent — two binoculars characters" },
  18: { url: "https://i.ibb.co/gLfGzDdC/img-20.jpg", alt: "kids-book accent — two globes holding hands across bridge" },
  19: { url: "https://i.ibb.co/9my0X7Lp/img-23.jpg", alt: "kids-book accent — friendly hammer and wrench" },
  20: { url: "https://i.ibb.co/Kj6scXWf/img-21.jpg", alt: "kids-book accent — brick wall character with protective arms" },
  21: { url: "https://i.ibb.co/HTPpzCd0/img-26.jpg", alt: "kids-book accent — three big eyes peering at scroll" },
  22: { url: "https://i.ibb.co/KcJrcNTK/img-24.jpg", alt: "kids-book accent — tree with file-folder leaves" },
  23: { url: "https://i.ibb.co/Mx6hTmhV/img-25.jpg", alt: "kids-book accent — robot conductor with baton" },
  24: { url: "https://i.ibb.co/tMRMfnGj/img-27.jpg", alt: "kids-book accent — owl in cyan glasses with log scroll" },
  25: { url: "https://i.ibb.co/gM3J75fT/img-28.jpg", alt: "kids-book accent — scales of justice character" },
  26: { url: "https://i.ibb.co/mV9SnGFH/img-29.jpg", alt: "kids-book accent — locked + open padlock friends" },
};

// Use ImgBB URLs directly (no local download — faster, and ImgBB is stable).
console.log(`• wiring ${Object.keys(MAPPING).length} chalk-art accents via ImgBB URLs`);

// 2) Parse slides.md into slides and inject an inline accent div per mapping
function parseSlides(text) {
  const lines = text.split("\n");
  const slides = [];
  let i = 0;
  // Skip any prose before first --- boundary
  while (i < lines.length && lines[i].trim() !== "---") i++;
  while (i < lines.length) {
    if (lines[i].trim() !== "---") break;
    const fmStart = i + 1;
    let j = fmStart;
    while (j < lines.length && lines[j].trim() !== "---") j++;
    if (j >= lines.length) break;
    const fm = lines.slice(fmStart, j);
    const bodyStart = j + 1;
    let k = bodyStart;
    while (k < lines.length && lines[k].trim() !== "---") k++;
    const body = lines.slice(bodyStart, k);
    slides.push({ fm, body });
    i = k;
  }
  return slides;
}

const ACCENT_TEMPLATE = (url, alt) =>
  `<div style="position:absolute;right:1.5rem;bottom:1.5rem;width:120px;opacity:0.95;pointer-events:none;z-index:5;"><img src="${url}" alt="${alt}" style="width:100%;height:auto;display:block;" /></div>`;

const SECTION_TEMPLATE = (url, alt) =>
  `<div style="position:absolute;right:3rem;bottom:4rem;width:180px;opacity:0.95;pointer-events:none;z-index:5;"><img src="${url}" alt="${alt}" style="width:100%;height:auto;display:block;" /></div>`;

const src = readFileSync(SLIDES, "utf8");
copyFileSync(SLIDES, BACKUP);
console.log(`\n• backup → ${BACKUP}`);

const slides = parseSlides(src);
console.log(`• parsed ${slides.length} slides from slides.md`);

let injected = 0;
for (let n = 0; n < slides.length; n++) {
  const sourceSlideNo = n + 1; // 1-based, matches 3032 source numbering
  const map = MAPPING[sourceSlideNo];
  if (!map) continue;
  const layout = (slides[n].fm.find((l) => /^layout:/.test(l)) || "").split(":")[1]?.trim();
  const isSection = layout === "section";
  // Avoid double-injection if user runs the script twice
  if (slides[n].body.some((l) => l.includes(map.url))) continue;
  const div = (isSection ? SECTION_TEMPLATE : ACCENT_TEMPLATE)(map.url, map.alt);
  // Trim trailing empty lines before appending so the div sits cleanly
  while (slides[n].body.length && slides[n].body[slides[n].body.length - 1].trim() === "") {
    slides[n].body.pop();
  }
  slides[n].body.push("");
  slides[n].body.push(div);
  slides[n].body.push("");
  injected++;
}

// 3) Reassemble
const out = [];
for (const s of slides) {
  out.push("---");
  out.push(...s.fm);
  out.push("---");
  out.push(...s.body);
}
writeFileSync(SLIDES, out.join("\n"), "utf8");
console.log(`✔ injected ${injected} chalk-art accents into slides.md`);
