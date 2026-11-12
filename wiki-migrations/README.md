# Wiki schema baseline

`0001_wiki.sql` preserves the owner's Cloudflare D1 schema export supplied in this chat, followed by the six genre seed values previously applied in the console. Definitions are unchanged; parent tables are ordered first. It recreates 12 application tables, seven explicit indexes and nine triggers. Cloudflare's internal `_cf_KV` table is intentionally excluded.

## Target database

- Binding: `WIKI_DB`
- Database: `futurefire-wiki`
- Database ID: `e74b07aa-b0d3-43f6-ab2b-e35f1d9f897e`
- This file is NOT for the main website's `DB` database.

## Existing production baseline

The owner already applied this schema manually. Do not run this initial migration against that populated schema: CREATE statements and genre seeds are intentionally not silently repeatable. A migration ledger was not included in the export. Before enabling automated wiki migrations, reconcile and record this existing baseline without replaying it. Later schema changes should be separate reviewed migrations.

Keep wiki migrations separate from `../migrations/`, which belongs to the main content database. Wrangler configuration has not been changed to activate this directory; deployment and migration execution are separate work.

## Recovery reference

Post-schema bookmark supplied by the owner on November 11, 2026 (America/Los_Angeles):

`00000003-00000010-00005121-3fa2f70d1d078164687ca8f88380e76e`

The same reference is in the existing `../ff-wiki-schema-recovery-bookmark-11-11-2026.txt`, which was preserved unchanged. A Time Travel bookmark is a time-limited recovery reference, not a permanent database backup. Check availability before any recovery; no restore is needed or was performed here.

Owner-reported checks: 12 tables, nine triggers, six genres, zero entries; quick_check returned OK; foreign_key_check completed without reported violations.

## Local verification

The migration was executed in an isolated in-memory SQLite database with foreign keys enabled. All exported schema definitions matched after recreation. Counts, quick_check and foreign_key_check passed. Artist-to-band membership and band-to-label affiliation were accepted; invalid detail types, invalid relationship inserts/updates and entry-type changes were rejected. Test entries were never saved to production or to this migration.

These checks verify local SQLite behavior, not a new live D1 deployment. Revision snapshots and updated_at maintenance still require application code. No wiki API, admin editor or public pages are implemented by this migration.
