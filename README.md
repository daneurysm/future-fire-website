# Future Fire

Production site for https://futurefire.club, served by the existing Cloudflare Worker `future-fire-website`. Pushes to `main` trigger its existing Cloudflare build and deployment (`exit 0`, then `npx wrangler deploy`). No domain or DNS changes are needed.

`dist/` contains the complete deployable static site, including locally hosted fonts, images, and a React bundle. The security headers allow only same-origin assets. The six stereo buttons switch full-page sections; News is the default.

Editable application source lives in `src/`. The JavaScript bundle is built from `src/entry.tsx` using React 19 and esbuild; `src/styles.css` is appended after the local font declarations in `dist/styles.css`.

Reviews, wiki entries, tour dates, weekly reports and the live player remain awaiting content. Matrix links to the supplied Facebook, TikTok, Instagram and X profiles.
