# Future Fire

Production site for https://futurefire.club, served by the existing Cloudflare Worker `future-fire-website`. Pushes to `main` trigger its existing Cloudflare build and deployment (`exit 0`, then `npx wrangler deploy`). No domain or DNS changes are needed.

`dist/` contains the complete deployable static site, including locally hosted fonts, images, and a React bundle. The security headers allow only same-origin assets. The six stereo buttons switch full-page sections; News is the default.

Editable application source lives in `src/`. The JavaScript bundle is built from `src/entry.tsx` using React 19 and esbuild; `src/styles.css` is appended after the local font declarations in `dist/styles.css`.

Reviews, wiki entries, tour dates, weekly reports and the live player remain awaiting content. Matrix links to the supplied Facebook, TikTok, Instagram and X profiles.

The non-wiki content system is in `migrations/` and `src/worker.mjs`. Visit `/admin` for the control room. See `PORTAL.md` for private owner setup, editing, tests, and deployment, and `DATABASE.md` for the data model. Run `npm run build` after public React source changes; the existing deployment uses the checked-in `dist/` bundle.

## Restoration branch

The complete Worker entry point is `src/worker.mjs`; `src/entry.tsx` is the browser entry point. Wrangler binds existing resources as `DB`, `WIKI_DB`, `MEDIA`, and `ASSETS`. `WIKI_DB` powers the private wiki Overview and draft editors for artists, bands, and labels, including artist activity years, sources, and images. Public wiki publishing is not implemented.

The verified production content database is `futurefire-club-db`, ID `9903bc9b-d3fc-451c-bc67-c5f034198f90`, exposed to the Worker as `DB`. Configuration and administrator maintenance scripts use this verified name. Preserve the database ID, all other bindings, and the bucket name. Administrator setup scripts must not be run against an existing account.

Do not rerun initial migrations, seed data, or administrator setup during restoration. First inspect existing migration records and back up production data outside Git. See `PORTAL.md` for verification and release notes. Database exports, credentials, local environments, and installed dependencies must remain untracked.
