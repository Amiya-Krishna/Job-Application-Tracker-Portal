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
// dangerouslySetInnerHTML), so a full parser would be overkill. Block-level
// tags are converted to newlines first so paragraphs/list items don't run
// together into one unreadable line once tags are stripped.
function stripHtml(html = "") {
  if (typeof html !== "string" || !html) return "";
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&rsquo;/gi, "\u2019")
    .replace(/&ldquo;/gi, "\u201c")
    .replace(/&rdquo;/gi, "\u201d")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = { normalize, tokenize, contentHash, titleSimilarity, stripHtml, STOPWORDS };
