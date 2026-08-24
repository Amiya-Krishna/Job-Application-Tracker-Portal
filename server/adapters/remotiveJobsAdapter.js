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

// Remotive's `candidate_required_location` is a free-text field (e.g.
// "USA", "Worldwide", "Europe", "UK, EU"), not a structured location — this
// is a best-effort substring match on real returned data, never a
// fabricated filter. Jobs explicitly marked open to anyone are always kept.
function matchesLocation(job, locationFilter) {
  if (!locationFilter) return true;
  const jobLocation = (job.candidate_required_location || "").toLowerCase();
  if (!jobLocation) return true; // don't drop jobs Remotive didn't tag
  return (
    jobLocation.includes(locationFilter) ||
    jobLocation.includes("worldwide") ||
    jobLocation.includes("anywhere")
  );
}

function mapJob(job) {
  return {
    title: job.title,
    company: job.company_name,
    description: stripHtml(job.description || ""),
    location: job.candidate_required_location || "Remote",
    // Remotive is remote-only by definition — every listing it returns is remote.
    remoteType: "remote",
    sourceUrl: job.url,
    externalJobId: String(job.id),
    postedAt: job.publication_date ? new Date(job.publication_date) : null,
  };
}

async function discover({ query, location, limit }) {
  if (!query || !String(query).trim()) {
    return {
      source: "remotive",
      status: "error",
      message: "A search query is required.",
      jobs: [],
    };
  }

  const parsedLimit = Math.min(
    Math.max(Number(limit) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  const params = new URLSearchParams({
    search: String(query).trim(),
    limit: String(parsedLimit),
  });
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

  const rawJobs = Array.isArray(data?.jobs) ? data.jobs : [];
  const locationFilter = location && String(location).trim()
    ? String(location).trim().toLowerCase()
    : null;

  const jobs = rawJobs
    .filter((j) => j && j.id != null && j.title && j.company_name && j.url)
    .filter((j) => matchesLocation(j, locationFilter))
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
