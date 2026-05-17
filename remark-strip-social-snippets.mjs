/**
 * Remove author-only social copy from rendered markdown.
 * Keeps `<!-- SOCIAL SNIPPETS -->` and everything after it in the source file.
 */
const SOCIAL_SNIPPETS_RE = /SOCIAL\s+SNIPPETS/i;

export function remarkStripSocialSnippets() {
  return function (tree) {
    const { children } = tree;
    if (!children?.length) return;

    const cut = children.findIndex(
      (node) =>
        node.type === "html" &&
        typeof node.value === "string" &&
        SOCIAL_SNIPPETS_RE.test(node.value),
    );
    if (cut === -1) return;

    children.splice(cut);
  };
}
