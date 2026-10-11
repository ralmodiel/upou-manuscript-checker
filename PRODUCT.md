# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **MDC students** (Master of Development Communication, UP Open University) finishing their thesis
  manuscript. They check their own file before sending the PDF to MDC Program Support for the
  format consistency check, and come back after each round of corrections.
- **MDC Program Support staff** reviewing manuscripts. They use the same results to prepare the
  formatting comments they email to students (numbered parts, dash items, as in the sample emails).
- Both use the same page: no separate reviewer and student modes, and wording that serves either.

## Product Purpose

Check a thesis manuscript against every item of the MDC Format Checklist
(data/Format Checklist.xlsx: 38 items in 9 parts, plus a few things reviewers also point out) and
list what to correct, where, in the reviewer's own phrasing. Success: fewer correction rounds
between students and MDC Program Support, and students who know exactly what to fix.

## Positioning

The whole check runs in the visitor's browser: the manuscript never leaves their device. It reads
the file formats students actually hand in (Word .docx and .doc, PDF, OpenDocument .odt from Google
Docs or LibreOffice, Rich Text .rtf) and reports against the program's own checklist, not generic
writing advice.

## Operating Context

- Students write in the MDC template (a Google Docs export, offered for download on the site) with
  Word or Google Docs, and send a PDF for checking. Reviewers reply by email with numbered
  corrections and annotated screenshots (samples in data/, hand-written, so they may miss items).
- The site is a static app on GitHub Pages: no backend, database or APIs.

## Capabilities and Constraints

- Every checklist item gets a status: passed, to correct, to review (cannot be told from the file,
  or needs a human look), or not applicable.
- Outputs: the results on the page (the whole checklist, passed items in green), a formatting
  comments report as Word .docx and as PDF, and a print view.
- Page-level items (hanging lines, blank pages, page numbers as printed) are exact in a PDF;
  styles and spacing are exact in a Word file. An old .doc is checked for text and page numbering only.
- Never say "upload": the file is read in the browser.
- Only free-of-cost, open-source libraries (checked by scripts/licenses.mjs: MIT, Apache-2.0,
  BSD, ISC, 0BSD and the like; MPL-2.0 only in build tools that never ship).
- Downloads offered: the MDC thesis manuscript template (.docx) and the Format Checklist (.xlsx).

## Brand Commitments

- Visual system patterned on the sibling UPOU OER proof of concept (F:\workspaces-aiel\upou-networks):
  paper and ink, UP maroon, forest and gold, Instrument Serif and Instrument Sans, light and dark.
- Text wordmark only; no UP seal or UPOU logo artwork on the site.
- State prominently and in several places: an unofficial proof of concept, not an official UPOU
  site, in alpha testing; built diligently and meticulously with AI but it can still make mistakes,
  so results need human verification; MDC Program Support's review is the official check.

## Evidence on Hand

- data/Format Checklist.xlsx (the authority), data/MDC Thesis Manuscript_SURNAME, Given Name.docx
  (the template), data/Samples (Manuscripts with Formatting Comments)/ (ten reviewer emails as PDF;
  local reference only, never published or quoted on the site).
- No testimonials, usage numbers or endorsements exist; none may be invented.

## Product Principles

1. The checklist is the authority: show all of it, every time, in its own words.
2. Say where: every correction points to a page or quotes the text to find.
3. Be honest about certainty: "to review" when the file cannot tell, never a confident guess.
4. Private by construction: nothing about a manuscript leaves the device.
5. Encourage: progress and passed items are as visible as corrections.

## Accessibility & Inclusion

WCAG 2.2 AA in both themes; statuses never by colour alone; full keyboard use; works on phones
(students often check on mobile); respects reduced motion.
