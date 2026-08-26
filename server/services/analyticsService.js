const { query } = require("../lib/prisma");

// ----------------------------------------------------------------------
// ROOT CAUSE (see the accompanying report for the full trace):
//
// This used to compute every number here from the global `applications`
// table — the automated Apply Engine's OWN record, intentionally keyed
// 1:1 by job_id with NO user_id column at all (see the ownership note in
// applyRoutes.js — this is a deliberate design choice from the earlier
// multi-user audit, not an oversight). That means the old query here
// aggregated EVERY user's engine activity into one number, with zero
// scoping to whoever is actually looking at the dashboard — exactly the
// kind of multi-user leak the project's prior audit was supposed to have
// caught, just in a file that audit didn't touch.
//
// `TrackedJob` (`tracked_jobs`) is the table that IS already correctly
// user-owned (`user_id`, already audited, already the source of truth for
// the Applied Jobs page), and its `status` is kept in sync with the same
// engine outcomes via applyRoutes.js's POST /:id/outcome handler
// (`Applied` -> `Interview`/`Offer`/`Rejected`, Title-Case — NOT the
// lowercase values `applications.status` used). So this now sources
// everything from `tracked_jobs`, scoped by `user_id`, instead.
//
// CURRENT-STATUS LIMITATION (deliberate, not an oversight — see report):
// tracked_jobs has no stage-history table and no timestamp per stage,
// only a single current `status` string, and nothing in this codebase
// (schema or route validation) guarantees a strict Applied -> Interview
// -> Offer progression — POST /:id/outcome accepts a jump straight to
// "offer" with no check on the row's current status, and the
// AppliedJobs.jsx status dropdown lets a user pick any of the 4 values
// directly. So an application currently at "Offer" is NOT provably known
// to have ever been at "Interview". Inferring that anyway would be
// fabricating a transition the data doesn't actually contain (explicitly
// what this fix must not do). Every percentage below is therefore
// "share of tracked applications whose CURRENT status is X" — an
// undercount of true historical "ever reached X" if some rows have since
// progressed past that stage — and that trade-off is intentional and
// documented, not silently swept under the rug.
// ----------------------------------------------------------------------
const WINDOW_SQL = `
WITH scoped AS (
  SELECT status, application_date, updated_at
  FROM tracked_jobs
  WHERE user_id = $1
    AND application_date >= current_date - $2::int
)
SELECT
    count(*)::int AS total_applications,
    count(*) FILTER (WHERE status IN ('Interview', 'Offer', 'Rejected'))::int AS responses,
    count(*) FILTER (WHERE status = 'Interview')::int AS interviews,
    count(*) FILTER (WHERE status = 'Offer')::int AS offers,
    round(
      count(*) FILTER (WHERE status IN ('Interview', 'Offer', 'Rejected'))::numeric
      / NULLIF(count(*), 0) * 100,
      1
    ) AS response_rate_pct,
    round(
      count(*) FILTER (WHERE status = 'Interview')::numeric
      / NULLIF(count(*), 0) * 100,
      1
    ) AS applied_to_interview_pct,
    round(
      count(*) FILTER (WHERE status = 'Offer')::numeric
      / NULLIF(count(*) FILTER (WHERE status = 'Interview'), 0) * 100,
      1
    ) AS interview_to_offer_pct,
    round(
      count(*) FILTER (WHERE status = 'Offer')::numeric
      / NULLIF(count(*), 0) * 100,
      1
    ) AS applied_to_offer_pct
FROM scoped;
`;

async function getAnalyticsSummary(userId, rangeDays = 30) {
  const normalizedRange =
    Number.isInteger(rangeDays) && rangeDays > 0 ? rangeDays : 30;
  const { rows } = await query(WINDOW_SQL, [userId, normalizedRange]);
  const summary = rows[0] || {};

  return {
    rangeDays: normalizedRange,
    ...summary,
    // Not computed: tracked_jobs.updated_at is never explicitly set on a
    // status/outcome change anywhere in this codebase (no @updatedAt
    // directive, and neither applyRoutes.js's outcome handler nor
    // jobRoutes.js's manual-edit PUT touches it) — confirmed by grep, not
    // assumed. There is no other per-stage timestamp on this table. Using
    // it anyway would report a number that doesn't actually mean "time to
    // response" (it could reflect an unrelated notes edit, or just be
    // stale from row creation). Reporting `null` (rendered as "—" by the
    // existing frontend) is the honest choice, not a fabricated average.
    average_response_time_hours: null,
  };
}

module.exports = {
  getAnalyticsSummary,
  WINDOW_SQL,
};
