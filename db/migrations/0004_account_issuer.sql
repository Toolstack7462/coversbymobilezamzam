-- Better Auth 1.7 scopes account identity by issuer and treats `issuer` as a
-- REQUIRED field on the account table. Ours did not have it, so every call to
-- signUpEmail threw before writing anything:
--
--   The field "issuer" does not exist in the "account" Drizzle schema.
--
-- The practical consequence was that INSTALLATION COULD NEVER COMPLETE. The
-- setup page reported only "Impossibile creare l'account", which is the right
-- message for a merchant and gave no clue to anyone debugging it. Found by the
-- first browser test that tried to sign in.
--
-- Added with a default so the statement is safe against a populated table, then
-- backfilled from provider_id, which is the mapping Better Auth's own upgrade
-- guide prescribes for existing credential accounts. In practice this table is
-- empty everywhere, precisely because sign-up never worked.

ALTER TABLE `account` ADD COLUMN `issuer` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `account` SET `issuer` = `provider_id` WHERE `issuer` = '';--> statement-breakpoint

-- Identity is (issuer, accountId): the same account id from two different
-- issuers is two different people, and collapsing them would let one sign in
-- as the other.
CREATE INDEX `account_issuer_idx` ON `account` (`issuer`,`account_id`);
