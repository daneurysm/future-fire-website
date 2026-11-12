# Future Fire control room

Visit `https://futurefire.club/admin` after deployment. The Wiki tab supports private draft editing; public wiki publishing is not included yet.

## First owner setup

From this project directory, run `node scripts/setup-admin.mjs --remote`. Open its private loopback link and choose your username and password. The link expires after 15 minutes; the server shuts down after success. Passwords are hashed on your computer and are never printed. The setup page is not deployed to the public website. It cannot overwrite an existing administrator. Alternatively, use the terminal-only `node scripts/create-admin.mjs --remote admin`.

Never paste your password into chat, source files, or shell arguments. There is intentionally no public registration or password-reset endpoint. Keep your credentials in your own password manager.

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

The Wiki tab uses the existing administrator session and the separate WIKI_DB binding. Create Artist, Band or Label drafts with biography/history, introduction, location, aliases, genre selections, HTTPS links and sources. Saved entries can be reopened; each successful save records a revision snapshot. Stale saves are rejected so another editor's changes are not silently overwritten. The directory lists the latest 500 entries and filters names locally.

This release is draft-only: publishing, archiving, relationships, images, type-specific dates, revision restoration and public wiki pages are not implemented. Revision snapshots cover fields managed by this editor, not future media or relationships. The schema baseline and recovery reference are in wiki-migrations/README.md. Production already has that schema; do not replay its creation migration. No Wrangler binding or migration-directory changes are needed for this draft editor.

Validation: nine automated tests pass, including existing portal tests, wiki authentication/origin protection, draft round trips, revisions, stale saves, validation and atomic rollback. The frontend build and Wrangler deploy dry run pass with all four bindings. Browser QA against isolated in-memory SQLite databases verified login, creating a profile with alias/genre/link/source, saving and updating to a second revision. This is local QA, not a live Cloudflare verification.
