# Publication Studio

A non-commercial, browser-based ORCID and BibTeX to APA publication-list generator. Uses the anonymous ORCID v3 public API, Crossref DOI metadata, citeproc-js, and the official CSL APA style. It does not scrape Google Scholar or require an ORCID account.

## Publish on GitHub Pages

1. Create a public GitHub repository with a `main` branch.
2. Upload all files and folders in this package to the repository root, including the hidden `.github/` folder and `.gitignore`. Do not upload the ZIP itself or nest the app inside another folder.
3. In **Settings → Pages → Build and deployment**, choose **GitHub Actions** as the source.
4. Open **Actions → Deploy to GitHub Pages → Run workflow** and select `main`. Future pushes to `main` deploy automatically after the build and tests pass.
5. Find your public URL in the deployment summary or **Settings → Pages**. It will usually be `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

Assets and navigation use relative paths, so both repository Pages URLs and custom domains work. GitHub publishes only `dist/`; source, tests, and this README are not part of the served website. If your default branch has another name, update `branches: [main]` in `.github/workflows/deploy-pages.yml`.

This package does not change or connect to the separately hosted Sites version.

## Run

Install dependencies with `npm install`, build the formatter with `npm run build`, and serve `dist/` using a static web server. `npm test` exercises identifier checks, work grouping, metadata fallback, and export conversion.

## Behavior

- Validates ORCID IDs using MOD 11-2.
- Reads public work groups and the preferred source's full work details, with a summary fallback when a detail request fails.
- Consolidates identical self DOIs across groups. Does not guess whether same-title publications are duplicates.
- Optionally enriches DOIs with Crossref CSL JSON. DOI requests that fail fall back to ORCID and receive a review flag.
- Uses citeproc-js and APA CSL for bibliography ordering, name formatting, and same-year disambiguation.
- Supports search, type/year/review filters, selection, ordering, rich copying, text/HTML/BibTeX/CSL JSON exports, and print/PDF.
- Accepts .bib files up to 5 MB / 5,000 entries. Parses BibTeX/BibLaTeX, nested braces, string macros and LaTeX accents using Citation.js. Imports stay in browser memory and do not trigger ORCID or Crossref lookups.
- No database, accounts, API secrets, or saved searches. Lookup requests go directly from the browser to ORCID and Crossref. Fonts load from Google Fonts.

## Limits

ORCID records may be incomplete. ORCID credit names are unstructured, so without DOI enrichment they are preserved as literal names and flagged rather than split by guessing. The first version does not parse embedded BibTeX or enrich DataCite DOIs. No publication is attributed to the record holder merely because it is on their record. All public work types are included and can be filtered.

ORCID API usage terms and quotas apply. This prototype is intended for personal, non-commercial use; review ORCID's requirements before organizational or commercial deployment.

## Sources

- https://info.orcid.org/documentation/api-tutorials/api-tutorial-read-data-on-a-record/
- https://info.orcid.org/documentation/integration-and-api-faq/
- https://github.com/citation-style-language/styles/blob/master/apa.csl
- https://github.com/Juris-M/citeproc-js
- https://api.crossref.org
