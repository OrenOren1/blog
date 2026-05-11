import { getCollection, type CollectionEntry } from "astro:content";
import { SITE } from "./site";

export type Post = CollectionEntry<"blog">;

/** Published posts (not draft, not unlisted), newest first. */
export async function getPosts(): Promise<Post[]> {
  const all = await getCollection("blog", ({ data }) => !data.draft && !data.unlisted);
  return all.sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );
}

/** All non-draft posts including unlisted (for RSS admin, etc.). */
export async function getAllPostsIncludingUnlisted(): Promise<Post[]> {
  const all = await getCollection("blog", ({ data }) => !data.draft);
  return all.sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );
}

export async function getLatestPosts(n = SITE.latestCount): Promise<Post[]> {
  const all = await getPosts();
  // Exclude featured posts to prevent overlap with Featured section
  const nonFeatured = all.filter((p) => !p.data.featured);
  return nonFeatured.slice(0, n);
}

export async function getFeaturedPosts(n = SITE.featuredCount): Promise<Post[]> {
  const all = await getPosts();
  return all.filter((p) => p.data.featured).slice(0, n);
}

export async function getAllTags(): Promise<Map<string, number>> {
  const posts = await getPosts();
  const counts = new Map<string, number>();
  for (const p of posts) {
    for (const t of p.data.tags ?? []) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return counts;
}

export function postHref(post: Post): string {
  // Matches Hugo's blog/<slug> scheme so URL parity is preserved.
  return `/blog/${post.id}/`;
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
