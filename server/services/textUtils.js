const crypto = require("crypto");
const natural = require("natural");

const STOPWORDS = new Set(natural.stopwords);

function normalize(str = "") {
  return str
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(str = "") {
  return normalize(str)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function contentHash({ title, company, description }) {
  const base = `${normalize(title)}|${normalize(company)}|${normalize(
    description
  ).slice(0, 500)}`;
  return crypto.createHash("sha256").update(base).digest("hex");
}

// Jaro-Winkler via `natural`'s implementation
function titleSimilarity(a, b) {
  return natural.JaroWinklerDistance(normalize(a), normalize(b), {});
}

// Strips HTML markup from third-party job descriptions (e.g. Remotive's API
// returns descriptions as an HTML fragment) before they're stored/ingested.
// Deliberately dependency-free (regex-based, not a DOM/HTML parser) — this
// app has no HTML sanitizer library installed and descriptions are only
// ever stored as plain text and read back as text (never rendered with
// dangerouslySetInnerHTML), so a full parser would be overkill.
//
// Order matters here, on purpose:
//   1. <script>/<style> CONTENT is removed first, not just the tags — a
//      plain tag-strip would delete "<script>" and "</script>" but leave
//      the JS source sitting in the middle of the plain-text description.
//   2. HTML comments are removed the same way.
//   3. Block-level tags become newlines before the generic tag-strip runs,
//      so paragraphs/list items don't collapse into one run-on line.
//   4. All remaining tags are stripped (pass 1).
//   5. Entities are decoded — with `&amp;` decoded LAST. Decoding it first
//      would let a double-encoded payload like
//      "&amp;lt;script&amp;gt;...&amp;lt;/script&amp;gt;" unmask one level
//      to "&lt;script&gt;...&lt;/script&gt;" and then get decoded AGAIN by
//      the &lt;/&gt; step into a literal, tag-shaped "<script>...</script>"
//      string. Decoding &amp; last means a double-encoded sequence only
//      ever resolves one level, landing on inert text ("&lt;script&gt;")
//      instead of resurrecting real angle brackets.
//   6. Tags are stripped a second time — any tag-shaped text that could
//      only have appeared as a result of decoding (i.e. it was encoded, not
//      literal, in the source) is removed rather than trusted, so the
//      final text can never contain something that looks like a live tag.
function stripHtml(html = "") {
  if (typeof html !== "string" || !html) return "";

  let text = html;

  // Remove <script>...</script> and <style>...</style> INCLUDING their
  // content, and HTML comments, before any generic tag-stripping.
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Turn block-level structure into whitespace before stripping tags, so
  // the plain text stays readable instead of running together.
  text = text.replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<li[^>]*>/gi, "- ");

  // Strip all remaining tags (pass 1).
  text = text.replace(/<[^>]*>/g, "");

  // Decode entities — &amp; last (see rationale above).
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&rsquo;/gi, "\u2019")
    .replace(/&ldquo;/gi, "\u201c")
    .replace(/&rdquo;/gi, "\u201d")
    .replace(/&amp;/gi, "&");

  // Strip tags a second time: catches anything tag-shaped that only exists
  // because it was HTML-encoded in the source (never trust decoded output
  // as safe to leave un-stripped).
  text = text.replace(/<[^>]*>/g, "");

  // Collapse whitespace left behind by tag/content removal.
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

module.exports = { normalize, tokenize, contentHash, titleSimilarity, stripHtml, STOPWORDS };
