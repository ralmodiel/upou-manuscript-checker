# UPOU Format Check

A web app that checks a UP Open University (UPOU) manuscript, at any level and in any program (a
bachelor's special or capstone project, a master's capstone project, special problem or thesis, a
doctoral dissertation), against every item of the format checklist, right in the browser. It lists what to
correct, with the pages to look at, and writes the comments as a Word or PDF file set out like the
program's review emails.

- **Nothing leaves the device.** The manuscript is read and checked by the page itself, on the
  visitor's desktop, laptop or phone. There is no backend, no database and no API, and the page's
  security policy (`connect-src 'none'`) blocks the page's scripts from making network requests.
- **Every checklist item, every time.** All 38 items in 9 parts, each marked _To correct_,
  _To review_, _Passed_ or _Not applicable_, plus three things reviewers often point out: template
  text left in, blank pages and coloured text.
- **The files students actually have.** Word (.docx, .docm, .dotx, and .doc for text and page
  numbering), PDF, OpenDocument (.odt, .ott) and Rich Text (.rtf). Google Docs and Apple Pages
  users are told how to export a file it can read.
- **Phone friendly.** Responsive from 320px phones to wide screens. The first visit loads about
  95 KB (gzip) of HTML, CSS and JS; the checking engine loads while the page is idle, and pdf.js
  only when a PDF is chosen.
- Light and dark themes, keyboard accessible, respects `prefers-reduced-motion`, prints cleanly.
- **Current browsers.** Chrome and Edge 111, Firefox 114 and Safari 16.4 or later (the build target).
  An older browser gets a plain notice that it needs an update (`public/browser-check.js`), not a
  broken page. PDFs need Chrome and Edge 119, Firefox 122 or Safari 17.4 (pdf.js 6); an older
  browser is told it needs an update to check PDF files, and can still check Word files.

## Proof of concept

This is an **unofficial proof of concept in its beta testing stage**. It is not an official UPOU
site and is not affiliated with or endorsed by UPOU. It was built diligently and meticulously with
the help of AI, but it can still make mistakes, so every result needs human verification. The
program's own review remains the official format check. See [NOTICE.md](NOTICE.md).

## Programs and sources

The checklist is the MDC program's copy of UPOU's central format checklist (`data/`, offered for
download with the template that follows it). The title and acceptance pages are read for any UPOU
degree (Associate, Bachelor, Diploma, Master, Doctor; "of" or "in"), any of the three faculties and
any manuscript type named before "Adviser:". Where UPOU's style guide (OVCAA 2017-4, issued by
memorandum on 25 May 2022, the newest found) differs from the checklist, as in upper case versus
title case for the title, other programs get _To review_, not _To correct_. Dean names are not
hard-coded: they differ by faculty and change.

## Stack

React 19, TypeScript, Vite 8 and Tailwind CSS 4. Documents are read with
[pdf.js](https://github.com/mozilla/pdf.js) (PDF), [fflate](https://github.com/101arrowz/fflate)
(the zip inside .docx and .odt, and the Word report), [cfb](https://github.com/SheetJS/js-cfb)
(.doc) and the browser's own `DOMParser`; [pdf-lib](https://github.com/Hopding/pdf-lib) writes the
PDF report. Every library is free and open source (MIT, Apache-2.0, 0BSD or Zlib).

## Getting started

Requires Node 24 (see `.nvmrc`).

```sh
npm install
npm run dev       # http://localhost:5290
```

## Scripts

| Script              | What it does                                               |
| ------------------- | ---------------------------------------------------------- |
| `npm run dev`       | Development server                                         |
| `npm run build`     | Type-check and build to `dist/`                            |
| `npm run preview`   | Serve the build (with its Content Security Policy) on 5291 |
| `npm run typecheck` | TypeScript only                                            |
| `npm run lint`      | ESLint                                                     |
| `npm run format`    | Prettier (`format:check` to check only)                    |
| `npm test`          | Vitest (`test:watch` to keep running)                      |
| `npm run audit`     | `npm audit` at any severity, then registry signatures      |
| `npm run verify`    | All of the above in order, as the deploy workflow runs it  |

## How it works

`src/engine/` is plain TypeScript with no browser dependency beyond `DOMParser`:

1. `check.ts` identifies the file by its first bytes (not its name) and picks a reader.
2. The readers (`docx.ts`, `odt.ts`, `rtf.ts`, `doc.ts`, `pdf.ts`) turn the file into one common
   model: paragraphs with their resolved fonts, spacing, alignment and page, footers per section,
   pictures and, for a PDF, laid-out pages.
3. `structure.ts` finds the parts of the manuscript: title page, permission and acceptance pages,
   preliminary pages, chapters, figures and tables, references and appendices.
4. `rules/` gives one finding per checklist item (`checklist.ts` holds the items in the
   checklist's own words), and `src/report/` turns the findings into the Word and PDF comments.

A Word file shows exactly which fonts, spacing and alignment were set; a PDF shows the pages as
they print. Checking both gives the fullest picture, and the site says so.

### Local tooling (not committed)

`scripts/` (fixture builders, a Word automation script that exports each fixture to PDF, .odt,
.rtf and .doc, a batch verifier, probes and the license audit), `tmp/` (generated fixtures and
renders) and `data/` (local reference material) are git-ignored and never published. The committed test (`src/engine/check.test.ts`)
builds its own small Word file.

## Security and privacy

- Production builds carry a strict Content Security Policy as a `<meta>` tag: scripts, styles,
  fonts and the pdf.js worker come only from the site, and `connect-src 'none'` stops the page's scripts from
  making network requests (fetch, XHR, WebSocket, beacons). A `<meta>` policy does not reach the
  pdf.js worker (GitHub Pages sends no policy header), but pdf.js only reads the file it is given
  and makes no requests. The theme and the browser check run from `public/theme-boot.js` and
  `public/browser-check.js`, so no inline script is needed.
- Files are read in memory and dropped when the page closes. Nothing is stored except the theme
  choice (`localStorage`, key `mdc:theme`). No accounts, cookies or analytics.
- Files over 100 MB are refused, and the .docx and .odt readers skip zip parts over 64 MB. Text
  from a document is always rendered as text, never as HTML; the Word report escapes it and strips
  control characters.
- Dependencies: `npm audit` reports 0 vulnerabilities in the whole tree (direct and transitive,
  development tools included, at any severity), OSV.dev knows of none either, and every package's
  npm registry signature verifies. `npm run verify` repeats the audit and the signature check on
  every deploy, after `npm ci` installs exactly the versions in `package-lock.json`, and
  `.github/workflows/audit.yml` repeats them every Monday, so a newly published advisory shows up as
  a failed run even when nothing is pushed.

## Deploying to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys on every push to `main`:

1. In the repository settings, under **Pages**, set **Source** to **GitHub Actions**.
2. Push to `main` (or run the workflow manually). It runs `npm run verify` and publishes `dist/`.

The workflow passes `BASE_PATH=/<repo>/`, which Vite uses for every asset and download URL (local
builds keep `/`), and `VITE_REPO_URL`, which adds a "View source" link to the footer. The build
also writes `404.html` as a copy of `index.html`. Pages cannot send custom headers, so the CSP
ships as a `<meta>` tag, which cannot set `frame-ancestors`; hosts that support headers should
add one.

## License

- **Code:** [MIT](LICENSE).
- **Template and checklist** (`public/downloads/`): materials of the UPOU MDC program, offered for
  convenience. They are not covered by the MIT License.
- **Bundled libraries and fonts:** see `public/THIRD_PARTY_LICENSES.txt` (also linked from the
  site's footer).

See [NOTICE.md](NOTICE.md) for the full notices.
