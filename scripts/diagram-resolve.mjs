#!/usr/bin/env node
/**
 * Converts [DIAGRAM_MERMAID: ...] markers in blog posts to AI-generated diagram images.
 *
 * Flow:
 *   Mermaid code → Gemini text (rich image prompt) → Gemini Nano Banana (image) → ImgBB → ![alt](url)
 *
 * Marker format (place in markdown):
 *   [DIAGRAM_MERMAID: alt="Caption text"
 *   graph TB
 *     A["Component A"] --> B["Component B"]
 *   ]
 *
 *   The first line may contain `alt="..."` (optional). The remaining lines are Mermaid code.
 *   If alt is omitted, it is derived from the diagram type + first node labels.
 *
 * Resolved form (written back):
 *   <!-- diagram_mermaid:archive index=1 b64=BASE64_OF_MERMAID_CODE -->
 *   ![Caption text](https://i.ibb.co/...)
 *
 * Usage:
 *   node scripts/diagram-resolve.mjs <path-to-post.md> [--dry-run] [--list-slots]
 *   node scripts/diagram-resolve.mjs <post.md> --slot=N    # reprocess one diagram
 *   node scripts/diagram-resolve.mjs <post.md> --id=slug   # reprocess by id
 *
 * Env:
 *   GEMINI_API_KEY           — primary Gemini key (also reads .googleAI-token, one per line)
 *   GEMINI_API_KEYS          — comma-separated extra keys
 *   IMGBB_API_KEY            — ImgBB key (also reads .imgbb-token)
 *   GEMINI_TEXT_MODEL        — text model for Mermaid→prompt step (default: gemini-2.5-flash)
 *   GEMINI_IMAGE_MODEL_CHAIN — image models (default: 3-pro → 3.1-flash → 2.5-flash)
 *   GEMINI_IMAGE_ASPECT_RATIO — e.g. 16:9 (default) 4:3 1:1
 *   GEMINI_IMAGE_SIZE        — 512 | 1K | 2K | 4K for Gemini 3.x models (default 2K)
 *   GEMINI_REQUEST_TIMEOUT_MS — per-request timeout (default 180000)
 *   DIAGRAM_STYLE            — extra style instruction appended to generated prompt
 *   DIAGRAM_SKIP_LLM         — set to 1 to skip text→prompt step and use raw Mermaid as prompt
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ── Marker regexes ────────────────────────────────────────────────────────────

/** Matches the full [DIAGRAM_MERMAID: ...] block, including multi-line code. */
const DIAGRAM_BLOCK = /\[DIAGRAM_MERMAID:\s*([\s\S]*?)\]/g;

/** Matches resolved archive comments. */
const ARCHIVE_LINE = /<!--\s*diagram_mermaid:archive\s+([^>]*?)\s*-->/g;

// ── Secrets ───────────────────────────────────────────────────────────────────

function readAllSecretLines(fileName) {
  const p = resolve(REPO_ROOT, fileName);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function loadImgbbKey() {
  if (process.env.IMGBB_API_KEY?.trim()) return process.env.IMGBB_API_KEY.trim();
  return readAllSecretLines(".imgbb-token")[0] ?? null;
}

function loadGeminiKeyCandidates() {
  const keys = [];
  const push = (k) => {
    const t = typeof k === "string" ? k.trim() : "";
    if (t && !keys.includes(t)) keys.push(t);
  };
  if (process.env.GEMINI_API_KEY?.trim()) push(process.env.GEMINI_API_KEY);
  if (process.env.GEMINI_API_KEYS?.trim()) {
    for (const part of process.env.GEMINI_API_KEYS.split(",")) push(part);
  }
  for (const line of readAllSecretLines(".googleAI-token")) push(line);
  for (const line of readAllSecretLines(".gemini-api-key")) push(line);
  return keys;
}

// ── Gemini text: Mermaid → image prompt ──────────────────────────────────────

const MERMAID_TO_PROMPT_SYSTEM = `You are a technical diagram visualizer for a DevOps/Platform engineering blog.

Given Mermaid diagram code, produce a single detailed image generation prompt that describes the diagram as a polished technical illustration. The prompt will be sent directly to an AI image model (Gemini image generation).

Visual style requirements — include these in every prompt:
- Dark background: solid #1e1e1e or #2B2B2B
- Node/box borders: glowing orange #FF8C42
- Secondary connections or data-flow arrows: teal #4ECDC4
- All arrow lines: bright orange #FF8C42
- Label text: clean white #FFFFFF, monospace or sans-serif
- Subgraph / zone backgrounds: very dark #111111 with a faint colored border
- Overall aesthetic: sleek dark-mode infrastructure diagram, like a Grafana or ArgoCD dashboard
- No decorative backgrounds, no people, no nature metaphors — pure technical diagram

Diagram content requirements:
- Transcribe every node label verbatim as a labeled box/node
- Show every arrow with a label if one exists in the Mermaid code
- Respect layout direction (TB = top-to-bottom, LR = left-to-right, etc.)
- Show subgraphs as clearly bordered named zones
- State machines: circles for states, labeled transitions

Output ONLY the image generation prompt. No explanations. No markdown fences. No preamble.`;

function geminiTextModel() {
  return process.env.GEMINI_TEXT_MODEL?.trim() || "gemini-2.5-flash";
}

async function mermaidToImagePrompt(mermaidCode, altHint) {
  if (process.env.DIAGRAM_SKIP_LLM === "1") {
    const style = process.env.DIAGRAM_STYLE?.trim();
    return [
      `Technical diagram illustration: ${altHint || "architecture diagram"}. Dark background #1e1e1e, orange #FF8C42 borders, teal #4ECDC4 arrows, white labels. Mermaid diagram: ${mermaidCode.slice(0, 400)}`,
      style,
    ]
      .filter(Boolean)
      .join(" ");
  }

  const keys = loadGeminiKeyCandidates();
  if (!keys.length) {
    throw new Error(
      "No Gemini keys found. Set GEMINI_API_KEY or add lines to .googleAI-token.",
    );
  }

  const model = geminiTextModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const userMessage = [
    altHint ? `Caption / alt text hint: "${altHint}"` : null,
    "",
    "Mermaid code:",
    "```",
    mermaidCode.trim(),
    "```",
  ]
    .filter((l) => l !== null)
    .join("\n");

  const body = {
    system_instruction: { parts: [{ text: MERMAID_TO_PROMPT_SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 600,
    },
  };

  const timeoutMs = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS) || 60000;

  for (const key of keys) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e?.name === "TimeoutError" || e?.name === "AbortError") {
        throw new Error(`Gemini text timeout after ${timeoutMs}ms (${model})`);
      }
      throw e;
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      if ([429, 401, 403].includes(res.status)) {
        console.error(`  Text key failed (${res.status}), trying next…`);
        continue;
      }
      throw new Error(`Gemini text error ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
    }

    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      throw new Error(`Gemini text returned no content: ${JSON.stringify(json).slice(0, 400)}`);
    }

    const style = process.env.DIAGRAM_STYLE?.trim();
    return style ? `${text}\n\n${style}` : text;
  }

  throw new Error("Gemini text: all keys failed");
}

// ── Gemini image generation ───────────────────────────────────────────────────

const DEFAULT_IMAGE_MODELS = [
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image",
];

function imageModelChain() {
  const env = process.env.GEMINI_IMAGE_MODEL_CHAIN?.trim();
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_IMAGE_MODELS];
}

function imageAspectRatio() {
  const r = process.env.GEMINI_IMAGE_ASPECT_RATIO?.trim();
  return r && /^\d+:\d+$/.test(r) ? r : "16:9";
}

function imageSizeToken() {
  const s = (process.env.GEMINI_IMAGE_SIZE || "2K").trim().toUpperCase();
  return ["512", "1K", "2K", "4K"].includes(s) ? s : "2K";
}

function buildImageGenConfig(model) {
  const aspectRatio = imageAspectRatio();
  const is25Flash = model.includes("gemini-2.5-flash-image");
  const imageConfig = { aspectRatio };
  if (!is25Flash) imageConfig.imageSize = imageSizeToken();
  return { responseModalities: ["TEXT", "IMAGE"], imageConfig };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransient(res, json) {
  if ([503, 504, 429].includes(res.status)) return true;
  const st = String(json?.error?.status || "");
  return st === "UNAVAILABLE" || st === "RESOURCE_EXHAUSTED";
}

function shouldRotateKey(res, json) {
  if ([429, 401, 403].includes(res.status)) return true;
  if (res.status === 400) {
    const reasons = Array.isArray(json?.error?.details)
      ? json.error.details.map((d) => d?.reason).filter(Boolean)
      : [];
    const msg = String(json?.error?.message || "").toLowerCase();
    return reasons.includes("API_KEY_INVALID") || msg.includes("api key not valid");
  }
  return false;
}

async function generateImageBase64(prompt) {
  const keys = loadGeminiKeyCandidates();
  if (!keys.length) throw new Error("No Gemini keys found.");

  const timeoutMs = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS) || 180000;
  const maxAttempts = Math.min(Math.floor(Number(process.env.GEMINI_TRANSIENT_RETRIES) || 5), 12);
  const models = imageModelChain();

  const instruction = [
    "Generate exactly one image for a technical blog audience.",
    "Follow the brief below as literally as possible: composition, objects, palette, and constraints.",
    "Include every concrete element named (services, nodes, shapes) in recognizable form.",
    "Output an image (not only text).",
    "",
    "Brief:",
    prompt,
  ].join("\n");

  const body = (model) => ({
    contents: [{ parts: [{ text: instruction }] }],
    generationConfig: buildImageGenConfig(model),
  });

  let lastErr = null;
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    try {
      for (let ki = 0; ki < keys.length; ki++) {
        const key = keys[ki];
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          console.error(
            `  Image: ${model} key ${ki + 1}/${keys.length} attempt ${attempt}/${maxAttempts}…`,
          );
          const res = await fetch(url, {
            method: "POST",
            headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
            body: JSON.stringify(body(model)),
            signal: AbortSignal.timeout(timeoutMs),
          });
          const json = await res.json().catch(() => ({}));
          if (res.ok) {
            const parts = json?.candidates?.[0]?.content?.parts ?? [];
            for (const part of parts) {
              const data = (part?.inlineData || part?.inline_data)?.data;
              if (data) return data;
            }
            throw new Error(`Gemini returned no image data (${model})`);
          }
          if (isTransient(res, json) && attempt < maxAttempts) {
            const backoff = Math.min(45000, 2000 * 2 ** (attempt - 1));
            console.error(`  ${res.status} — retrying in ${backoff}ms…`);
            await sleep(backoff);
            continue;
          }
          if (shouldRotateKey(res, json) && ki < keys.length - 1) {
            console.error(`  Key ${ki + 1} rejected (${res.status}), rotating…`);
            await sleep(600);
            break;
          }
          throw new Error(`Gemini image ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
        }
      }
    } catch (e) {
      lastErr = e;
      const next = models[models.indexOf(model) + 1];
      if (next) {
        console.error(`  Model ${model} failed — trying ${next}…`);
        await sleep(800);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("All Gemini image models failed");
}

// ── ImgBB upload ──────────────────────────────────────────────────────────────

async function imgbbUpload(base64, name) {
  const key = loadImgbbKey();
  if (!key) throw new Error("No ImgBB key found. Set IMGBB_API_KEY or add .imgbb-token.");
  const body = new URLSearchParams();
  body.set("key", key);
  body.set("image", base64);
  if (name) body.set("name", String(name).slice(0, 32).replace(/[^a-z0-9-_]/gi, "-"));
  const res = await fetch("https://api.imgbb.com/1/upload", {
    method: "POST",
    body,
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`ImgBB upload error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.success) throw new Error(`ImgBB error: ${JSON.stringify(json)}`);
  return json.data.url;
}

// ── Marker parsing ────────────────────────────────────────────────────────────

/**
 * Parse the raw content inside [DIAGRAM_MERMAID: ...].
 * First line: optional `alt="Caption"` and/or `id="slug"` attributes.
 * Remaining lines: Mermaid code.
 */
function parseDiagramContent(inner) {
  const lines = inner.trimStart().split(/\r?\n/);
  let alt = null;
  let id = null;
  let codeStart = 0;

  // Check if first line is attribute-only (no mermaid keywords)
  const firstLine = lines[0]?.trim() ?? "";
  const attrOnly = /^(alt|id)\s*=/.test(firstLine) || (firstLine.startsWith('"') && !firstLine.includes("graph") && !firstLine.includes("flowchart") && !firstLine.includes("sequenceDiagram") && !firstLine.includes("stateDiagram") && !firstLine.includes("gantt") && !firstLine.includes("classDiagram") && !firstLine.includes("erDiagram") && !firstLine.includes("pie"));

  if (attrOnly) {
    const altMatch = /alt\s*=\s*["']([^"']*)["']/i.exec(firstLine);
    const idMatch = /id\s*=\s*["']([^"']*)["']/i.exec(firstLine);
    if (altMatch) alt = altMatch[1].trim();
    if (idMatch) id = idMatch[1].trim();
    codeStart = 1;
  }

  const code = lines.slice(codeStart).join("\n").trim();

  // Derive alt from diagram type if not supplied
  if (!alt) {
    const typeMatch = /^(graph|flowchart|sequenceDiagram|stateDiagram|classDiagram|erDiagram|gantt|pie)/im.exec(code);
    alt = typeMatch ? `${typeMatch[1]} diagram` : "Architecture diagram";
  }

  return { alt, id, code };
}

function collectDiagramRanges(content) {
  const items = [];
  DIAGRAM_BLOCK.lastIndex = 0;
  let m;
  while ((m = DIAGRAM_BLOCK.exec(content)) !== null) {
    const { alt, id, code } = parseDiagramContent(m[1]);
    items.push({
      start: m.index,
      end: m.index + m[0].length,
      full: m[0],
      code,
      alt,
      id,
    });
  }
  return items;
}

function collectResolvedDiagrams(content) {
  const items = [];
  ARCHIVE_LINE.lastIndex = 0;
  let m;
  while ((m = ARCHIVE_LINE.exec(content)) !== null) {
    const attrs = m[1];
    const indexMatch = /index=(\d+)/.exec(attrs);
    const idMatch = /id=([^\s]+)/.exec(attrs);
    const b64Match = /b64=(\S+)/.exec(attrs);
    const archiveIndex = indexMatch ? Number(indexMatch[1]) : null;
    const id = idMatch ? decodeURIComponent(idMatch[1]) : null;
    let code = null;
    if (b64Match) {
      try { code = Buffer.from(b64Match[1], "base64url").toString("utf8"); } catch {
        try { code = Buffer.from(b64Match[1], "base64").toString("utf8"); } catch { /* ignore */ }
      }
    }
    items.push({ kind: "resolved", start: m.index, end: m.index + m[0].length, archiveIndex, id, code, alt: null });
  }
  return items;
}

// ── Slot catalog ──────────────────────────────────────────────────────────────

function buildCatalog(content) {
  const markers = collectDiagramRanges(content).map((it, i) => ({
    kind: "marker",
    ...it,
    markerIndex: i + 1,
  }));
  const resolved = collectResolvedDiagrams(content);
  return [...markers, ...resolved].sort((a, b) => a.start - b.start);
}

function parseSlotFilter(args) {
  for (const a of args) {
    if (a === "--cover") return { type: "cover" };
    const slot = /^--slot=(\d+)$/.exec(a);
    if (slot) return { type: "slot", value: Number(slot[1]) };
    const id = /^--id=(.+)$/.exec(a);
    if (id) return { type: "id", value: id[1] };
  }
  return null;
}

function matchesFilter(item, filter) {
  if (!filter) return true;
  if (filter.type === "slot") {
    if (item.kind === "resolved" && item.archiveIndex != null) return item.archiveIndex === filter.value;
    if (item.kind === "marker") return item.markerIndex === filter.value;
  }
  if (filter.type === "id") return item.id === filter.value;
  return false;
}

function isCliFlag(a) {
  return a.startsWith("--") || a === "-h";
}

// ── Output formatting ─────────────────────────────────────────────────────────

function archiveComment(code, { index, id }) {
  let b64;
  try { b64 = Buffer.from(code, "utf8").toString("base64url"); }
  catch { b64 = Buffer.from(code, "utf8").toString("base64"); }
  const bits = [`index=${index}`];
  if (id) bits.push(`id=${encodeURIComponent(id)}`);
  return `<!-- diagram_mermaid:archive ${bits.join(" ")} b64=${b64} -->`;
}

function markdownForDiagram(it, url, slotIndex) {
  const comment = archiveComment(it.code, { index: slotIndex, id: it.id ?? null });
  return `${comment}\n![${it.alt}](${url})`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const listSlots = args.includes("--list-slots");
  const slotFilter = parseSlotFilter(args);
  const fileArg = args.find((a) => !isCliFlag(a));

  if (!fileArg) {
    console.error(
      "Usage: node scripts/diagram-resolve.mjs <post.md> [options]\n" +
      "  --dry-run              show what would be generated without API calls\n" +
      "  --list-slots           list pending and resolved diagrams\n" +
      "  --slot=N               reprocess diagram at position N\n" +
      "  --id=slug              reprocess diagram with matching id attribute\n" +
      "\nMarker format:\n" +
      '  [DIAGRAM_MERMAID: alt="Caption"\n' +
      "  graph TB\n" +
      '    A["Service A"] --> B["Service B"]\n' +
      "  ]",
    );
    process.exit(1);
  }

  const filePath = resolve(process.cwd(), fileArg);
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const raw = readFileSync(filePath, "utf8");
  const catalog = buildCatalog(raw);

  if (listSlots) {
    console.log(`Diagram slots in ${filePath}:\n`);
    if (!catalog.length) {
      console.log("  (none — add [DIAGRAM_MERMAID: ...] markers)");
    } else {
      for (const it of catalog) {
        const label = it.kind === "marker" ? `marker #${it.markerIndex}` : `resolved index=${it.archiveIndex}`;
        const preview = it.code ? it.code.replace(/\s+/g, " ").trim().slice(0, 60) : "(no code)";
        const idStr = it.id ? ` id=${it.id}` : "";
        const altStr = it.alt ? ` alt="${it.alt}"` : "";
        console.log(`  [${label}${idStr}${altStr}] ${preview}…`);
      }
    }
    process.exit(0);
  }

  const items = slotFilter
    ? catalog.filter((it) => it.kind === "marker" && matchesFilter(it, slotFilter))
    : catalog.filter((it) => it.kind === "marker");

  if (items.length === 0) {
    console.log("No [DIAGRAM_MERMAID: ...] markers found.");
    if (catalog.some((it) => it.kind === "resolved")) {
      console.log("Hint: resolved diagrams exist — use --list-slots to see them, --slot=N to regenerate.");
    }
    process.exit(0);
  }

  console.log(`Found ${items.length} diagram marker(s).${dryRun ? " (dry-run)" : ""}`);
  if (!dryRun) {
    const skipLlm = process.env.DIAGRAM_SKIP_LLM === "1";
    console.log(
      skipLlm
        ? "LLM step: skipped (DIAGRAM_SKIP_LLM=1) — using raw Mermaid as prompt hint"
        : `LLM step: ${geminiTextModel()} (Mermaid → image prompt)`,
    );
    console.log(`Image step: ${imageModelChain().join(" → ")}`);
  }

  const replacements = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const slotIndex = it.markerIndex ?? i + 1;
    const slug = it.id ?? `diagram-${slotIndex}`;

    console.error(`\n[${i + 1}/${items.length}] diagram marker #${slotIndex}${it.id ? ` id=${it.id}` : ""} alt="${it.alt}"`);
    console.error(`  Mermaid: ${it.code.replace(/\s+/g, " ").trim().slice(0, 80)}…`);

    if (dryRun) {
      replacements.push({
        start: it.start,
        end: it.end,
        markdown: markdownForDiagram(it, "https://i.ibb.co/PLACEHOLDER/dry-run.png", slotIndex),
      });
      continue;
    }

    console.error("  Converting Mermaid → image prompt via LLM…");
    const imagePrompt = await mermaidToImagePrompt(it.code, it.alt);
    console.error(`  Prompt (first 120 chars): ${imagePrompt.slice(0, 120)}…`);

    console.error("  Generating image…");
    const b64 = await generateImageBase64(imagePrompt);

    console.error("  Uploading to ImgBB…");
    const url = await imgbbUpload(b64, slug);
    console.log(`  → ${url}`);

    replacements.push({
      start: it.start,
      end: it.end,
      markdown: markdownForDiagram(it, url, slotIndex),
    });
  }

  // Apply replacements back-to-front so offsets stay valid
  replacements.sort((a, b) => b.start - a.start);
  let out = raw;
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.markdown + out.slice(r.end);
  }

  if (!dryRun) {
    writeFileSync(filePath, out, "utf8");
    console.log(`\nUpdated: ${filePath}`);
  } else {
    console.log("\nDry-run: file not modified.");
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
