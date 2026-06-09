#!/usr/bin/env node
// Transform slide-prompts.md so every archived prompt is converted back to
// an [IMAGE_PROMPT: ...] marker the resolve script will process, with the
// fake-transparency wording replaced by a "solid #0a0a0a background"
// instruction. Slides 1 (cover) and 30 (thank-you) get bespoke hero prompts.
//
// Usage:  node transform-prompts.mjs
// Writes: slide-prompts.md (in place — backup created as .pre-rework.bak)

import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPTS = resolve(HERE, "slide-prompts.md");
const BACKUP = resolve(HERE, "slide-prompts.md.pre-rework.bak");

const BG_INSTRUCTION_NEW =
  "SOLID NEAR-BLACK BACKGROUND (#0a0a0a) — fill the entire square frame edge-to-edge with one flat very-dark colour so it sits seamlessly on a dark slide. ABSOLUTELY NO transparency, NO checkerboard pattern, NO white margins, NO paper texture, NO chalkboard surface, NO scenery, NO ground line, NO shadow disc — just the chalky subject and white-chalk scribble accents on a single uniform #0a0a0a fill.";

// Patterns we want to neutralize in the archived chalk prompts.
const PATTERNS_TO_REWRITE = [
  /PURE\s+TRANSPARENT\s+PNG\s+BACKGROUND[\s\S]*?(?=No text)/i,
  /transparent\s+PNG\s+background[\s\S]*?(?=No text)/i,
];

// New hero prompts for slides 1 and 30 (cover + thank-you).
const HERO_COVER = `Wide cinematic concept-art landscape, 16:9, full-bleed hero illustration.
Subject: a vast luminous credential-vault — translucent geometric keys orbit a glowing locked core, each key emitting soft cyan inner light. Arcs of liquid light trace credential flows between the keys and the core, suggesting a layered access architecture in motion.
Lower third of the frame is deeper, darker, more grounded (deliberately keeping negative space for a title overlay). Upper two-thirds carry the imagery: volumetric god-rays cutting through floating particles, gentle bokeh on the background grid.
Style: cinematic concept art, photorealistic with painterly volumetric lighting, deep depth-of-field, subtle film grain.
Color palette: deep navy backdrop (#0d1117) with neon-cyan highlights (#7efff5), occasional violet ambient bleed (#a78bfa), warm amber sparks accenting the keys.
SOLID DARK BACKGROUND filling the entire frame — no white edges, no checker pattern, no transparency, no margins. Wide 16:9 aspect.
NO text, NO logos, NO people, NO signature, NO watermark. Mood: sophisticated, technical, the opening shot of an architecture story.`;

const HERO_THANKYOU = `Wide cinematic concept-art landscape, 16:9, full-bleed hero illustration.
Subject: a single glowing key in mid-air, its bow naturally forming a soft question-mark silhouette. The key is intertwined with a stylized geometric padlock that is just beginning to open — the shackle lifted a hand's breadth, an inviting glow spilling from the cylinder. Tendrils of cyan light reach outward as if drawing the viewer in.
Background: a dark architectural circuit-grid recedes into bokeh; soft volumetric beams catch motes of dust. Lower third deliberately darker for any title/CTA overlay.
Style: minimalist cyberpunk, photorealistic with painterly edges, deep depth-of-field, soft particles.
Color palette: deep navy (#0d1117), neon cyan (#7efff5), subtle violet ambient (#a78bfa), warm amber halo on the key.
SOLID DARK BACKGROUND filling the entire frame — no white edges, no checker pattern, no transparency, no margins. Wide 16:9 aspect.
NO text, NO logos, NO people, NO signature, NO watermark. Mood: open, inviting — "what unlocks next?" — the closing breath of the architecture story before Q&A.`;

const SLIDE_HERO_PROMPTS = {
  1: HERO_COVER,
  30: HERO_THANKYOU,
};

function decode(b64) {
  return Buffer.from(b64, "base64").toString("utf8");
}

function rewriteChalkPrompt(prompt) {
  let out = prompt;
  for (const re of PATTERNS_TO_REWRITE) {
    if (re.test(out)) {
      out = out.replace(re, BG_INSTRUCTION_NEW + " ");
      return out;
    }
  }
  // Fallback: just append the background instruction if no transparent-PNG
  // phrase found — better to over-instruct than ship checker again.
  return out + " " + BG_INSTRUCTION_NEW;
}

const src = readFileSync(PROMPTS, "utf8");
copyFileSync(PROMPTS, BACKUP);
console.log(`• backup written to ${BACKUP}`);

// Match each slide section by its header so we can identify slide numbers
// and apply hero prompts where appropriate. Section header forms:
//   ## Slide N — Title
//   ### Slide N — Title
const SECTION_RE =
  /^(#{2,3}) Slide (\d+) — .*$/gm;

const sections = [];
let m;
while ((m = SECTION_RE.exec(src)) !== null) {
  sections.push({ start: m.index, slideNo: parseInt(m[2], 10), header: m[0] });
}
sections.push({ start: src.length, slideNo: -1, header: null });

let out = "";
let cursor = 0;
let rewriteCount = 0;
let heroCount = 0;

for (let i = 0; i < sections.length - 1; i++) {
  const s = sections[i];
  const e = sections[i + 1];
  // Preserve everything before the first slide section verbatim.
  if (i === 0) out += src.slice(cursor, s.start);
  cursor = s.start;

  let block = src.slice(s.start, e.start);
  const heroPrompt = SLIDE_HERO_PROMPTS[s.slideNo];

  if (heroPrompt) {
    // Replace the body of the section (everything after the header line) with
    // a clean status line + new IMAGE_PROMPT marker.
    const lines = block.split("\n");
    const headerLine = lines[0];
    const tail =
      s.slideNo === 1
        ? "\n\n**Status:** hero regeneration · placement: full-bleed background behind the title text · aspect 16:9.\n\n[IMAGE_PROMPT: " +
          heroPrompt +
          "]\n\n---\n"
        : "\n\n**Status:** hero regeneration · placement: full-bleed background on the thank-you slide · aspect 16:9.\n\n[IMAGE_PROMPT: " +
          heroPrompt +
          "]\n";
    block = headerLine + tail;
    heroCount++;
  } else {
    // Chalk-art slide — find the archived prompt, decode + rewrite + restore.
    const ARCHIVE_RE =
      /<!--\s*image_prompt:archive\s+([^>]*?)\s*-->\s*\n!\[[^\]]*\]\([^)]+\)/m;
    const am = block.match(ARCHIVE_RE);
    if (am) {
      const attrs = am[1];
      const b64m = attrs.match(/b64=([A-Za-z0-9+/=_-]+)/);
      if (b64m) {
        const decoded = decode(b64m[1]);
        const rewritten = rewriteChalkPrompt(decoded);
        const replacement = `[IMAGE_PROMPT: ${rewritten}]`;
        block = block.replace(ARCHIVE_RE, replacement);
        rewriteCount++;
      }
    }
  }

  out += block;
}

writeFileSync(PROMPTS, out, "utf8");
console.log(
  `✔ transformed: ${heroCount} hero slide(s), ${rewriteCount} chalk slide(s) reset to [IMAGE_PROMPT: …]`,
);
console.log(`  → ${PROMPTS}`);
console.log(
  "  Next: cd ~/blog && node scripts/imgbb-resolve-prompts.mjs presentations/credentials-access-platform/slide-prompts.md",
);
