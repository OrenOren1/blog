#!/usr/bin/env node
/**
 * Resolves IMAGE_PROMPT markers: image generation (Gemini "Nano Banana" or OpenAI) → ImgBB → markdown.
 *
 * Usage:
 *   node scripts/imgbb-resolve-prompts.mjs <path-to-post.md> [--dry-run] [--use-first-as-cover] [--background]
 *
 * --background — detach: writes stdout/stderr to scripts/blog-images-resolve.log and exits immediately (tail that file).
 *
 * Env:
 *   IMAGE_GEN_PROVIDER — `auto` (default), `gemini`, or `openai`
 *     auto: use Gemini if any Gemini key is set (env or multi-line .googleAI-token / .gemini-api-key), else OpenAI
 *   GEMINI_API_KEY — primary Gemini API key (optional if keys exist in files)
 *   GEMINI_API_KEYS — comma-separated extra keys (tried after GEMINI_API_KEY, before files)
 *   GEMINI_IMAGE_MODEL — optional; if set, tried first, then the default chain continues with other models (deduped).
 *   GEMINI_IMAGE_MODEL_CHAIN — comma-separated Nano Banana models (overrides default chain entirely if set).
 *     Default chain (quality / instruction-following first): 3 Pro image → 3.1 Flash image preview → 2.5 Flash image.
 *     For speed or fewer 503/429 on Pro, set e.g. GEMINI_IMAGE_MODEL_CHAIN=gemini-3.1-flash-image-preview,gemini-2.5-flash-image,gemini-3-pro-image-preview
 *   GEMINI_IMAGE_ASPECT_RATIO — output aspect ratio (default 16:9). See Gemini image REST docs for allowed values.
 *   GEMINI_IMAGE_SIZE — for Gemini 3.x image models only: 512 | 1K | 2K | 4K (default 2K). Ignored for gemini-2.5-flash-image.
 *   GEMINI_REQUEST_TIMEOUT_MS — per-request timeout (default 180000). Prevents “frozen” hangs.
 *   GEMINI_TRANSIENT_RETRIES — retries for same key on 503/504/429 (default 5, exponential backoff).
 *   GEMINI_PARALLEL (or BLOG_IMAGES_PARALLEL) — max concurrent image jobs (default 4, max 12). Set 1 for strict queue.
 *   GEMINI_PARALLEL_STAGGER_MS — optional delay index * ms before each Gemini call (reduces burst 429s when parallel).
 *   BLOG_IMAGES_ARCHIVE_PROMPTS — default on: each resolved slot becomes `<!-- image_prompt:archive … b64=… -->` then `![…](url)` so the ImgBB link stays in the body and the original prompt is preserved (decode with Buffer.from(b64,'base64url').toString('utf8')). Set to `0` to omit comments.
 *   GEMINI_IMAGE_EXTRA_INSTRUCTION — optional extra paragraph appended to the system instruction (e.g. stronger “no substitutions” rules).
 *   OPENAI_API_KEY — OpenAI when provider is openai or auto fallback
 *   IMGBB_API_KEY  — optional if repo root `.imgbb-token` exists (first line)
 *
 * Gemini keys: `GEMINI_API_KEY`, then `GEMINI_API_KEYS` (comma-separated), then every non-comment line in `.googleAI-token`, then `.gemini-api-key`. Retries the next key on 429/401/403 or 400 with invalid API key. ImgBB: `.imgbb-token` (first line) or `IMGBB_API_KEY`.
 *
 * Markers:
 *   [IMAGE_PROMPT: ...]
 *   Optional wrapper for OG/cover (updates front matter `image:` when it is empty or under /images/blog/):
 *     <!-- blog:image role="cover" id="hero" -->
 *     [IMAGE_PROMPT: ...]
 *     <!-- /blog:image -->
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, openSync, closeSync, writeSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const WRAPPED_BLOCK =
  /<!--\s*blog:image(?:\s+([^>]*?))?\s*-->\s*\r?\n\[IMAGE_PROMPT:\s*([\s\S]*?)\]\s*\r?\n<!--\s*\/blog:image\s*-->/g;
const BARE_PROMPT = /\[IMAGE_PROMPT:\s*([\s\S]*?)\]/g;

function readFirstLineSecret(fileName) {
  const lines = readAllSecretLines(fileName);
  return lines[0] ?? null;
}

/** Every non-empty, non-# line (e.g. multiple API keys in `.googleAI-token`, one per line). */
function readAllSecretLines(fileName) {
  const p = resolve(REPO_ROOT, fileName);
  if (!existsSync(p)) return [];
  const out = [];
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith("#")) out.push(t);
  }
  return out;
}

function loadImgbbKey() {
  if (process.env.IMGBB_API_KEY?.trim()) return process.env.IMGBB_API_KEY.trim();
  return readFirstLineSecret(".imgbb-token");
}

/** Ordered unique keys: env primary, env list, then file lines. */
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

function resolveImageProvider() {
  const explicit = process.env.IMAGE_GEN_PROVIDER?.trim().toLowerCase();
  if (explicit === "gemini") {
    if (!loadGeminiKeyCandidates().length) {
      throw new Error(
        "IMAGE_GEN_PROVIDER=gemini but no Gemini keys found (GEMINI_API_KEY, GEMINI_API_KEYS, or lines in .googleAI-token / .gemini-api-key).",
      );
    }
    return "gemini";
  }
  if (explicit === "openai") {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      throw new Error("IMAGE_GEN_PROVIDER=openai but OPENAI_API_KEY is missing.");
    }
    return "openai";
  }
  if (explicit && explicit !== "auto") {
    throw new Error(`IMAGE_GEN_PROVIDER must be auto, gemini, or openai (got ${explicit})`);
  }
  if (loadGeminiKeyCandidates().length) return "gemini";
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  return null;
}

/** Pro first: better adherence to complex prompts / diagrams; falls back if overloaded or errors. */
const DEFAULT_GEMINI_IMAGE_MODELS = [
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image",
];

/** Nano Banana / Pro image models, in try order (override with GEMINI_IMAGE_MODEL_CHAIN for flash-first). */
function geminiImageModelChain() {
  const chainEnv = process.env.GEMINI_IMAGE_MODEL_CHAIN?.trim();
  if (chainEnv) {
    return chainEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const single = process.env.GEMINI_IMAGE_MODEL?.trim();
  if (single) {
    const rest = DEFAULT_GEMINI_IMAGE_MODELS.filter((m) => m !== single);
    return [single, ...rest];
  }
  return [...DEFAULT_GEMINI_IMAGE_MODELS];
}

function extractGeminiImageBase64(json) {
  const c = json?.candidates?.[0];
  const parts = c?.content?.parts;
  if (!Array.isArray(parts)) {
    const block = json?.promptFeedback || json?.error;
    throw new Error(
      `Gemini response missing image parts: ${JSON.stringify(block || json).slice(0, 500)}`,
    );
  }
  for (const part of parts) {
    const inline = part?.inlineData || part?.inline_data;
    const data = inline?.data;
    if (data && typeof data === "string") return data;
  }
  throw new Error(`Gemini returned no inline image data in parts: ${JSON.stringify(parts).slice(0, 400)}`);
}

/** Allowed aspect strings per https://ai.google.dev/gemini-api/docs/image-generation */
function geminiImageAspectRatio() {
  const r = process.env.GEMINI_IMAGE_ASPECT_RATIO?.trim();
  if (r && /^\d+:\d+$/.test(r)) return r;
  return "16:9";
}

/** 512, 1K, 2K, 4K — only sent for Gemini 3.x image models (not 2.5 flash). */
function geminiImageSizeToken() {
  const s = (process.env.GEMINI_IMAGE_SIZE || "2K").trim().toUpperCase();
  const allowed = new Set(["512", "1K", "2K", "4K"]);
  if (allowed.has(s)) return s;
  return "2K";
}

/**
 * REST `generationConfig` for image models: use `imageConfig` + `responseModalities`
 * (Generative Language API — `responseFormat` is not a valid field on this endpoint).
 * @see https://ai.google.dev/gemini-api/docs/image-generation
 */
function buildGeminiGenerationConfig(model) {
  const aspectRatio = geminiImageAspectRatio();
  const is25Flash = model.includes("gemini-2.5-flash-image");
  const imageConfig = { aspectRatio };
  if (!is25Flash) {
    imageConfig.imageSize = geminiImageSizeToken();
  }
  return {
    responseModalities: ["TEXT", "IMAGE"],
    imageConfig,
  };
}

function geminiTimeoutMs() {
  const n = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 15000) return Math.min(n, 600000);
  return 180000;
}

function geminiTransientMaxAttempts() {
  const n = Number(process.env.GEMINI_TRANSIENT_RETRIES);
  if (Number.isFinite(n) && n >= 1) return Math.min(Math.floor(n), 12);
  return 5;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Max concurrent generate+upload jobs (multiple “Gemini clients” in flight). */
function parallelImageConcurrency() {
  const raw = process.env.GEMINI_PARALLEL ?? process.env.BLOG_IMAGES_PARALLEL;
  const n = raw !== undefined && raw !== "" ? Number(raw) : 4;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), 12);
}

function parallelStaggerMs() {
  const n = Number(process.env.GEMINI_PARALLEL_STAGGER_MS);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 10_000);
}

/**
 * Run async fn(item, index) for each item with at most `limit` in flight.
 * Results array matches item order.
 */
async function parallelMap(items, limit, fn) {
  const n = items.length;
  if (n === 0) return [];
  const results = new Array(n);
  let next = 0;
  const workers = Math.min(Math.max(1, limit), n);
  const stagger = parallelStaggerMs();

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= n) return;
      if (stagger > 0) await sleep(i * stagger);
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function isTransientGeminiOverload(res, json) {
  if ([503, 504, 429].includes(res.status)) return true;
  const st = String(json?.error?.status || "");
  return st === "UNAVAILABLE" || st === "RESOURCE_EXHAUSTED";
}

function shouldTryNextGeminiKey(res, json) {
  if ([429, 401, 403].includes(res.status)) return true;
  if (res.status === 400) {
    const msg = String(json?.error?.message || "").toLowerCase();
    const reasons = Array.isArray(json?.error?.details)
      ? json.error.details.map((d) => d?.reason).filter(Boolean)
      : [];
    if (reasons.includes("API_KEY_INVALID")) return true;
    if (msg.includes("api key not valid") || msg.includes("invalid api key")) return true;
  }
  return false;
}

/** One Nano Banana model: all keys × transient retries. Returns base64 or throws. */
async function geminiGenerateImageWithModel(model, prompt, keys) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const timeoutMs = geminiTimeoutMs();
  const maxAttempts = geminiTransientMaxAttempts();

  const extra = process.env.GEMINI_IMAGE_EXTRA_INSTRUCTION?.trim();
  const instruction = [
    "Generate exactly one image for a technical blog audience.",
    "Follow the brief below as literally as possible: composition (left/center/right, panels, flow), objects and metaphors, palette, and constraints like “no text” or “labels only where specified”.",
    "Include every concrete element the brief names (tools, services, shapes, metaphors) in recognizable form — do not replace the scene with unrelated generic stock art or a different metaphor.",
    "Output an image (not only a text description).",
    ...(extra ? ["", extra] : []),
    "",
    "Brief:",
    prompt,
  ].join("\n");

  const body = {
    contents: [
      {
        parts: [{ text: instruction }],
      },
    ],
    generationConfig: buildGeminiGenerationConfig(model),
  };

  let lastMsg = "";

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.error(
        `  Gemini ${model} — key ${i + 1}/${keys.length}, attempt ${attempt}/${maxAttempts} (timeout ${timeoutMs / 1000}s)…`,
      );
      const t0 = Date.now();
      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "x-goog-api-key": key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        const name = e?.name || "";
        if (name === "TimeoutError" || name === "AbortError") {
          throw new Error(
            `Gemini request timed out after ${timeoutMs}ms (model ${model}, key ${i + 1}/${keys.length}). Increase GEMINI_REQUEST_TIMEOUT_MS.`,
          );
        }
        throw e;
      }

      const json = await res.json().catch(() => ({}));
      const elapsed = Date.now() - t0;
      if (res.ok) {
        console.error(`  Gemini OK in ${elapsed}ms (${model})`);
        return extractGeminiImageBase64(json);
      }

      lastMsg = `Gemini generateContent error ${res.status}: ${JSON.stringify(json).slice(0, 800)}`;

      if (isTransientGeminiOverload(res, json) && attempt < maxAttempts) {
        const backoff = Math.min(45000, 2000 * 2 ** (attempt - 1));
        const hint = json?.error?.message ? String(json.error.message).slice(0, 100) : res.status;
        console.error(`  ${res.status} (${hint}) — waiting ${backoff}ms before retry…`);
        await sleep(backoff);
        continue;
      }

      const tryNext = shouldTryNextGeminiKey(res, json) && i < keys.length - 1;
      if (tryNext) {
        console.error(`  API key ${i + 1}/${keys.length} failed (${res.status}), trying next key…`);
        await sleep(600);
        break;
      }

      let msg = lastMsg;
      if (res.status === 429) {
        msg +=
          "\n\nHint: image models need quota on that key’s Google AI project (billing), or add another key with spare quota. See https://ai.google.dev/gemini-api/docs/rate-limits";
      }
      throw new Error(msg);
    }
  }

  throw new Error(lastMsg || `Gemini: all keys failed for model ${model}`);
}

async function geminiGenerateImage(prompt) {
  const keys = loadGeminiKeyCandidates();
  if (!keys.length) {
    throw new Error(
      "No Gemini API keys: set GEMINI_API_KEY, GEMINI_API_KEYS, or add one key per line to .googleAI-token (or .gemini-api-key).",
    );
  }

  const models = geminiImageModelChain();
  if (!models.length) {
    throw new Error("No Gemini image models configured (GEMINI_IMAGE_MODEL_CHAIN empty?).");
  }
  let lastErr = null;

  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    try {
      return await geminiGenerateImageWithModel(model, prompt, keys);
    } catch (e) {
      lastErr = e;
      const hasNext = mi < models.length - 1;
      if (hasNext) {
        console.error(
          `  Model ${model} did not produce an image — trying next Nano Banana model (${models[mi + 1]})…`,
        );
        await sleep(800);
        continue;
      }
      throw e;
    }
  }

  throw lastErr || new Error("Gemini image generation failed for all models.");
}

function parseAttrs(attrStr) {
  if (!attrStr?.trim()) return { role: "inline", id: null };
  const role = /role\s*=\s*["']?(cover|inline)["']?/i.exec(attrStr)?.[1]?.toLowerCase() ?? "inline";
  const id = /id\s*=\s*["']([^"']+)["']/i.exec(attrStr)?.[1] ?? null;
  return { role, id };
}

function collectRanges(content) {
  const wrapped = [];
  let m;
  WRAPPED_BLOCK.lastIndex = 0;
  while ((m = WRAPPED_BLOCK.exec(content)) !== null) {
    wrapped.push({
      start: m.index,
      end: m.index + m[0].length,
      full: m[0],
      attrs: m[1] ?? "",
      prompt: m[2].trim(),
      wrapped: true,
    });
  }

  const insideWrapped = (idx) => wrapped.some((w) => idx >= w.start && idx < w.end);

  const items = [...wrapped];
  BARE_PROMPT.lastIndex = 0;
  while ((m = BARE_PROMPT.exec(content)) !== null) {
    if (insideWrapped(m.index)) continue;
    items.push({
      start: m.index,
      end: m.index + m[0].length,
      full: m[0],
      attrs: "",
      prompt: m[1].trim(),
      wrapped: false,
    });
  }

  return items.sort((a, b) => a.start - b.start);
}

function isPlaceholderImage(line) {
  const v = line
    .replace(/^image:\s*/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
  return !v || v.startsWith("/images/blog/");
}

async function openaiGenerateImage(prompt) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is not set (required when IMAGE_GEN_PROVIDER is openai).");

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    signal: AbortSignal.timeout(180000),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: prompt.slice(0, 4000),
      n: 1,
      size: "1792x1024",
      quality: "standard",
      response_format: "url",
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI images error ${res.status}: ${t}`);
  }
  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error(`OpenAI response missing image URL: ${JSON.stringify(data)}`);
  const imgRes = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!imgRes.ok) throw new Error(`Failed to download OpenAI image: ${imgRes.status}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  return buf.toString("base64");
}

async function generateImageBase64(provider, prompt) {
  if (provider === "gemini") return geminiGenerateImage(prompt);
  if (provider === "openai") return openaiGenerateImage(prompt);
  throw new Error(`Unknown IMAGE_GEN_PROVIDER: ${provider}`);
}

async function imgbbUpload(base64, name) {
  const key = loadImgbbKey();
  if (!key) throw new Error("ImgBB key missing: set IMGBB_API_KEY or create .imgbb-token in repo root.");

  const body = new URLSearchParams();
  body.set("key", key);
  body.set("image", base64);
  if (name) body.set("name", String(name).slice(0, 32).replace(/[^a-z0-9-_]/gi, "-"));

  const res = await fetch("https://api.imgbb.com/1/upload", {
    method: "POST",
    body,
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`ImgBB upload error ${res.status}: ${t}`);
  }
  const json = await res.json();
  if (!json.success) {
    throw new Error(`ImgBB error: ${JSON.stringify(json)}`);
  }
  return json.data.url;
}

function altFromPrompt(prompt) {
  const one = prompt.replace(/\s+/g, " ").trim();
  return one.length > 120 ? `${one.slice(0, 117)}...` : one;
}

function blogImagesArchivePrompts() {
  const v = (process.env.BLOG_IMAGES_ARCHIVE_PROMPTS ?? "1").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

/** One-line HTML comment; prompt in base64url so `--` / `-->` in text cannot break the DOM. */
function imagePromptArchiveComment(prompt, { index, role, id }) {
  if (!blogImagesArchivePrompts()) return "";
  let b64;
  try {
    b64 = Buffer.from(prompt, "utf8").toString("base64url");
  } catch {
    b64 = Buffer.from(prompt, "utf8").toString("base64");
  }
  const bits = [`index=${index + 1}`];
  if (role && role !== "inline") bits.push(`role=${role}`);
  if (id) bits.push(`id=${encodeURIComponent(id)}`);
  return `<!-- image_prompt:archive ${bits.join(" ")} b64=${b64} -->\n`;
}

function markdownFigureFromResult(it, i, url) {
  const { role, id } = parseAttrs(it.attrs);
  const alt = altFromPrompt(it.prompt);
  const comment = imagePromptArchiveComment(it.prompt, { index: i, role, id });
  return `${comment}![${alt}](${url})`;
}

function patchFrontMatterImage(markdown, url) {
  const re = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
  const m = re.exec(markdown);
  if (!m) return markdown;
  const inner = m[1];
  const lines = inner.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.startsWith("image:"));
  if (idx === -1) return markdown;
  if (!isPlaceholderImage(lines[idx])) return markdown;
  lines[idx] = `image: "${url}"`;
  const newInner = lines.join("\n");
  return markdown.slice(0, m.index) + "---\n" + newInner + "\n---\n" + markdown.slice(m.index + m[0].length);
}

async function main() {
  const args = process.argv.slice(2);
  const runBackground = args.includes("--background");
  const worker = process.env.BLOG_IMAGES_WORKER === "1";

  if (runBackground && !worker) {
    const filtered = args.filter((a) => a !== "--background");
    const logPath = resolve(REPO_ROOT, "scripts/blog-images-resolve.log");
    const scriptPath = fileURLToPath(import.meta.url);
    const fd = openSync(logPath, "a");
    writeSync(
      fd,
      `\n=== ${new Date().toISOString()} blog:images ${filtered.map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(" ")} ===\n`,
    );
    const child = spawn(process.execPath, [scriptPath, ...filtered], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, BLOG_IMAGES_WORKER: "1" },
    });
    child.unref();
    closeSync(fd);
    console.log(`Background job started.\nLog file: ${logPath}\n  tail -f ${logPath}`);
    process.exit(0);
  }

  const dryRun = args.includes("--dry-run");
  const useFirstAsCover = args.includes("--use-first-as-cover");
  const fileArg = args.find((a) => !a.startsWith("--"));

  if (!fileArg) {
    console.error(
      "Usage: node scripts/imgbb-resolve-prompts.mjs <post.md> [--dry-run] [--use-first-as-cover] [--background]",
    );
    process.exit(1);
  }

  const filePath = resolve(process.cwd(), fileArg);
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const raw = readFileSync(filePath, "utf8");
  const items = collectRanges(raw);
  const hasExplicitCoverMarker = items.some(
    (it) => it.wrapped && parseAttrs(it.attrs).role === "cover",
  );

  if (items.length === 0) {
    console.log("No [IMAGE_PROMPT: ...] markers found.");
    if (blogImagesArchivePrompts() && /\bimage_prompt:archive\b/.test(raw)) {
      console.log(
        "Hint: this file may already be resolved — look for `<!-- image_prompt:archive … b64=… -->` above each `![…](https://i.ibb.co/…)` figure.",
      );
    }
    process.exit(0);
  }

  let provider = null;
  if (!dryRun) {
    try {
      provider = resolveImageProvider();
    } catch (e) {
      console.error(e.message || e);
      process.exit(1);
    }
    if (!provider) {
      console.error(
        "No image API key found. For Gemini: GEMINI_API_KEY, GEMINI_API_KEYS, or multiple lines in .googleAI-token. For OpenAI: OPENAI_API_KEY. Optional: IMAGE_GEN_PROVIDER=gemini|openai|auto",
      );
      process.exit(1);
    }
  }

  console.log(`Found ${items.length} image prompt(s).${dryRun ? " (dry-run)" : ""}`);
  if (blogImagesArchivePrompts()) {
    console.error(
      "Archiving each original prompt in an HTML comment above the figure (BLOG_IMAGES_ARCHIVE_PROMPTS=0 to disable).",
    );
  }
  if (!dryRun && provider === "gemini") {
    console.log(
      `Generator: Gemini Nano Banana chain: ${geminiImageModelChain().join(" → ")} — https://ai.google.dev/gemini-api/docs/image-generation`,
    );
  } else if (!dryRun && provider === "openai") {
    console.log("Generator: OpenAI (dall-e-3)");
  }

  let coverUrl = null;
  let firstUploadedUrl = null;
  const replacements = [];

  if (dryRun) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const attrs = parseAttrs(it.attrs);
      const { role } = attrs;
      console.log(`\n[${i + 1}/${items.length}] ${it.wrapped ? `wrapped role=${role}` : "inline"}`);
      console.log(it.prompt.slice(0, 240) + (it.prompt.length > 240 ? "…" : ""));
      replacements.push({
        start: it.start,
        end: it.end,
        markdown: `${imagePromptArchiveComment(it.prompt, { index: i, role: attrs.role, id: attrs.id })}![${altFromPrompt(it.prompt)}](https://i.ibb.co/PLACEHOLDER/dry-run.png)`,
      });
      if (role === "cover") coverUrl = "https://i.ibb.co/PLACEHOLDER/dry-run.png";
    }
  } else {
    const conc = parallelImageConcurrency();
    if (conc > 1) {
      console.error(`Parallel image jobs: up to ${conc} at once (GEMINI_PARALLEL).`);
    }
    const slotResults = await parallelMap(items, conc, async (it, i) => {
      const { role, id } = parseAttrs(it.attrs);
      const slug = id ?? `img-${i + 1}`;
      console.error(
        `\n[${i + 1}/${items.length}] ${it.wrapped ? `wrapped role=${role}` : "inline"} (parallel)`,
      );
      console.error("  generating image bytes…");
      const b64 = await generateImageBase64(provider, it.prompt);
      console.error("  uploading to ImgBB…");
      const url = await imgbbUpload(b64, slug);
      console.log(`  → ${url}`);
      return {
        start: it.start,
        end: it.end,
        markdown: markdownFigureFromResult(it, i, url),
        role,
        index: i,
        url,
      };
    });

    for (const r of slotResults) {
      replacements.push({ start: r.start, end: r.end, markdown: r.markdown });
      if (r.role === "cover") coverUrl = r.url;
    }

    const byIndex = [...slotResults].sort((a, b) => a.index - b.index);
    if (byIndex.length) firstUploadedUrl = byIndex[0].url;
  }

  if (useFirstAsCover && firstUploadedUrl && !hasExplicitCoverMarker) {
    coverUrl = firstUploadedUrl;
  }

  replacements.sort((a, b) => b.start - a.start);
  let out = raw;
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.markdown + out.slice(r.end);
  }

  if (!dryRun && coverUrl) {
    out = patchFrontMatterImage(out, coverUrl);
  }

  if (!dryRun) writeFileSync(filePath, out, "utf8");
  if (dryRun) console.log("\nDry-run: file not modified.");
  else console.log(`\nUpdated: ${filePath}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
