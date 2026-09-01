/**
 * The page body format.
 *
 * Merchant-authored page bodies are stored as text and rendered as a small,
 * fixed set of blocks:
 *
 *   ## Heading          a subheading
 *   - item              a list item (consecutive lines form one list)
 *   anything else       a paragraph (blank line separates)
 *
 * ── Why not HTML, and why not Markdown ───────────────────────────────────────
 *
 * Storing HTML and rendering it is stored cross-site scripting with extra
 * steps: anyone who can edit a page — a junior staff account, or anyone who
 * gets hold of one — can run script in every visitor's browser. Sanitising it
 * afterwards means shipping and maintaining a sanitiser, and the ones that are
 * safe are large.
 *
 * A Markdown library would be the same argument in a smaller package, plus a
 * dependency and a parser whose edge cases are somebody else's decision.
 *
 * This format has no way to express a link target, an attribute or a tag, so
 * there is nothing to escape and no sanitiser to keep correct. React escapes
 * the text content by construction. The cost is that a merchant cannot put a
 * link in the middle of a sentence, which is a real limitation and a fair
 * trade for a shop's About page.
 */

export type PageBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

export function parsePageBody(body: string | null | undefined): PageBlock[] {
  if (!body) return [];

  const blocks: PageBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
    if (list.length > 0) {
      blocks.push({ kind: "list", items: list });
      list = [];
    }
  };

  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();

    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("## ")) {
      flush();
      blocks.push({ kind: "heading", text: line.slice(3).trim() });
      continue;
    }
    if (line.startsWith("- ")) {
      // A list interrupts a paragraph, so the paragraph is closed first.
      if (paragraph.length > 0) flush();
      list.push(line.slice(2).trim());
      continue;
    }
    if (list.length > 0) flush();
    paragraph.push(line);
  }

  flush();
  return blocks;
}
