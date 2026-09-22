# Repository Guidelines

## Project Structure & Module Organization

This repository is a small static cashier reporting app for UMKM use. `index.html` contains markup and browser JavaScript; `assets/styles.css` contains compiled Tailwind styling. `apps-script/Code.gs` is the Sheets/Drive backend. `config.example.js` documents browser configuration; actual `config.js` is ignored. `README.md` covers setup and usage, and `SECURITY.md` records the review. Keep tests in `tests/` and development utilities in `scripts/`.

## Build, Test, and Development Commands

No package manager or build step is required. Use Node.js 20+ for development utilities.

- `node scripts/serve.mjs`: serves browser assets at `http://127.0.0.1:8000` without exposing repository/private files.
- `node --test tests/security.test.cjs`: checks security and compatibility with mocked Google services.
- `git diff --check`: checks patch formatting.
- `git status --short`: checks pending changes before and after edits.

html2canvas and fonts load from CDNs, so test with an internet connection. Tailwind is compiled into `assets/styles.css`; regenerate it with the pinned command in README after changing utility classes.

## Coding Style & Naming Conventions

Match the existing single-file style. Use 4-space indentation for HTML, CSS, and JavaScript blocks. Prefer clear `camelCase` names, as in `shiftData`, `currentMode`, and `confirmReset`. Keep UI text in Indonesian unless the surrounding feature already uses English. Avoid broad refactors; make surgical edits that directly support the request.

## Testing Guidelines

Use the built-in Node test runner for security and compatibility checks. Verify the tabs `Awal`, `Akhir`, `Pengeluaran`, and `Laporan` in a browser. Confirm draft persistence on refresh and screenshot output on mobile/desktop viewports. Use synthetic data with mocks or a dedicated test deployment; never submit test data to production.

## Commit & Pull Request Guidelines

Recent commits use concise messages such as `Update index.html` and `Update README.md`. Continue with short, imperative summaries, for example `Fix report total calculation` or `Update cashier form labels`. Pull requests should include a brief description, manual test notes, and screenshots for visible UI changes. Link issues when available and call out changes to external services such as Google Apps Script URLs or Drive folder IDs.

## Security & Configuration Tips

Keep production URLs in ignored deployment configuration and Drive/spreadsheet identifiers in Apps Script properties. Browser configuration is public even when ignored by Git. Tokens belong only in runtime input and server properties; never commit them or persist them in browser storage. Preserve the draft storage key and calculations. Escape untrusted HTML/spreadsheet text, validate submissions, and document deployment migrations. Do not commit credentials or sales data.
