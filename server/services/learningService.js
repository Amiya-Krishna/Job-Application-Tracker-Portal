// BUG FIX: this imported `query` from `@prisma/client`, which has no such
// export — it was always `undefined`, so every call in this file threw
// "query is not a function" the moment an outcome with a learning signal
// (interview/offer/rejected) was recorded, breaking POST
// /api/applications/:id/outcome for those statuses. `../lib/prisma`
// exports the correctly wrapped `$queryRawUnsafe`-based `query` helper
// (see its own header comment for why) — use that instead.
const { query } = require("../lib/prisma");

const OUTCOME_WEIGHTS = {
  interview: 0.05,
  offer: 0.1,
  rejected: -0.02,
};

const MIN_WEIGHT = 0.1;
const MAX_WEIGHT = 3.0;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Call after an application's outcome is recorded (interview/offer/rejected).
 * Nudges the profile's per-skill weights so future TF-IDF scoring favors
 * skills that have historically led to interviews/offers.
 */
async function updateWeightsFromOutcome(jobId, outcome) {
  const delta = OUTCOME_WEIGHTS[outcome];
  if (delta === undefined) return; // no-op for statuses that aren't a learning signal

  const { rows } = await query(
    `SELECT ms.explanation, ms.profile_id
     FROM match_scores ms
     WHERE ms.job_id = $1 AND ms.method = 'tfidf'
     LIMIT 1`,
    [jobId],
  );
  if (!rows.length) return;

  const { explanation, profile_id: profileId } = rows[0];
  const matchedSkills = explanation?.matched_skills || [];
  if (!matchedSkills.length) return;

  const { rows: profileRows } = await query(
    "SELECT skill_weights FROM user_profile WHERE id = $1",
    [profileId],
  );
  const weights = profileRows[0]?.skill_weights || {};

  for (const skill of matchedSkills) {
    const current = weights[skill] ?? 1.0;
    weights[skill] = clamp(current + delta, MIN_WEIGHT, MAX_WEIGHT);
  }

  // BUG FIX (same JSONB-cast class as match_scores.explanation /
  // applications.playwright_log): skill_weights is a `jsonb` column
  // (schema.prisma: user_profile.skill_weights Json), but $1 had no
  // cast — $queryRawUnsafe binds JSON.stringify(weights) as plain
  // `text`, which Postgres refuses to implicitly store into a jsonb
  // column ("column skill_weights is of type jsonb but expression is of
  // type text"). This path wasn't in the reported runtime logs yet, but
  // it's the identical bug and would fail the instant an
  // interview/offer/rejected outcome with matched skills is recorded.
  await query(
    "UPDATE user_profile SET skill_weights = $1::jsonb, updated_at = now() WHERE id = $2",
    [JSON.stringify(weights), profileId],
  );

  return weights;
}

module.exports = { updateWeightsFromOutcome, OUTCOME_WEIGHTS };
