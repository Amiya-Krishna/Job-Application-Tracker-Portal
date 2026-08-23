-- BUG FIX: "Apply" on an Engine/Matched Job (POST /api/applications/:jobId)
-- only ever wrote to the global `applications` table, never to
-- `tracked_jobs` — since Applied Jobs (appliedJobsService.js) is built
-- entirely off the user's own `tracked_jobs` rows, the applied job never
-- showed up there. The application-layer fix (server/routes/applyRoutes.js)
-- now find-or-creates a `tracked_jobs` row owned by the applying user with
-- `engine_job_id` pointing at the job, so it needs a uniqueness guarantee
-- on (user_id, engine_job_id) to stay idempotent (repeated Apply clicks
-- must update the existing row, never create a second one).
--
-- This has NOT been applied against a live database from this sandbox —
-- outbound network access to binaries.prisma.sh (required for
-- `prisma migrate dev`/`generate` to fetch the query/schema engine) is
-- blocked here (403 Forbidden), and no Postgres instance is reachable
-- either. This file was authored by hand to match schema.prisma exactly,
-- follows the same guarded/idempotent style as the prior
-- 20260820000000_engine_bridge_scrape_runs_and_user_scoped_profile
-- migration, and is purely additive — no column is dropped, no existing
-- row is altered except the defensive de-dup step below (which only
-- removes rows that are exact (user_id, engine_job_id) duplicates of a
-- row that is kept). Apply with:
--
--   npx prisma migrate deploy
--
-- (or `npx prisma migrate resolve --applied ...` if the equivalent DDL
-- was already applied by hand).

-- ============================================================
-- 1. De-dup guard: if this database already has more than one
--    tracked_jobs row for the same (user_id, engine_job_id) pair — e.g.
--    from testing the pre-fix "Apply" flow, or any other path that
--    inserted more than one — collapse them to the earliest row before
--    the unique constraint is added, so the ALTER TABLE below can never
--    fail against real data. Only rows with a non-null engine_job_id are
--    touched; manual jobs (engine_job_id IS NULL) are left completely
--    alone, since NULL is exempt from the uniqueness check anyway.
-- ============================================================
DELETE FROM "tracked_jobs" t1
USING "tracked_jobs" t2
WHERE t1.user_id = t2.user_id
  AND t1.engine_job_id = t2.engine_job_id
  AND t1.engine_job_id IS NOT NULL
  AND t1.id > t2.id;

-- ============================================================
-- 2. Add the uniqueness constraint (guarded so re-running this file,
--    or running it against a database that already has an equivalent
--    constraint from a partially-applied previous attempt, is safe).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_tracked_jobs_user_engine_job'
  ) THEN
    ALTER TABLE "tracked_jobs"
      ADD CONSTRAINT "uq_tracked_jobs_user_engine_job" UNIQUE ("user_id", "engine_job_id");
  END IF;
END $$;
