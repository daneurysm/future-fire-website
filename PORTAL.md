# Future Fire control room

Visit `https://futurefire.club/admin` after deployment. The Wiki tab supports private draft editing; public wiki publishing is not included yet.

## First owner setup

From this project directory, run `node scripts/setup-admin.mjs --remote`. Open its private loopback link and choose your username and password. The link expires after 15 minutes; the server shuts down after success. Passwords are hashed on your computer and are never printed. The setup page is not deployed to the public website. It cannot overwrite an existing administrator. Alternatively, use the terminal-only `node scripts/create-admin.mjs --remote admin`.

Never paste your password into chat, source files, or shell arguments. There is intentionally no public registration or password-reset endpoint. Keep your credentials in your own password manager.

## Wiki overview

After signing in, Overview shows total wiki entries, counts by status and type, the five most recently updated drafts, and the ten latest saved revisions. Counts include the entire wiki, regardless of directory pagination. New artist opens a blank artist draft; Continue editing opens the selected draft in the existing Wiki tab. Dates display in the browser's local time. Publishing remains unavailable.

The read-only `/api/admin/wiki/overview` endpoint requires the existing administrator session and reads only `WIKI_DB`. No schema changes are needed.

## Editing

- News, Reviews, Weekly reports: Add new, enter a title and unique slug, write text, optionally choose an uploaded image, and save. New items default to draft. Select published and save to publish. Future publication dates stay hidden until due. Reviews additionally support artist, release, label, release date, rating, and a listening link.
- Images: Upload JPEG, PNG, GIF, or WebP files up to 10 MiB. Select an image to set alt text and credit. Choose it in an article or setting. Images attached only to drafts are private. Unused images remain in the private library; image deletion is intentionally not exposed yet.
- Tour dates: Artist, venue, location, ISO date/time with offset, timezone, tickets, description, and image. Only published dates appear publicly.
- Livestream: Direct HTTPS audio stream, show description, schedule, station information, artwork, and live/offline flag. Arbitrary embed HTML is not accepted.
- Page text: Headings, introductory text, and images for non-wiki sections. Empty fields fall back to the original site copy. Global heading and description edit the footer tagline and small print. Global eyebrow and image are reserved for later use.
- Social links: Edit Matrix networks, handles, HTTPS profile links, display order, and visibility.
- Password: Supply your current password and choose a replacement. All sessions are revoked after a successful change.

Text currently supports plain text and paragraph breaks, not rich-text/Markdown formatting or inline image galleries. Article slugs are unique editorial identifiers; individual shareable article pages are not implemented. The list loads the most recent 500 editorial articles and public feeds the most recent 100. Refresh the public website after saving to see changes. Deleting an article or tour date is permanent; use archived status when you want to keep it.

## Development and deployment

Use Node 22.13 or newer (tests use `node:sqlite`). Run `npm ci`, `npm run build`, `npm test`, then `npx wrangler d1 migrations apply futurefire-club-db --local` and `npm run dev` for local preview. Local content and accounts are separate from production. Use `node scripts/setup-admin.mjs --local` to create a local account.

For restoration, inspect existing migration records first; do not rerun migrations or administrator setup. Apply only separately reviewed, genuinely pending migrations when explicitly authorized. Deployment is a separate approval step. The existing Worker name, domain, and resource IDs must be preserved. No DNS changes are needed. The existing Cloudflare Git build uses the checked-in `dist/` bundle: always run `npm run build` before sharing source changes or deployment from Git. Direct deployments do not push local changes to GitHub.

Test coverage includes password salting, session cookie flags and revocation, same-origin enforcement, login throttling, draft/scheduled visibility, review metadata, URL validation, upload validation, private draft images, and one-time setup access checks. Local browser QA also exercises real Worker/D1 login, article creation, saving, and publishing. These checks are not a substitute for an independent security audit.

## Wiki draft editor

The Wiki tab uses the existing administrator session and the separate WIKI_DB binding. Create Artist, Band or Label drafts with biography/history, introduction, location, aliases, genre selections, HTTPS links and sources. Saved entries can be reopened; each successful save records a revision snapshot. Stale saves are rejected so another editor's changes are not silently overwritten. The directory searches names and slugs across the entire wiki, filters by Artist/Band/Label, and shows 25 entries per page. Click Search wiki or press Enter to search. Filtering and paging do not discard the open form. Artist drafts support optional activity start/end years (1000–9999); the end cannot precede the start. Sources expose optional access dates, and saves preserve source IDs and omitted access dates. Unidentifiable legacy source edits with existing dates require reopening the editor rather than silently dropping metadata.

This release is draft-only: publishing, archiving, relationships, band/label dates, revision restoration and public wiki pages are not implemented. Revision snapshots cover fields managed by this editor, including attached image metadata, but not relationships. The schema baseline and recovery reference are in wiki-migrations/README.md. Production already has that schema; do not replay its creation migration. No Wrangler binding or migration-directory changes are needed for this draft editor.

Original draft-editor validation (before Overview and activity-year editing): nine automated tests passed, including existing portal tests, wiki authentication/origin protection, draft round trips, revisions, stale saves, validation and atomic rollback. The frontend build and Wrangler deploy dry run pass with all four bindings. Browser QA against isolated in-memory SQLite databases verified login, creating a profile with alias/genre/link/source, saving and updating to a second revision. This is local QA, not a live Cloudflare verification.

## Artist editor API

`GET /api/admin/wiki?q=...&type=artist&page=1` returns `{items,total,page,page_size,pages}` (25 per page), replacing the old unpaginated array. `type` may be empty, `artist`, `band`, or `label`. Search matches name or slug, case-insensitively for ASCII, with percent and underscore treated literally. Out-of-range positive pages clamp to the last page. All routes retain existing administrator authentication.

Artist detail responses include nullable `active_from_year` and `active_to_year`. Saves preserve omitted year fields; explicit null clears them. Source responses include `id` and `accessed_on`; pass IDs back when editing existing sources. Explicit null or an empty access date clears it. Revision snapshots use `draft-editor-v3` and include activity years, source dates, and image metadata. Writes remain atomic and draft-only; no schema migration is required.

Local automated tests use all three wiki schema files in isolated in-memory databases. They cover pagination beyond 500 entries, filters, date validation/preservation, activity years, stale saves, and rollback. Do not apply these existing migrations to populated databases.

Artist-editor milestone verification: 16 automated tests passed. Browser QA against the real Worker handler backed by isolated in-memory SQLite verified pagination/search without losing unsaved year edits, saving/reopening activity years, and source access-date preservation. No live database writes, migrations, or deployment were performed.

## Wiki images

In a wiki draft, use Images to upload a JPEG, PNG, GIF, or WebP (up to 10 MiB) or choose from the latest 500 library items. Attach images, edit accessibility descriptions, captions, credits, HTTPS source URLs and rights notes, choose at most one primary image, and reorder with Move image up/down. Save draft commits these changes together with the profile and a revision snapshot. Removing an attachment only detaches it on save; it does not delete the library record or R2 object. Uploads persist in the library even if the draft is discarded or its save fails.

Uploads reuse authenticated `/api/admin/media`. New attachments send `media_id`; the server resolves its registered R2 key and verifies the file exists. Existing attachments send their entry-owned image `id`. Raw R2 keys cannot create attachments. An omitted `images` property preserves all existing attachments; an explicit empty array detaches them. Metadata omitted on retained images is preserved. Array order determines display order. Revisions include image metadata, not copies of image bytes.

`GET` and `HEAD /api/admin/wiki-images/:id` serve saved previews only to an authenticated administrator with no-store and nosniff headers. These routes remain private even for records marked published; public wiki publishing is still unavailable. Existing `/media/:id` rules are unchanged: an image also used by published non-wiki content can already be public there. Attaching it to a private wiki draft does not revoke that existing public use. Wiki captions and other draft metadata are not exposed by the public content feed.

Image milestone verification: all 21 local automated tests pass, including privacy for GET/HEAD, shared public media behavior, invalid references, duplicates, primary selection, upload limits, stale saves, atomic rollback, omitted-image preservation, and detachment without file deletion. Browser QA used the real Worker handler with isolated in-memory SQLite/R2 substitutes and verified library attachment, upload, metadata, primary choice, ordering, removal, saving and reopening. No saved local/production databases were changed and nothing was committed or deployed. No schema migration is required.

## Release-readiness verification — November 13, 2026

The combined Overview, Artist Editor, source-date preservation, and wiki-image changes passed all 21 automated tests, JavaScript syntax checks, and `git diff --check`. `npm run build` succeeded without changing the checked-in public bundle. `wrangler deploy --dry-run` packaged the Worker and 28 static assets with DB, WIKI_DB, MEDIA, and ASSETS; nothing was uploaded.

A separate isolated Cloudflare runtime check passed login, D1 create/update, artist years, source-date preservation, image metadata/revisions, R2 upload/head/get, unauthenticated image denial, stale-save rejection, directory search, and Overview. The installed tools were Wrangler 4.160.0, Miniflare 5.20261110.0-beta, workerd 1.20261110.1, and Node 26.3.0. The harness used Miniflare's compatibility adapter and a standalone script; older constructor examples and Node's inherited `--input-type=module` option caused harness startup errors, not application failures. No dependency changes were needed.

Release scope remains private, single-administrator draft management. Publishing, public wiki pages, relationships, and revision restoration remain out of scope. The directory API now returns a paginated object rather than an array: deploy the admin assets and Worker together, and reload any existing admin browser tabs. No database migration, account setup, binding change, or DNS change is required. Production deployment and its live verification still require separate authorization; the successful dry run and local checks do not constitute a deployment.

## Approved release — November 13, 2026

The owner authorized committing and pushing this release to `feature/wiki-draft-editor` and deploying directly to the existing `future-fire-website` Worker. The preceding live Worker version is `cbed1436-1205-432b-8025-47720163fd56` (recorded before release for rollback). Deploy with existing variables preserved; no migrations, administrator setup, DNS edits, or merge to `main` are part of this release. Confirm the resulting deployment version and live admin/assets/API access checks after deployment. The main branch's automatic deployment configuration remains unchanged, so a future main deployment must include these changes to retain the wiki administration features.
