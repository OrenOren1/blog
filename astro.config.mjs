import astroConsent from "astro-consent";
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import mdx from "@astrojs/mdx";
import { remarkReadingTime } from "./remark-reading-time.mjs";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const SITE = "https://orens.hagzag.com";

function getUnlistedUrls() {
  const blogDir = resolve("src/content/blog");
  const urls = new Set();
  function walk(dir, slugPrefix = "") {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, slugPrefix ? `${slugPrefix}/${entry}` : entry);
      } else if (entry.endsWith(".md") || entry.endsWith(".mdx")) {
        const raw = readFileSync(full, "utf8");
        const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch && /^unlisted:\s*true/m.test(fmMatch[1])) {
          const slug = entry.replace(/\.mdx?$/, "");
          const path = `${SITE}/blog/${slugPrefix ? slugPrefix + "/" : ""}${slug}`;
          urls.add(path);
          urls.add(path + "/");
        }
      }
    }
  }
  walk(blogDir);
  return urls;
}

const unlistedUrls = getUnlistedUrls();

export default defineConfig({
  site: SITE,
  trailingSlash: "always",
  prefetch: {
    prefetchAll: false,
  },
  integrations: [
    astroConsent({
      siteName: "orens.hagzag.com",
      headline: "",
      description: "This site uses minimal cookies for YouTube embeds. No tracking or ads.",
      acceptLabel: "Accept",
      rejectLabel: "Dismiss",
      cookiePolicyUrl: "/cookie-policy",
      privacyPolicyUrl: "/privacy",
      displayUntilIdle: false,
      displayIdleDelayMs: 0,
      consent: {
        days: 365,
        storageKey: "oren-blog-consent"
      }
    }),
    mdx(),
    sitemap({
      filter: (page) => !unlistedUrls.has(page),
    })
  ],
  markdown: {
    remarkPlugins: [remarkReadingTime],
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark-dimmed",
      },
      defaultColor: false,
      wrap: true,
    },
  },
});