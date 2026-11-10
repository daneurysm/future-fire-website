# Future Fire — Coming Soon

Deployable, build-free HTML, CSS and JavaScript. The `dist` folder is the complete website. No installation, external fonts, tracking, cookies or API keys. All core content works without JavaScript.

## Preview

Open `dist/index.html` in a browser, or run this from this folder:

```sh
python3 -m http.server 8765 --directory dist
```

Then visit http://localhost:8765. Check a phone-width window and desktop, keyboard navigation, motion toggle and the KOSW link. Browser preview in the authoring environment timed out, so visual browser QA remains to be completed. JavaScript syntax and local asset references were checked. HTTP delivery and visual rendering remain unverified due to local preview access restrictions.

## Deploy with GitHub and Cloudflare Pages — after approval

Repository: https://github.com/daneurysm/future-fire-website

Nothing has been deployed and no DNS or live services have been changed.

1. In Cloudflare, open **Workers & Pages**, create a **Pages** project, and choose **Connect to Git**.
2. Select the GitHub repository `daneurysm/future-fire-website`.
3. Set production branch to `main`, framework to **None**, build command to `exit 0`, and output directory to `dist`. Leave the root directory at the repository root.
4. Deploy and review the assigned `pages.dev` URL before connecting your domain.
5. For later changes, use a separate branch and pull request to review a preview. Merge into `main` only after approval: merging triggers a production deployment when automatic deployments are enabled.

Official guide: https://developers.cloudflare.com/pages/configuration/git-integration/

## Connect futurefire.club — after approval

1. Add `futurefire.club` to the same Cloudflare account as a domain/zone if it is not there already.
2. Review imported DNS records, preserving existing email records (MX, SPF, DKIM, DMARC) and any other services. If DNS is elsewhere, replace the registrar's nameservers with the two Cloudflare assigns. The registrar itself does not need to change. Follow Cloudflare's DNSSEC migration guidance if DNSSEC is enabled.
3. Once the zone is active, open the Pages project → **Custom domains** → **Set up a domain**. Enter `futurefire.club` and follow the prompts. Cloudflare creates the required CNAME for the apex domain; resolve any conflicting old web record only after checking its purpose.
4. Wait for the domain and certificate to become active, then check `https://futurefire.club`.
5. If desired, also add `www.futurefire.club` through the same Pages custom-domain flow. Configure a Cloudflare redirect from www to the apex, preserving paths and query strings.

Do not only create a DNS record: register the hostname in Pages Custom domains too. Apex domains on Pages require Cloudflare nameservers.

Official guide: https://developers.cloudflare.com/pages/configuration/custom-domains/

## Editing

- `dist/index.html`: masthead, publication copy, radio schedule, link and metadata.
- `dist/styles.css`: responsive layout, colors and CSS orbital artwork.
- `dist/signal.js`: motion control and copyright year.
- `dist/_headers`: Cloudflare security headers.
- `dist/favicon.svg`, `robots.txt`, `sitemap.xml`: site identity and discovery.

The radio schedule is reproduced as supplied: Saturdays 6–9 PM. No timezone or launch date is invented. The link leads to KOSW's website; it does not autoplay audio.

Motion respects the operating system's reduced-motion preference, with a pause button for other visitors. The starfield is static and the single orbit animation uses CSS transforms. There are no large media downloads or continuous JavaScript rendering loops.
