# StudioShift Flat - 2 folders

Structure you asked:
- assets/ (css, js)
- articles/ (5 guides)
- *.html flat files at root (index.html, about.html, contact.html, privacy.html, terms.html, cookies.html, blog.html)
- robots.txt, sitemap.xml

Deploy: drag-drop to Cloudflare Pages, no build. Clean URLs will be /contact.html (or configure Pages to serve /contact). For clean /contact without .html, enable Pages clean URLs or rename to /contact/index.html - but you asked for flat.
