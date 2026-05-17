/**
 * Central site metadata. Change once, reflect everywhere.
 */
/** GitHub repo for blog source + Giscus (owner/repo) */
const BLOG_GITHUB_REPO = "OrenOren1/blog" as const;

export const SITE = {
  title: "Oren Sultan",
  author: "Oren Sultan",
  /** Homepage hero line under the name */
  role: "DevOps & Platform Engineer",
  description:
    "DevOps & Platform Engineer | Kubernetes, GitOps, AI/ML Integration — by Oren Sultan.",
  url: "https://orens.hagzag.com",
  locale: "en",
  postsPerPage: 10,
  latestCount: 12,
  featuredCount: 3,
  social: {
    github: "https://github.com/orenoren1",
    gitlab: "https://gitlab.com/placeholder",
    medium: "https://medium.com/@orensito1",
    linkedin: "https://www.linkedin.com/in/oren-sultan-0527bab6/",
    email: "orensu1210@gmail.com",
    rss: "/rss.xml",
  },
  /** `owner/repo` for GitHub “edit this page” links (blog source) */
  contentGithubRepo: BLOG_GITHUB_REPO,
  giscus: {
    repo: BLOG_GITHUB_REPO,
    /** From https://api.github.com/repos/OrenOren1/blog → node_id (or giscus.app) */
    repoId: "R_kgDOSaYjKA",
    /** Discussion category for post comments — enable Discussions on the repo, then set categoryId from giscus.app */
    category: "General",
    categoryId: "DIC_kwDOSaYjKM4C9Q8U",
    mapping: "pathname",
    reactionsEnabled: "1",
    emitMetadata: "0",
    inputPosition: "bottom",
    theme: "transparent_dark",
    lang: "en",
  },
};

export type SiteConfig = typeof SITE;