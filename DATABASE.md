# Content database — phase one

The migrations define the non-wiki content model for Cloudflare D1 (SQLite). No wiki tables or public registration are included. The admin portal is served at `/admin`; the public site reads published content through `/api/content`. See `PORTAL.md` for operation and setup.

## Content

- `articles`: news, reviews, and weekly reports, Markdown text, drafts, publishing dates, cover images.
- `review_details`: release and artist metadata, optional rating from 0 to 10, listening link.
- `media` and `article_media`: image metadata and ordered galleries. Actual bytes belong in a private R2 bucket, not D1. Images are limited to 10 MiB and raster formats; the future upload endpoint must validate file contents, not just declared types.
- `tour_dates`: show information, timezone, ticket link, image, publication/cancellation status.
- `livestream_settings`: single stream configuration, station details, schedule, live status.
- `site_sections`, `site_settings`, `social_links`: editable non-wiki headings, descriptions, shared settings, and Matrix links. Site settings must never contain secrets.
- `admin_users`: one administrator only; salted scrypt password hash, no plaintext password.
- `admin_sessions`: future login sessions; store SHA-256 token digests only, never raw cookie values.

Timestamps use UTC ISO 8601 strings, except session timestamps which use Unix seconds. Future write endpoints must update `updated_at`, validate dates/URLs, and enforce review/article relationships. Public queries must explicitly filter published content with publication dates no later than now. Nothing automatically publishes a draft.

## Original first-time Cloudflare setup (not restoration)

The following steps describe initial provisioning only. Do not run them during restoration: the database, bucket, schema, and administrator may already exist. Preserve `DB` ID `9903bc9b-d3fc-451c-bc67-c5f034198f90`, `WIKI_DB` ID `e74b07aa-b0d3-43f6-ab2b-e35f1d9f897e`, and R2 bucket `futurefire-media`. The wiki binding has no routes in this application. The verified production content database name is `futurefire-club-db`, bound as `DB`; this is a configuration correction, not a database rename.

Use the Cloudflare account already hosting `future-fire-website`. Do not create another website or change DNS.

1. Install a project-local Wrangler development dependency if it is not already available: `npm install --save-dev wrangler`.
2. Run `npx wrangler d1 create futurefire-club-db` and `npx wrangler r2 bucket create futurefire-media`.
3. Merge the returned real database ID into `wrangler.jsonc`, preserving its current settings:

```json
{
  "d1_databases": [{
    "binding": "DB",
    "database_name": "futurefire-club-db",
    "database_id": "REPLACE_WITH_REAL_DATABASE_ID",
    "migrations_dir": "migrations"
  }],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "futurefire-media" }]
}
```

4. Apply locally first: `npx wrangler d1 migrations apply futurefire-club-db --local`.
5. Apply to production: `npx wrangler d1 migrations apply futurefire-club-db --remote`.
6. Create your account in your own terminal: `node scripts/create-admin.mjs --remote admin`. It prompts twice with input hidden. Do not send your password in chat or put it in a command. Use `--local` for the development account. Existing accounts are not overwritten.

The account helpers use Node's scrypt with N=16384, r=8, p=5, a random 16-byte salt, and a 64-byte derived key. These are OWASP's equivalent lower-memory settings, chosen to fit the Workers memory limit. Only a temporary owner-readable SQL file containing the hash is passed to Wrangler; it is removed afterward. The login endpoint uses the same verifier. No administrator had been created using the earlier, higher-memory hash format.

## Portal security

Admin API routes require server-side session checks. Cookies are Secure, HttpOnly, SameSite=Strict, and expire after eight hours. Writes require a matching Origin. Login attempts are limited to five per IP per 15 minutes using atomic D1 counters. Logout revokes the current session; password changes revoke all sessions. Uploads enforce a 10 MiB streaming limit and raster signatures. Article text renders as escaped plain text with paragraph breaks, not executable HTML. D1/R2 credentials and password hashes never go to the browser. R2 stays private; public media requests must be referenced by published content or saved public settings. Back up content and media before destructive changes. Owner account recovery still requires a trusted local maintenance workflow; there is no public reset endpoint.

## Current deployment status

The verified production D1 database is `futurefire-club-db` (ID `9903bc9b-d3fc-451c-bc67-c5f034198f90`); R2 uses `futurefire-media`. Both bindings are configured in `wrangler.jsonc`. Migrations `0001_content.sql` and `0002_login_limits.sql` were applied to the remote database on November 10, 2026. The portal and content integration were deployed directly to the existing Worker (version `c758346b-8d08-4c83-acc5-a5474f315633`). No production admin password is included in source or test fixtures. Direct deployment does not push these local changes to GitHub.
