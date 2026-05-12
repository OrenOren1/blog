/**
 * Central site metadata. Change once, reflect everywhere.
 */
export const SITE = {
  title: "Oren Sultan",
  author: "Oren Sultan",
  /** Homepage hero line under the name */
  role: "DevOps & Platform Engineer",
  /** Homepage hero paragraph (meta description stays separate for SEO snippets) */
  heroLead:
    "Practitioner notes on Kubernetes, GitOps, AI/ML integration, and building enterprise platforms.",
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
  giscus: {
    repo: "hagzag/orens-portfolio" as const,
    repoId: "",
    category: "Announcements",
    categoryId: "",
    mapping: "pathname",
    reactionsEnabled: "1",
    emitMetadata: "0",
    inputPosition: "bottom",
    theme: "transparent_dark",
    lang: "en",
  },
};

export type SiteConfig = typeof SITE;