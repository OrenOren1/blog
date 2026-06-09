#!/usr/bin/env node
// Inject a small set of speaker notes (Hebrew, RTL-wrapped). Removes any
// existing `<!-- ... -->` block at the end of each slide body first, then
// injects the configured note for the chosen slides only. All other slides
// are left empty so the author can fill them in.

import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SLIDES = resolve(HERE, "slides.md");
const BACKUP = resolve(HERE, "slides.md.pre-notes.bak");

// Only these slides get notes. All others are emptied.
const NOTES = {
  1: `<div dir="rtl">

פתיחה. הדק הולך מהבעיה דרך הארכיטקטורה אל ההחלטות הפתוחות. קהל: פלטפורמה,
אבטחה, SRE. יעד היישור — מודל ארבעת המקרים לבני אדם, Workload OIDC לשירותים,
ושלוש שכבות IaC (ADR-008). ~25 דק' + שאלות.

</div>`,
  2: `<div dir="rtl">

לפתוח עם דחיפות. סוד SCRAM משותף לכל workload ולכל אדם הוא הסיכון המוביל —
לפטופ on-call שנפרץ + סוד K8s ישן = כתיבה מתמשכת על כל הדאטה. מספרים להזכיר:
27 K8s Secrets בגילאים 87–291 ימים, 16 ORG_OWNERs באטלס, 18 חשבונות לא
פעילים מעל 12 חודש. הוק: "עומד להכפיל את עצמו" — prod-eu עולה והחוב גדל
לפי region × DB.

</div>`,
  27: `<div dir="rtl">

סיכום. שלוש בקשות מהקהל: פידבק על מודל ארבעת המקרים (הליבה הרעיונית),
העדפה ל-Path A / B / C עבור D-1 (ההחלטה הפתוחה), וכל תרחיש blast-radius
שפספסתי בניתוח אזורי האמון. פרטי קשר על המסך — Slack, LinkedIn, GitHub.

</div>`,
};

function parseSlides(text) {
  const lines = text.split("\n");
  const slides = [];
  let i = 0;
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

function stripTrailingNoteBlock(bodyLines) {
  // Remove any trailing `<!-- ... -->` HTML comment block (and the
  // whitespace around it). Operates on the END of the body only — note
  // blocks that aren't at the tail are left intact.
  let i = bodyLines.length - 1;
  while (i >= 0 && bodyLines[i].trim() === "") i--;
  if (i < 0 || bodyLines[i].trim() !== "-->") return bodyLines;
  const endIdx = i;
  // Walk back to the matching `<!--`
  let openIdx = -1;
  for (let j = endIdx - 1; j >= 0; j--) {
    if (bodyLines[j].trim() === "<!--") {
      openIdx = j;
      break;
    }
    // Bail out if we hit any non-comment content line — we don't want to
    // eat anything that isn't a clean trailing comment block.
    if (bodyLines[j].trim() !== "" && !/^<!--/.test(bodyLines[j]) &&
        !/-->/.test(bodyLines[j])) {
      // It's a comment-internal line, keep walking
    }
  }
  if (openIdx === -1) return bodyLines;
  const kept = bodyLines.slice(0, openIdx);
  // Trim trailing empties on what's kept
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  kept.push("");
  return kept;
}

const src = readFileSync(SLIDES, "utf8");
copyFileSync(SLIDES, BACKUP);
console.log(`• backup → ${BACKUP}`);

const slides = parseSlides(src);
console.log(`• parsed ${slides.length} slides`);

let stripped = 0;
let injected = 0;

for (let n = 0; n < slides.length; n++) {
  const slideNo = n + 1;
  const before = slides[n].body.length;
  slides[n].body = stripTrailingNoteBlock(slides[n].body);
  if (slides[n].body.length < before) stripped++;

  const note = NOTES[slideNo];
  if (!note) continue;
  slides[n].body.push("<!--");
  for (const ln of note.split("\n")) slides[n].body.push(ln);
  slides[n].body.push("-->");
  slides[n].body.push("");
  injected++;
}

const out = [];
for (const s of slides) {
  out.push("---");
  out.push(...s.fm);
  out.push("---");
  out.push(...s.body);
}
writeFileSync(SLIDES, out.join("\n"), "utf8");
console.log(`✔ stripped ${stripped} trailing note block(s); injected ${injected} Hebrew note(s)`);
