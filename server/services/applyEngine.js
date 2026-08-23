const path = require("path");
const fs = require("fs");
const { selectAdapter } = require("../adapters");
const { allowApply, humanDelay } = require("./rateLimiter");
const { query } = require("../lib/prisma");

const SCREENSHOT_DIR = path.join(__dirname, "..", "screenshots");
if (!fs.existsSync(SCREENSHOT_DIR))
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const NAV_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

/**
 * Prepares (but never submits) an application. Fills known fields, stops at
 * the final submit button, and leaves the page/status ready for human review.
 *
 * @param {object} job - { id, sourceUrl }
 * @param {object} profile - { full_name, email, phone, resume_path, linkedin_url }
 * @param {import('playwright').BrowserContext} browserContext - a persistent,
 *   already-logged-in context (reused across runs; see workers/applyWorker.js)
 */
async function prepareApplication(job, profile, browserContext) {
  const allowed = await allowApply(job.sourceUrl);
  if (!allowed) {
    await setStatus(job.id, "rate_limited", {
      reason: "domain hourly cap reached",
    });
    return { status: "rate_limited" };
  }

  const page = await browserContext.newPage();
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      await page.goto(job.sourceUrl, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      break;
    } catch (err) {
      attempt += 1;
      if (attempt >= MAX_RETRIES) {
        await setStatus(job.id, "failed", {
          reason: `navigation timeout: ${err.message}`,
        });
        await page.close();
        return { status: "failed", reason: err.message };
      }
      await humanDelay(2000, 5000 * attempt); // exponential-ish backoff
    }
  }

  const adapter = selectAdapter(page.url());
  const fieldMap = await adapter.detectFields(page);

  const filled = [];
  const skipped = [];
  for (const [fieldKey, selector] of Object.entries(fieldMap)) {
    const value = profile[fieldKey];
    if (!value) {
      skipped.push(fieldKey);
      continue;
    }
    try {
      await humanDelay();
      if (fieldKey === "resume_upload") {
        await page.setInputFiles(selector, value); // value = local file path
      } else {
        await page.fill(selector, value);
      }
      filled.push(fieldKey);
    } catch (err) {
      console.warn(
        `[applyEngine] field fill failed (${fieldKey}):`,
        err.message,
      );
      skipped.push(fieldKey);
    }
  }

  if (await adapter.isCaptchaPresent(page)) {
    await setStatus(job.id, "needs_captcha", { filled, skipped });
    // Intentionally leave `page` open — the worker hands this session to the
    // dashboard's "solve manually" action instead of closing it.
    return { status: "needs_captcha", page, filled, skipped };
  }

  const screenshotPath = path.join(SCREENSHOT_DIR, `job-${job.id}.png`);
  await page.screenshot({ path: screenshotPath });

  await setStatus(job.id, "pending_review", {
    filled,
    skipped,
    screenshotPath,
  });

  // Do NOT click submit. The user reviews `pending_review` applications in
  // the dashboard and confirms manually — see routes/applyRoutes.js
  // POST /api/applications/:id/submit.
  return { status: "pending_review", filled, skipped, screenshotPath, page };
}

async function setStatus(jobId, status, logExtra = {}) {
  // BUG FIX (P0 — apply worker JSONB failure): the VALUES() clause below
  // used to bind $3 with no cast at all — only the UPDATE branch's `||`
  // concatenation had an explicit `::jsonb` cast. $queryRawUnsafe sends
  // JS strings (JSON.stringify(logExtra) is always a string) as a plain
  // `text`-typed parameter unless the SQL tells Postgres otherwise, and
  // Postgres won't implicitly convert text -> jsonb on INSERT — hence
  // "column playwright_log is of type jsonb but expression is of type
  // text". Casting the VALUES-clause usage too (`$3::jsonb`) makes both
  // occurrences of the parameter explicitly jsonb, matching the column's
  // real type; `logExtra` (an array/object) is preserved as structured
  // JSON, not double-encoded or flattened to a bare string.
  // COALESCE guards a row created by applyRoutes.js's initial
  // `applications` upsert (POST /api/applications/:jobId creates the row
  // with only job_id/status — playwright_log starts out NULL there).
  // Postgres's jsonb `||` concatenation returns NULL if either side is
  // NULL, which would otherwise silently discard this update's log
  // entry instead of merging into it. Default is `'{}'::jsonb` (an empty
  // object), not an array — `logExtra` is always object-shaped here
  // ({reason}, {filled, skipped}, ...) and jsonb `||` between two
  // objects merges keys, which is the accumulating-fields behavior this
  // was written for; `'[]'::jsonb` would instead wrap each update as an
  // array element, changing that semantics.
  await query(
    `INSERT INTO applications (job_id, status, playwright_log, retry_count)
     VALUES ($1, $2, $3::jsonb, 0)
     ON CONFLICT (job_id) DO UPDATE
       SET status = $2,
           playwright_log = COALESCE(applications.playwright_log, '{}'::jsonb) || $3::jsonb,
           retry_count = CASE WHEN $2 = 'failed' THEN applications.retry_count + 1 ELSE applications.retry_count END`,
    [jobId, status, JSON.stringify(logExtra)],
  );
}

module.exports = { prepareApplication };
