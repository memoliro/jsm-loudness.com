# JSM Loudness — jsm-loudness.com

Free browser-based LUFS / True Peak / LRA analyzer. Exact ITU-R BS.1770-4 & EBU R128. No upload.

## Structure

- `/` and `/fr/` — English and French static pages (language by URL path, not JS)
- `/articles/` and `/fr/articles/` — Educational content
- `/assets/css/style.css` — Shared styles
- `/assets/js/main.js` — Consent Mode v2 handler (GA4)

## Language

- One fixed language selector (top-right) on every page
- Links always go to the matching page in the other language
- `hreflang` + canonical set correctly
- Sitemap includes both languages with xhtml:link alternates

## Consent / Analytics

- Consent Mode v2 defaults to denied
- Banner shown on every visit unless the user previously **Accepted**
- Reject does **not** persist — banner reappears next visit
- Accept is stored in localStorage + cookie (`jsm_consent_v1=granted`) for 1 year
- Measurement ID: `G-64EC8JJF7Q`

## Deploy

Upload the contents of this folder to the site root (Vercel / Netlify / static host).
Keep `vercel.json`, `_headers`, `_redirects`, `robots.txt`, `sitemap.xml`.

## Cleanup done (2026-09-06)

- Removed duplicate article drafts (`*_1.html`, `tiktok-loudness_3.html`)
- Single consistent language selector on all pages
- Fixed FR article asset paths, canonicals, hreflang
- Open Graph + Twitter image tags on all pages
- Complete sitemap with FR URLs
- Consent: remember only Accept
