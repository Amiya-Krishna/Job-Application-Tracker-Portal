// Remotive job discovery adapter for the dashboard-triggered scrape flow
// (server/services/jobDiscovery). Unlike linkedinJobsAdapter.js and
// indeedJobsAdapter.js, this one is genuinely functional with zero
// credentials: Remotive publishes a free, public, no-auth JSON API
// (https://remotive.com/api/remote-jobs), so this adapter can return real
// listings today instead of reporting "unavailable".
//
// Scope/limitation, stated honestly rather than hidden: Remotive only
// lists remote jobs. It is not a replacement for LinkedIn/Indeed search —
// it's an additional, real, no-auth source alongside them. If/when this
// app is registered as a LinkedIn Talent Solutions or Indeed partner, those
// adapters can be filled in independently; nothing here depends on that.

const { stripHtml } = require("../services/textUtils");

const REMOTIVE_API_URL = "https://remotive.com/api/remote-jobs";
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const REQUEST_TIMEOUT_MS = 10000;

const AVAILABLE = true; // no credentials required — public API

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Returns a valid Date, or null — never an Invalid Date object, which
// would otherwise get sent to the `postedAt` timestamptz column as-is.
function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapJob(job) {
  return {
    title: job.title,
    company: job.company_name,
    description: stripHtml(job.description || ""),
    // Nullable in the schema (jobs.location, tracked_jobs.location) — a
    // job Remotive didn't tag with a location gets null, not an invented
    // "Remote" placeholder. (Every Remotive listing is remote by
    // definition; that's reflected in `remoteType` below, not fabricated
    // into `location`.)
    location: job.candidate_required_location || null,
    // Remotive is remote-only by definition — every listing it returns is
    // remote. "remote" matches the value already used elsewhere in this
    // app for this column (see docs/API_ENDPOINTS.md's ingest example and
    // client/src/pages/MatchedJobs.jsx's rendering of `remote_type`).
    remoteType: "remote",
    sourceUrl: job.url,
    externalJobId: String(job.id),
    postedAt: parseDate(job.publication_date),
  };
}

// `location` is part of the shared discover({ query, location, limit })
// interface every adapter receives (see jobDiscovery/index.js), but this
// adapter doesn't filter on it: Remotive's `candidate_required_location` is
// free text, not structured data, and no other adapter in this codebase
// implements location filtering — inventing filtering semantics here that
// don't exist anywhere else in the Job Discovery contract would risk
// silently discarding real, valid Remotive results. The parameter is
// accepted for interface compatibility only.
async function discover({ query, limit }) {
  const parsedLimit = Math.min(
    Math.max(Number(limit) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  // Remotive's search API doesn't require a `search` term (calling it with
  // none just returns its general remote-jobs feed) — the same as
  // linkedin/indeed's discover() doesn't itself require a non-empty query.
  // The real enforcement point for "a query is required" is
  // server/routes/scrapeRoutes.js, which already rejects an empty query
  // before any adapter is ever called; re-validating it here would be
  // inventing a restriction Remotive's own API doesn't have.
  const trimmedQuery = query && String(query).trim() ? String(query).trim() : null;
  const params = new URLSearchParams({ limit: String(parsedLimit) });
  if (trimmedQuery) params.set("search", trimmedQuery);
  const url = `${REMOTIVE_API_URL}?${params.toString()}`;

  let response;
  try {
    response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
  } catch (err) {
    const timedOut = err.name === "AbortError";
    return {
      source: "remotive",
      status: "error",
      message: timedOut
        ? `Remotive API request timed out after ${REQUEST_TIMEOUT_MS}ms.`
        : `Remotive API request failed: ${err.message}`,
      jobs: [],
    };
  }

  if (!response.ok) {
    return {
      source: "remotive",
      status: "error",
      message: `Remotive API returned ${response.status} ${response.statusText}.`,
      jobs: [],
    };
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    return {
      source: "remotive",
      status: "error",
      message: `Failed to parse Remotive API response: ${err.message}`,
      jobs: [],
    };
  }

  // A response that parses as JSON but isn't shaped the way this adapter
  // expects (missing/non-array `jobs`) is a malformed/unexpected response,
  // not "zero real results" — reporting it as `status: "ok"` would hide a
  // real provider failure behind an innocent-looking empty search.
  if (!Array.isArray(data?.jobs)) {
    return {
      source: "remotive",
      status: "error",
      message: "Remotive API response did not include the expected \"jobs\" array.",
      jobs: [],
    };
  }

  // Drop only genuinely incomplete records (never fabricate the missing
  // piece) — `description` is required here too, not just id/title/
  // company/url: jobs.description is NOT NULL in the schema, and an empty
  // description would also be silently unscoreable by the TF-IDF matcher.
  const jobs = data.jobs
    .filter(
      (j) =>
        j &&
        j.id != null &&
        j.title &&
        j.company_name &&
        j.url &&
        typeof j.description === "string" &&
        j.description.trim(),
    )
    .slice(0, parsedLimit)
    .map(mapJob);

  return {
    source: "remotive",
    status: "ok",
    message: null,
    jobs,
  };
}

module.exports = { name: "remotive", discover, AVAILABLE };
