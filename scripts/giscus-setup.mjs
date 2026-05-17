#!/usr/bin/env node
/**
 * Fetch Giscus repoId + categoryId via GitHub CLI and optionally patch src/lib/site.ts.
 *
 * Prerequisites:
 *   - gh auth login (account must have admin on the blog repo)
 *   - giscus GitHub App installed on the repo: https://github.com/apps/giscus
 *
 * Usage:
 *   npm run giscus:setup
 *   npm run giscus:setup -- --write
 *   GISCUS_REPO=owner/repo GISCUS_CATEGORY=General npm run giscus:setup -- --write
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = process.env.GISCUS_REPO ?? "OrenOren1/blog";
const CATEGORY = process.env.GISCUS_CATEGORY ?? "General";
const SITE_TS = resolve("src/lib/site.ts");
const WRITE = process.argv.includes("--write");

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

function fail(msg) {
  console.error(`giscus-setup: ${msg}`);
  process.exit(1);
}

try {
  gh(["--version"]);
} catch {
  fail("install GitHub CLI: https://cli.github.com/");
}

try {
  gh(["auth", "status"]);
} catch {
  fail("run: gh auth login  (use an account with admin on the blog repo)");
}

const [owner, name] = REPO.split("/");
if (!owner || !name) fail(`invalid GISCUS_REPO: ${REPO}`);

console.log(`Repo: ${REPO}  Category: ${CATEGORY}`);

const before = JSON.parse(gh(["api", `repos/${REPO}`, "--jq", "{has_discussions, node_id}"]));
if (!before.has_discussions) {
  console.log("Enabling GitHub Discussions…");
  gh(["api", `repos/${REPO}`, "-X", "PATCH", "-f", "has_discussions=true"]);
} else {
  console.log("GitHub Discussions already enabled.");
}

const repoId = gh(["api", `repos/${REPO}`, "--jq", ".node_id"]);

const gql = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    discussionCategories(first: 20) {
      nodes { id name }
    }
  }
}`;

const gqlOut = JSON.parse(
  gh(["api", "graphql", "-f", `query=${gql}`, "-f", `owner=${owner}`, "-f", `name=${name}`]),
);

const categories = gqlOut?.data?.repository?.discussionCategories?.nodes ?? [];
const match =
  categories.find((c) => c.name.toLowerCase() === CATEGORY.toLowerCase()) ??
  categories.find((c) => c.name === "General");

if (!match) {
  console.error("Available categories:", categories.map((c) => c.name).join(", ") || "(none)");
  fail(`category not found: ${CATEGORY}`);
}

const categoryId = match.id;
const categoryName = match.name;

console.log("\nGiscus IDs (paste into src/lib/site.ts → giscus):\n");
console.log(`  repo:       ${REPO}`);
console.log(`  repoId:     ${repoId}`);
console.log(`  category:   ${categoryName}`);
console.log(`  categoryId: ${categoryId}`);
const giscusInstallUrl = "https://github.com/apps/giscus/installations/new";
console.log("\nInstall giscus (browser — cannot be done via gh):");
console.log(`  ${giscusInstallUrl}`);
console.log(`  → Choose account: ${owner}`);
console.log(`  → Repository access: Only select repositories → ${name}\n`);

if (WRITE) {
  let src = readFileSync(SITE_TS, "utf8");
  src = src.replace(/repoId:\s*"[^"]*"/, `repoId: "${repoId}"`);
  src = src.replace(/category:\s*"[^"]*"/, `category: "${categoryName}"`);
  src = src.replace(/categoryId:\s*"[^"]*"/, `categoryId: "${categoryId}"`);
  writeFileSync(SITE_TS, src);
  console.log(`Updated ${SITE_TS}`);
} else {
  console.log("To write these into site.ts automatically, run:");
  console.log("  npm run giscus:setup -- --write\n");
}
