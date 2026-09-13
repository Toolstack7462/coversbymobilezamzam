-- The migration ledger.
--
-- Numbered 0000 so it is applied before anything it has to record.
--
-- ── WHY THIS EXISTS RATHER THAN WRANGLER'S TABLE ────────────────────────────
--
-- D1 keeps `d1_migrations`, written by Wrangler. Nothing writes it on MariaDB,
-- and the health check read it — so the first thing the ported application did
-- on a real MariaDB was report itself degraded because a Cloudflare bookkeeping
-- table was missing. The ledger has to belong to the target.
--
-- ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
--
-- Three things, and the third is the one that matters on shared hosting:
--
--   1. `hostinger:migrate` applies only files not already recorded here, so
--      running it twice is safe and running it after a partial failure resumes.
--   2. `/api/health` reports the applied schema version, so "is the deployed
--      code running against the schema it expects?" is a question with an
--      answer rather than an assumption.
--   3. `applied_by` and `checksum` make an out-of-band change visible. On
--      managed hosting somebody can and eventually will run a statement in
--      phpMyAdmin; a ledger that records what the tooling applied is how that
--      shows up as a mismatch rather than as a mystery six months later.

CREATE TABLE IF NOT EXISTS `schema_migrations` (
  -- The filename, which is also the ordering. Not an auto-increment: two
  -- environments must agree on what "0003" means, and a surrogate key invented
  -- per database does not.
  `name` VARCHAR(255) NOT NULL,

  -- SHA-256 of the file as applied. A migration edited after being applied is
  -- a different migration, and this is what says so.
  `checksum` VARCHAR(64) NOT NULL,

  `applied_at` BIGINT NOT NULL,
  `applied_by` VARCHAR(255) NOT NULL,
  `duration_ms` INT NOT NULL,
  `statements` INT NOT NULL,

  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
