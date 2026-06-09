#!/usr/bin/env node
// Run `install`, `build`, or `dev` across every deck workspace under
// presentations/. A deck workspace is any direct child with a package.json.
// Usage: node scripts/presentations.mjs <install|build|dev>

import { readdirSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PRES_ROOT = resolve(ROOT, "presentations");

const action = process.argv[2];
if (!action || !["install", "build", "dev"].includes(action)) {
  console.error("usage: presentations.mjs <install|build|dev>");
  process.exit(1);
}

if (!existsSync(PRES_ROOT)) {
  console.log(`• no presentations/ directory at ${PRES_ROOT} — skipping`);
  process.exit(0);
}

const decks = readdirSync(PRES_ROOT)
  .map((name) => resolve(PRES_ROOT, name))
  .filter((p) => {
    try { return statSync(p).isDirectory() && existsSync(resolve(p, "package.json")); }
    catch { return false; }
  });

if (decks.length === 0) {
  console.log("• no deck workspaces found — skipping");
  process.exit(0);
}

if (action === "dev" && decks.length > 1) {
  console.error("Multiple decks present — pick one explicitly:");
  for (const d of decks) console.error(`  npm --prefix ${d.replace(ROOT + "/", "")} run dev`);
  process.exit(2);
}

for (const deck of decks) {
  const label = deck.replace(ROOT + "/", "");
  console.log(`\n▶ ${action} :: ${label}`);
  const cmd = action === "install" ? ["install", "--no-audit", "--no-fund"] : ["run", action];
  const r = spawnSync("npm", cmd, { stdio: "inherit", cwd: deck });
  if (r.status !== 0) {
    console.error(`✘ ${label} failed (${action})`);
    process.exit(r.status ?? 1);
  }
}

console.log(`\n✔ ${action} complete for ${decks.length} deck${decks.length === 1 ? "" : "s"}`);
