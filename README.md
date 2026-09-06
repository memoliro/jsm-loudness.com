# What was done

## 1. Removed JavaScript translation from index.html
Original index.html had:
- A small script that referenced `assets/js/main.js` for EN/FR selector and routing
- A `hideDupHeader` interval that hid duplicate headers
- A final <script src="assets/js/main.js" defer>

Cleaned version (cleaned_output/index.html):
- Removed main.js import entirely
- Replaced hide logic with clean dark-only theme init
- Kept the React analyzer bundle (inlined module) as-is - it's English-only now, no JS translation
- Added proper hreflang tags:
  <link rel="alternate" hreflang="en" href="https://jsm-loudness.com/"/>
  <link rel="alternate" hreflang="fr" href="https://jsm-loudness.com/fr/"/>
  <link rel="alternate" hreflang="x-default" href="https://jsm-loudness.com/"/>
- lang="en" stays pure English, no runtime language swapping

## 2. Created clean French folder /fr/
Every page now has a true static French translation, not JS-swapped:

- fr/index.html : Full French shell + React analyzer. Title, meta, description, h1, intro, batch panel, cookie banner translated. Asset paths fixed to ../assets/...
  Also translated major strings inside bundle where possible (Drop -> Déposez, Choose file -> Choisir un fichier, etc.)
- fr/about.html : À propos, fully translated
- fr/pricing.html : Tarifs, fully translated
- fr/contact.html : Contact Montréal, form translated
- fr/cookies.html : Politique de Cookies, table translated
- fr/privacy.html : Politique de Confidentialité, Loi 25 compliant
- fr/blog.html : Blog & Apprendre, cards translated

All French pages:
- <html lang="fr">
- canonical to https://jsm-loudness.com/fr/<page>
- hreflang fr/en/x-default
- Header nav in French: Analyseur, Apprendre, Blog, Tarifs, À propos
- Language selector shows FR active, EN links to ../
- Footer in French
- Asset paths corrected to ../assets/...
- Consent banner translated

## 3. Cleaned English pages
English pages in cleaned_output/ now have hreflang tags added and keep EN selector linking to fr/

## Usage
- Upload cleaned_output/* to your root
- Upload cleaned_output/fr/* to your /fr/ folder
- Delete assets/js/main.js translation logic or keep it but it's no longer loaded by index.html
- For SEO, ensure sitemap.xml includes both / and /fr/ versions

## No JS translation anymore
Language is now determined by URL path, not JavaScript. Google can index both versions cleanly.
