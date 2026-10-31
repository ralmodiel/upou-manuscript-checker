# Notices

## Unofficial proof of concept

This project is an unofficial, non-commercial proof of concept in its beta testing stage. It is
not an official site of the University of the Philippines Open University (UPOU) and is not
affiliated with or endorsed by UPOU or any of its programs. The
site's own pages use no UP or UPOU seal, logo or other artwork. The UP seal appears only inside the
MDC program's thesis template (`public/downloads/`), unchanged, as the program distributes it for title
pages.

## Results need human verification

The checker was built diligently and meticulously with the help of AI, but it reads files the way
a program does, not the way a person does. It can miss a problem or flag one that is not there,
especially with unusual layouts, text boxes or scanned pages. Every result is a guide to be
confirmed against the manuscript itself. Your program's format review remains the official
check, and its comments take precedence.

The software is provided "as is", without warranty of any kind, as stated in the
[MIT License](LICENSE).

## Privacy

Manuscripts are never submitted to any server. They are processed only in the visitor's browser,
on their own device; nothing from them is sent anywhere or stored. The site keeps only the
visitor's theme choice (light or dark) and their Topic planner entries (up to three candidate
topics), in their own browser; a plan saved as a file is written to the visitor's device. The
site has no accounts, cookies or analytics. Like any website, its host (GitHub Pages) receives the
ordinary requests for the pages themselves, such as the visitor's IP address; manuscripts are never
part of them. The Topic planner's optional AI helper, only when the visitor turns it on, fetches a
language model from Hugging Face (huggingface.co) and runs it in the browser; what the visitor
types goes to that model on their own device and nowhere else.

## Source code

The source code of this project is licensed under the [MIT License](LICENSE). That license
covers the code only, not the materials described below.

## Program materials

The checklist items the site checks against (quoted in `src/engine/checklist.ts`), and the MDC thesis
manuscript template (`public/downloads/`) are materials of the UPOU
MDC program. They are reproduced unchanged for the convenience of students and reviewers, who
should confirm with MDC Program Support that they have the latest versions. If you hold rights in
any of these materials and want them removed, open an issue in this project's GitHub repository
and they will be taken down.

The site links to the APA Style pages on tables, figures and reference lists
([apastyle.apa.org](https://apastyle.apa.org)); that content belongs to the American
Psychological Association and is not reproduced here.

## PRISMA 2020

The Topic planner reproduces the PRISMA 2020 checklist and the PRISMA 2020 for Abstracts checklist
(in `src/topic/prisma.ts`), from: Page MJ, McKenzie JE, Bossuyt PM, Boutron I, Hoffmann TC, Mulrow
CD, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. BMJ
2021;372:n71. doi:10.1136/bmj.n71. The checklists are distributed under the Creative Commons
Attribution 4.0 licence (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/), which permits
their reproduction with attribution; the planner credits them wherever they appear and links the
PRISMA website ([prisma-statement.org](https://www.prisma-statement.org/)) for the checklist, the
flow diagram templates and the PRISMA extensions. The planner carries the statement PRISMA asks of
those who endorse it. PRISMA and the PRISMA Executive have not reviewed or endorsed this site.

## Third-party software and fonts

The site bundles open-source libraries (React, pdf.js, fflate, cfb, pdf-lib, Transformers.js,
ONNX Runtime Web and their dependencies) under the MIT, Apache-2.0, BSD, 0BSD and Zlib licenses,
and the Instrument Sans and Instrument Serif fonts under the SIL Open Font License 1.1. Full texts:
`public/THIRD_PARTY_LICENSES.txt`.

The Topic planner's optional language model, Qwen2.5-0.5B-Instruct (Qwen team, Alibaba Cloud;
Apache-2.0), in the ONNX conversion published by the onnx-community on Hugging Face, is not
bundled: the visitor's browser fetches it from Hugging Face only after they turn the helper on,
at a fixed revision of the model's files (the commit named in `src/topic/ai.ts`, the one that was
tested), and lets it go again when they turn the helper off.
