// The engine end to end on a small Word file made here (the fixture set stays local), plus the
// guards around it: files it cannot read are turned away with a reason, and the comments it writes
// stay valid whatever the file name holds.
import { strFromU8, strToU8, unzipSync, zipSync, zlibSync } from 'fflate'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { reportDocx } from '../report/docx.ts'
import { reportModel } from '../report/model.ts'
import { check, FileProblem, sniff } from './check.ts'
import { ITEMS } from './checklist.ts'
import { guard, MISREAD } from './guard.ts'
import type { Ctx } from './report.ts'
import { titleCase } from './rules/figures.ts'
import { garbledVariant, parseFolio } from './rules/numbering.ts'
import { readsOddly } from './text.ts'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'
const para = (text: string, pPr = '') =>
  `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

function docx(...paras: string[]): Uint8Array {
  return docxIn('<w:sectPr/>', ...paras)
}

/** A Word file whose last section has the given properties (its break type, for one). */
function docxIn(sect: string, ...paras: string[]): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}" Target="word/document.xml"/></Relationships>`,
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${paras.join('')}${sect}</w:body></w:document>`,
    ),
  })
}

const thesis = (...body: string[]) =>
  docx(
    para('A STUDY OF COMMUNITY RADIO', '<w:jc w:val="center"/>'),
    para('CHAPTER I', '<w:pageBreakBefore/><w:jc w:val="center"/>'),
    para('INTRODUCTION', '<w:jc w:val="center"/>'),
    ...body,
  )
const opts = { pdfjs: () => Promise.reject(new Error('no PDFs here')) }
const finding = (r: Awaited<ReturnType<typeof check>>, id: string) =>
  r.findings.find((f) => f.id === id)!

describe('check', () => {
  it('answers every checklist item once, in order, with no rule failing', async () => {
    const r = await check('thesis.docx', thesis(para('Body text.')), opts)
    expect(r.kind).toBe('docx')
    expect(r.findings.map((f) => f.id)).toEqual(ITEMS.map((i) => i.id))
    expect(r.findings.filter((f) => f.message.includes('could not run'))).toEqual([])
    expect(finding(r, 'extra.placeholders').status).toBe('ok')
  })

  it('reads the title page of any UPOU program and level', async () => {
    const c = '<w:jc w:val="center"/>'
    const r = await check(
      'project.docx',
      docx(
        ...[
          'UNIVERSITY OF THE PHILIPPINES',
          'OPEN UNIVERSITY',
          'BACHELOR OF ARTS IN MULTIMEDIA STUDIES',
          'Juan A. Cruz',
          'A Study of Community Radio',
          'Special Project Adviser:',
          'MARIA B. SANTOS, Ph.D.',
          'Faculty of Management and Development Studies',
          '12 May 2026',
        ].map((t) => para(t, c)),
        para('CHAPTER I', `<w:pageBreakBefore/>${c}`),
        para('INTRODUCTION', c),
        para('Body text.'),
      ),
      opts,
    )
    expect(finding(r, 'title.adviser').message).not.toMatch(/write your/i)
    expect(finding(r, 'title.sequence').details?.join(' ') ?? '').not.toMatch(
      /degree program|Adviser:|the Faculty/,
    )
    // Title case is UPOU's style guide; upper case the MDC checklist's: for the student to check.
    expect(finding(r, 'title.title')).toMatchObject({ status: 'review' })
    expect(finding(r, 'title.title').message).toMatch(/special project title/)
  })

  it('takes “Research Adviser:” as the label and a lower-case title as an error, a date not in Day Month Year for the student to look at', async () => {
    const c = '<w:jc w:val="center"/>'
    const page = (title: string, date: string) =>
      check(
        'project.docx',
        docx(
          ...[
            'UNIVERSITY OF THE PHILIPPINES',
            'OPEN UNIVERSITY',
            'MASTER OF DISTANCE EDUCATION',
            'Juan A. Cruz',
            title,
            'Research Adviser:',
            'MARIA B. SANTOS, Ph.D.',
            'Faculty of Education',
            date,
          ].map((t) => para(t, c)),
          para('CHAPTER I', `<w:pageBreakBefore/>${c}`),
          para('INTRODUCTION', c),
        ),
        opts,
      )
    const good = await page('A Study of Community Radio', '15 October 2026')
    expect(finding(good, 'title.sequence').details?.join(' ') ?? '').not.toMatch(/Adviser:/)
    expect(finding(good, 'title.adviser').message).not.toMatch(/write your/i)
    expect(finding(good, 'title.date').status).toBe('ok')
    const bad = await page('a study of community radio', 'October 15, 2026')
    expect(finding(bad, 'title.title').status).toBe('fix')
    expect(finding(bad, 'title.date').status).toBe('fix')
  })

  it('reports template text left in', async () => {
    const r = await check('thesis.docx', thesis(para('Xxxxxxxxxxxxxxxx xxxxxxx.')), opts)
    expect(finding(r, 'extra.placeholders').status).toBe('fix')
  })

  it('holds the reference list to APA: bold heading on a new page, every work cited both ways', async () => {
    const double = '<w:spacing w:line="480" w:lineRule="auto"/>'
    const r = await check(
      'thesis.docx',
      thesis(
        para('Radio reaches the hills (Malaya, 2019; Bituin, 2021).'),
        para('Reference', '<w:jc w:val="center"/>'),
        para('Malaya, R. (2019). Notes on the field. Press.', double),
        para('Lim, B. (2020). One work. Press.', double),
      ),
      opts,
    )
    const apa = finding(r, 'references.apa')
    expect(apa.status).toBe('fix')
    const d = apa.details?.join(' ') ?? ''
    expect(d).toMatch(/in bold/)
    expect(d).toMatch(/on a new page/)
    expect(d).toMatch(/Title the list/)
    expect(d).toMatch(/Not found cited in the text.*“Lim/)
    expect(d).not.toMatch(/Not found cited.*Malaya/)
    expect(d).toMatch(/not found in the reference list: “Bituin”/)
  })

  it('reads a chapter title put under its label with a line break', async () => {
    const r = await check(
      'thesis.docx',
      docx(
        para('A STUDY OF COMMUNITY RADIO', '<w:jc w:val="center"/>'),
        '<w:p><w:pPr><w:pageBreakBefore/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Chapter I</w:t><w:br/><w:t>INTRODUCTION</w:t></w:r></w:p>',
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Background of the Study</w:t></w:r></w:p>',
        para('Body text.'),
      ),
      opts,
    )
    expect(finding(r, 'chapterStart.title').status).toBe('ok')
  })

  it('does not pass a figure number it cannot place above its figure', async () => {
    const r = await check(
      'thesis.docx',
      thesis(
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Figure 1.</w:t></w:r></w:p>',
        '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Sources of Information</w:t></w:r></w:p>',
        para('Body text.'),
      ),
      opts,
    )
    expect(finding(r, 'figures.number').status).toBe('review')
  })

  it('reads undated references and orders one author’s works by year', async () => {
    const double = '<w:spacing w:line="480" w:lineRule="auto"/>'
    const r = await check(
      'thesis.docx',
      thesis(
        para('As Smith (2018, 2020) found, and the Community Radio Network (n.d.) shows.'),
        '<w:p><w:pPr><w:pageBreakBefore/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>REFERENCES</w:t></w:r></w:p>',
        para('Community Radio Network. (n.d.). An undated page.', double),
        para('Smith, J. (2020). A later work.', double),
        para('Smith, J. (2018). An earlier work.', double),
      ),
      opts,
    )
    expect(finding(r, 'references.order').details?.join(' ')).toMatch(/earliest year/)
    // Three entries, the undated one included.
    expect(finding(r, 'references.apa').status).toBe('ok')
    expect(finding(r, 'references.apa').message).toMatch(/The 3 references/)
  })

  it('leaves a numeral-led entry for the writer, and does not take two notes or a statute amiss', async () => {
    const double = '<w:spacing w:line="480" w:lineRule="auto"/>'
    const r = await check(
      'thesis.docx',
      thesis(
        para('REFERENCES', '<w:jc w:val="center"/>'),
        para('2020 census of the town. (2021). Town Office.', double),
        para('Alon, R. (2019). Notes from Unit II. Reading the field. Course pack.', double),
        para('Alon, R. (2019). Notes from Unit II. Writing it up. Course pack.', double),
        para('Bautista, L. (August 2006). A dated piece. Daily News.', double),
        para('Republic Act No. 10173, Data Privacy Act of 2012.', double),
      ),
      opts,
    )
    expect(finding(r, 'references.order').status).toBe('review')
    const apa = (finding(r, 'references.apa').details ?? []).join(' ')
    expect(apa).not.toMatch(/Listed twice|year in parentheses|No year/)
    expect(apa).toMatch(/year first.*add a, b/)
  })

  it('finds a reference listed twice, one author’s works of a year out of order, a personal communication', async () => {
    const double = '<w:spacing w:line="480" w:lineRule="auto"/>'
    const r = await check(
      'thesis.docx',
      thesis(
        para('REFERENCES', '<w:jc w:val="center"/>'),
        para('Cruz, A. (2019). The second title. Press.', double),
        para('Cruz, A. (2019). A first title. Press.', double),
        para('Lim, B. (2020). One work. Press.', double),
        para('Lim, B. (2020). One work. Press.', double),
        para('Reyes, C. (2021, May 3). Personal communication.', double),
      ),
      opts,
    )
    expect(finding(r, 'references.order').details?.join(' ')).toMatch(/go by title/)
    const apa = finding(r, 'references.apa')
    expect(apa.status).toBe('fix')
    expect(apa.details?.join(' ')).toMatch(/Listed twice.*add a, b.*personal communications/)
  })

  it('does not call two entries with one author, year and title but other details the same entry', async () => {
    const double = '<w:spacing w:line="480" w:lineRule="auto"/>'
    const r = await check(
      'thesis.docx',
      thesis(
        para('REFERENCES', '<w:jc w:val="center"/>'),
        para('Cruz, A. (2019). Course notes. Module 1 on radio. Open Press.', double),
        para('Cruz, A. (2019). Course notes. Module 2 on print. Open Press.', double),
      ),
      opts,
    )
    const apa = finding(r, 'references.apa').details?.join(' ') ?? ''
    expect(apa).not.toMatch(/Listed twice:/)
    // (a short title cut at its first period, the entries parting soon after: two works)
    expect(apa).not.toMatch(/Listed twice/)
    expect(apa).toMatch(/add a, b/)
  })

  it('reads a title the text layer spaced out or shuffled as unreadable, not as another title', () => {
    expect(readsOddly('A STUDY OF RADIO NARRATIVES', 'A STUDY OF RA DIO NARRAT IVES')).toBe(true)
    // (a word joined, two letters swapped: the writer's slips, to be corrected)
    expect(readsOddly('HEALTH CARE OF RURAL TOWNS', 'HEALTHCARE OF RURAL TOWNS')).toBe(false)
    expect(readsOddly('SECURITY OF RURAL TOWNS', 'SCEURITY OF RURAL TOWNS')).toBe(false)
    expect(readsOddly('A STUDY OF RADIO NARRATIVES', 'A STUDY OF RADIO IVENARRAT S')).toBe(true)
    expect(readsOddly('AN ANALYSIS OF RADIO', 'AN ANALYS1S OF RADIO')).toBe(true)
    expect(readsOddly('A STUDY OF RADIO NARRATIVES', 'A STUDY OF TELEVISION NARRATIVES')).toBe(
      false,
    )
  })

  it('tells a mistyped year from one outside the parentheses, and finds a lone a/b letter', async () => {
    const double = '<w:spacing w:line="480" w:lineRule="auto"/>'
    const r = await check(
      'thesis.docx',
      thesis(
        para('REFERENCES', '<w:jc w:val="center"/>'),
        para('Daily Wire Service. (20214, July 10). A news item.', double),
        para('Cruz, A., 2020. A work with its year outside.', double),
        para('Tan, G. (2016b). The only work of 2016.', double),
      ),
      opts,
    )
    const details = finding(r, 'references.apa').details?.join(' ') ?? ''
    expect(details).toMatch(/Correct the year, mistyped: “Daily Wire Service/)
    expect(details).toMatch(/Write the year in parentheses after the author[^|]*“Cruz, A\., 2020/)
    expect(details).not.toMatch(/parentheses after the author[^.]*Daily/)
    expect(details).toMatch(/no other work of that author and year is listed: “Tan, G\. \(2016b\)”/)
  })

  it('places an entry behind a misplaced one, reads "van" surnames, co-authors, a near-duplicate and the heading', async () => {
    const double = '<w:spacing w:line="480" w:lineRule="auto"/>'
    const r = await check(
      'thesis.docx',
      thesis(
        para('BIBLIOGRAPHY', '<w:jc w:val="center"/>'),
        para('Boulton, S. (2020). One title. Press.', double),
        para('Bourne, P. (1988). Another title. Press.', double),
        para('Bell, P. (1966). A third title. Press.', double),
        para('Borden, K. (2021). A fourth title. Press.', double),
        para('Lopez, H., &amp; Garcia, A. (2025). A fifth title. Press.', double),
        para('Lopez, H., Diaz, A. L., &amp; Ramos, J. B. (2023). A sixth title. Press.', double),
        para(
          'Reyes, D. (2021). The ways of faith: the material study of religions. Press.',
          double,
        ),
        para(
          'Reyes, D. (2021). The ways of faith: the material study of devotion. Verlag.',
          double,
        ),
        para('Santos, S. (2019). A seventh title. Press.', double),
        para('Santos, S. (2019). An eighth title. Press.', double),
        para('van Dijk, A. (2015). A ninth title. Press.', double),
        para('Vale, P. (2022). A tenth title. Press.', double),
      ),
      opts,
    )
    const order = finding(r, 'references.order').details?.join(' ') ?? ''
    expect(order).toMatch(
      /“Borden, K\. \(2021\)\. A fourth title\. Press\.” should come before “Boulton/,
    )
    expect(order).toMatch(/“Vale[^”]*” should come before “van Dijk/)
    expect(order).toMatch(/“Lopez, H\., Diaz[^”]*” should come before “Lopez, H\., & Garcia/)
    // One work listed twice is not to be ordered by its titles.
    expect(order).not.toMatch(/Reyes/)
    const apa = finding(r, 'references.apa').details?.join(' ') ?? ''
    expect(apa).toMatch(/Title the list “References”.*not “BIBLIOGRAPHY”/)
    expect(apa).toMatch(/Listed twice, it seems, with different details: “Reyes, D\. \(2021\)”/)
    expect(apa).not.toMatch(/add a, b after the year \(2021a/)
    expect(apa).toMatch(
      /add a, b after the year \(2019a, 2019b\).*found for: “Santos, S\. \(2019\)”/,
    )
  })

  it('finds chapters headed by their title alone, and still asks for the chapter label', async () => {
    const c = '<w:jc w:val="center"/>'
    const text =
      'The study looks at how community radio stations prepare their listeners for typhoons and floods.'
    const r = await check(
      'thesis.docx',
      docx(
        para('UNIVERSITY OF THE PHILIPPINES', c),
        para('OPEN UNIVERSITY', c),
        para('MASTER OF DEVELOPMENT COMMUNICATION', c),
        para('A STUDY OF COMMUNITY RADIO', c),
        para('Thesis Adviser:', c),
        para('Abstract', `<w:pageBreakBefore/>${c}`),
        para(text),
        para('I. INTRODUCTION', `<w:pageBreakBefore/>${c}`),
        para(text),
        para('REVIEW OF RELATED LITERATURE', `<w:pageBreakBefore/>${c}`),
        para(text),
      ),
      opts,
    )
    expect(finding(r, 'chapterStart.newPage')).toMatchObject({ status: 'ok' })
    const number = finding(r, 'chapterStart.number')
    expect(number.status).toBe('fix')
    expect(number.details?.join(' ')).toMatch(
      /“I\. INTRODUCTION”: the chapter number is missing.*“REVIEW OF RELATED LITERATURE”: the chapter number is missing \(write Chapter II/,
    )
  })

  it('compares titles without regard to case, a line-end hyphen or the period before a quote', async () => {
    const c = '<w:jc w:val="center"/>'
    const r = await check(
      'thesis.docx',
      docx(
        ...[
          'UNIVERSITY OF THE PHILIPPINES',
          'OPEN UNIVERSITY',
          'MASTER OF DEVELOPMENT COMMUNICATION',
          'Juan A. Cruz',
          'A SOCIO-CULTURAL STUDY OF RADIO',
          'Thesis Adviser:',
          'MARIA B. SANTOS, Ph.D.',
        ].map((t) => para(t, c)),
        para('Acceptance Page', `<w:pageBreakBefore/>${c}`),
        para(
          'This paper prepared by Juan A. Cruz with the title: “A socio- cultural study of radio.” is hereby accepted by the Faculty of Information and Communication Studies, U.P. Open University.',
        ),
      ),
      opts,
    )
    expect(finding(r, 'acceptance.title').status).toBe('ok')
  })

  it('leaves a table cell “Content” alone, and finds the degree left as “Course”, a lone NAME and DATE', async () => {
    const cell = (t: string) =>
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    const ok = await check('thesis.docx', thesis(cell('Content'), para('Body text.')), opts)
    expect(finding(ok, 'extra.placeholders').status).toBe('ok')
    const r = await check(
      'thesis.docx',
      thesis(
        para('accepted in partial fulfillment of the requirements for the degree Course.'),
        para('NAME'),
        para('Juan A. Cruz, DATE'),
      ),
      opts,
    )
    const f = finding(r, 'extra.placeholders')
    expect(f.status).toBe('fix')
    expect(f.details?.join(' ')).toMatch(/Course.*NAME.*DATE/)
  })

  it('finds the degree left as “Program” on a line of its own', async () => {
    const r = await check(
      'thesis.docx',
      thesis(
        para('accepted in partial fulfillment of the requirements for the degree'),
        para('Program.'),
      ),
      opts,
    )
    expect(finding(r, 'extra.placeholders').status).toBe('fix')
  })

  it('asks for a second look, not a correction, at a degree it does not know', async () => {
    const r = await check(
      'thesis.docx',
      docx(
        para('Acceptance Page', '<w:jc w:val="center"/>'),
        para(
          'This paper prepared by Juan A. Cruz with the title: “A study” is hereby accepted by the Faculty.',
        ),
        para('MARIA B. SANTOS, DrPH'),
        para('Chair, Thesis Committee'),
        para('JOSE C. REYES, Ph.D.'),
        para('Member, Thesis Committee'),
        para('ANA D. LIM, rDrPH'),
        para('Member, Thesis Committee'),
      ),
      opts,
    )
    expect(finding(r, 'acceptance.convention').status).toBe('review')
    expect(finding(r, 'acceptance.convention').message).toMatch(/ANA D\. LIM, rDrPH/)
  })

  it('fails a chapter in a continuous section, and appendices that begin at B', async () => {
    const c = '<w:jc w:val="center"/>'
    const r = await check(
      'thesis.docx',
      docxIn(
        '<w:sectPr><w:type w:val="continuous"/></w:sectPr>',
        para('A STUDY OF COMMUNITY RADIO', c),
        para('CHAPTER I', `<w:pageBreakBefore/>${c}`),
        para('INTRODUCTION', c),
        para('Body text of the first chapter.', '<w:sectPr/>'),
        para('CHAPTER II', c),
        para('REVIEW OF RELATED LITERATURE', c),
      ),
      opts,
    )
    expect(finding(r, 'chapterStart.newPage').status).toBe('fix')
    const back = await check(
      'thesis.docx',
      thesis(
        para('APPENDICES', c),
        para('APPENDIX B', `<w:pageBreakBefore/>${c}`),
        para('Survey Form', c),
      ),
      opts,
    )
    expect(finding(back, 'appendices.labels').status).toBe('fix')
  })

  it('reads an older title page (title first, then "Degree Doctor of …", "in the" Faculty) and committee names with dates beside them', async () => {
    const c = '<w:jc w:val="center"/>'
    const r = await check(
      'older.docx',
      docx(
        ...[
          'A STUDY OF COMMUNITY RADIO',
          'IN TWO TOWNS',
          'Juan A. Cruz',
          'Submitted in Partial Fulfillment of the Requirements for the',
          'Degree Doctor of Philosophy',
          '(Science Education)',
          'in the',
          'Faculty of Education',
          'University of the Philippines Open University',
        ].map((t) => para(t, c)),
        para('Acceptance Page', `<w:pageBreakBefore/>${c}`),
        para(
          'This dissertation titled “A STUDY OF COMMUNITY RADIO IN TWO TOWNS” prepared and submitted by Juan A. Cruz is hereby accepted.',
        ),
        para('DR. MARIA B. SANTOS'),
        para('(Date)'),
        para('Chair, Dissertation Committee'),
        para('DR. PEDRO C. REYES'),
        para('12 May 2026'),
        para('Member, Dissertation Committee'),
        para('CHAPTER I', `<w:pageBreakBefore/>${c}`),
        para('INTRODUCTION', c),
        para('Body text.'),
      ),
      opts,
    )
    expect(finding(r, 'acceptance.title').status).toBe('ok')
    expect(finding(r, 'title.sequence').details?.[0]).not.toMatch(/degree program/)
    expect(finding(r, 'acceptance.names').details?.join(' ') ?? '').not.toMatch(/blank/)
    // A year at a footer's end is no page number.
    expect(parseFolio('A STUDY OF RADIO Juan Cruz, 2020')).toMatchObject({ unreadNumber: true })
  })

  it('reads a bare “Adviser:”, a Faculty-in-Charge and the older permission wording', async () => {
    const c = '<w:jc w:val="center"/>'
    const page = (
      label: string,
      signature: string,
      program: string,
      statement = 'Permission of the classification of this academic work access is subject to the provisions of applicable laws:',
    ) =>
      check(
        'project.docx',
        docx(
          ...[
            'UNIVERSITY OF THE PHILIPPINES',
            'OPEN UNIVERSITY',
            program,
            'Juan A. Cruz',
            'A Study of Community Radio',
            label,
            'MARIA B. SANTOS, Ph.D.',
            'Faculty of Management and Development Studies',
            '12 May 2026',
            statement,
            'Invention (I) Yes or No',
            'Publication (P) Yes or No',
            'Confidential (C) Yes or No',
            'Free (F) Yes or No',
            "Student's signature:",
            signature,
          ].map((t) => para(t, c)),
          para('CHAPTER I', `<w:pageBreakBefore/>${c}`),
          para('INTRODUCTION', c),
        ),
        opts,
      )
    for (const label of ['Adviser:', 'Special Problem Faculty-in-Charge:']) {
      const r = await page(label, "Adviser's signature:", 'MASTER OF EDUCATION')
      expect(finding(r, 'title.adviser').message).not.toMatch(/write your/i)
      expect(finding(r, 'title.sequence')).toMatchObject({ status: 'ok' })
    }
    // The older template's statement: which wording a program takes is for the student to weigh.
    const older = await page(
      'Adviser:',
      "Adviser's signature:",
      'MASTER OF EDUCATION',
      'Permission is given for the following people to have access to this academic work:',
    )
    expect(finding(older, 'title.sequence')).toMatchObject({ status: 'review' })
    expect(finding(older, 'title.sequence').details?.join(' ')).toMatch(
      /which wording your program/,
    )
    // A label without its apostrophe: the template's wording, for the student to weigh in every
    // program (title pages of the MDC's own do not all keep it).
    const bare = await page('Adviser:', 'Adviser signature:', 'MASTER OF EDUCATION')
    expect(finding(bare, 'title.sequence')).toMatchObject({ status: 'review' })
    const mdc = await page('Adviser:', 'Adviser signature:', 'MASTER OF DEVELOPMENT COMMUNICATION')
    expect(finding(mdc, 'title.sequence')).toMatchObject({ status: 'review' })
    // Other programs' labels: a slash, a course code, two advisers, the faculty-in-charge's initials.
    for (const label of [
      'Special/Capstone Project Adviser:',
      'MMS 200 Adviser:',
      'Thesis Advisers:',
      'Thesis/Dissertation Adviser:',
    ]) {
      const r = await page(label, "Adviser's signature:", 'MASTER OF EDUCATION')
      expect(finding(r, 'title.adviser').message).not.toMatch(/write your/i)
      expect(finding(r, 'title.sequence').details?.join(' ') ?? '').not.toMatch(/Missing/)
    }
    const fic = await page(
      'Special Problem Faculty-in-Charge:',
      "FIC's signature:",
      'MASTER OF EDUCATION',
    )
    expect(finding(fic, 'title.sequence').details?.join(' ') ?? '').not.toMatch(/Missing/)
  })

  it('takes Ms., Mr. and Asst. Professor as titles, ignores “(candidate)” and a title’s closing quote ends it', async () => {
    const c = '<w:jc w:val="center"/>'
    const r = await check(
      'thesis.docx',
      docx(
        ...[
          'UNIVERSITY OF THE PHILIPPINES',
          'OPEN UNIVERSITY',
          'MASTER OF EDUCATION',
          'Juan A. Cruz',
          'A STUDY OF RADIO',
          'Thesis Adviser:',
          'Ms. Maria B. Santos',
        ].map((t) => para(t, c)),
        para('Acceptance Page', `<w:pageBreakBefore/>${c}`),
        para(
          'The graduate thesis attached hereto, entitled “A study of radio,” prepared and submitted by Juan A. Cruz, in partial fulfilment of the requirements for the degree, is hereby accepted.',
        ),
        para('Ms. Maria B. Santos'),
        para('Adviser'),
        para('ASST. PROFESSOR Ana D. Lim'),
        para('Member'),
        para('Mr. Jose C. Reyes (candidate)'),
        para('Member'),
      ),
      opts,
    )
    expect(finding(r, 'acceptance.title')).toMatchObject({ status: 'ok' })
    expect(finding(r, 'acceptance.convention').message).toMatch(/All names use titles/)
  })

  it('leaves a scan’s misread letters in a title or a name for review', async () => {
    const c = '<w:jc w:val="center"/>'
    const r = await check(
      'thesis.docx',
      docx(
        ...[
          'UNIVERSITY OF THE PHILIPPINES',
          'OPEN UNIVERSITY',
          'MASTER OF EDUCATION',
          'Juan A. Cruz',
          'TEACHING IN LARGE CLASSES',
          'Thesis Adviser:',
          'MARIA B. SANTOS, PhD',
        ].map((t) => para(t, c)),
        para('Acceptance Page', `<w:pageBreakBefore/>${c}`),
        para(
          'The thesis attached hereto, entitled “Teaching in Large Gasses,” prepared and submitted by Juan A. Cruz, is hereby accepted.',
        ),
        para('MARIA B. SAiNTOS, PhD'),
        para('Adviser'),
      ),
      opts,
    )
    expect(finding(r, 'acceptance.title')).toMatchObject({ status: 'review' })
    expect(finding(r, 'title.adviser')).toMatchObject({ status: 'review' })
  })

  it('takes the Certificate of Acceptance over an Approval Sheet, and an older access list with one “Yes” for review', async () => {
    const c = '<w:jc w:val="center"/>'
    const r = await check(
      'thesis.docx',
      docx(
        ...[
          'UNIVERSITY OF THE PHILIPPINES',
          'OPEN UNIVERSITY',
          'MASTER OF EDUCATION',
          'Juan A. Cruz',
          'A STUDY OF RADIO',
          'Thesis Adviser:',
          'Dr. Maria B. Santos',
        ].map((t) => para(t, c)),
        para('Permission is given for the following people to have access to this thesis:'),
        para('Available to the general public\tYes'),
        para('Available only after consultation with author and thesis adviser\tNo'),
        para('Available only to those bound by confidentiality agreement\tNo'),
        para('APPROVAL SHEET', `<w:pageBreakBefore/>${c}`),
        para(
          'We, the members of the panel, approved the thesis entitled “A study of radio.” The thesis attached hereto is hereby accepted.',
        ),
        para('Prof. Jose C. Reyes, PhD'),
        para('Member'),
        para('CERTIFICATE OF ACCEPTANCE OFTHESIS', `<w:pageBreakBefore/>${c}`),
        para(
          'The thesis attached hereto, entitled “A study of radio,” prepared and submitted by Juan A. Cruz, in partial fulfilment of the requirements for the degree, is hereby accepted.',
        ),
        para('Dr. Maria B. Santos'),
        para('Adviser'),
        para('Dr. Ana D. Lim'),
        para('Dean'),
      ),
      opts,
    )
    expect(finding(r, 'acceptance.title')).toMatchObject({ status: 'ok' })
    expect(finding(r, 'acceptance.convention').message).toMatch(/All names use titles/)
    expect(finding(r, 'title.permission')).toMatchObject({ status: 'review' })
  })

  it('does not take a lettered section for a chapter, nor a special problem’s sections for an error', async () => {
    const c = '<w:jc w:val="center"/>'
    const text =
      'The study looks at how community radio stations prepare their listeners for typhoons and floods.'
    const body = [
      para('Abstract', `<w:pageBreakBefore/>${c}`),
      para('Keywords: community radio'),
      para('I. INTRODUCTION', `<w:pageBreakBefore/>${c}`),
      para(text),
      para('C. REVIEW OF LITERATURE', `<w:pageBreakBefore/>${c}`),
      para(text),
      para('II. METHODOLOGY', `<w:pageBreakBefore/>${c}`),
      para(text),
    ]
    const title = (label: string, program = 'MASTER OF EDUCATION') =>
      [
        'UNIVERSITY OF THE PHILIPPINES',
        'OPEN UNIVERSITY',
        program,
        'Juan A. Cruz',
        'A STUDY OF RADIO',
        label,
        'MARIA B. SANTOS, Ph.D.',
      ].map((t) => para(t, c))
    const thesisPaper = await check(
      'x.docx',
      docx(...title('Thesis Adviser:', 'MASTER OF DEVELOPMENT COMMUNICATION'), ...body),
      opts,
    )
    const number = finding(thesisPaper, 'chapterStart.number')
    expect(number.status).toBe('fix')
    expect(number.details?.join(' ')).not.toMatch(/“C\./)
    expect(number.details?.join(' ')).toMatch(/“II\. METHODOLOGY”.*Chapter II/)
    const special = await check(
      'x.docx',
      docx(...title('Special Problem Faculty-in-Charge:'), ...body),
      opts,
    )
    // (a special problem may number its sections: for review; a thesis in any program: a fix)
    expect(finding(special, 'chapterStart.number').status).toBe('review')
    const other = await check('x.docx', docx(...title('Thesis Adviser:'), ...body), opts)
    expect(finding(other, 'chapterStart.number').status).toBe('fix')
    expect(finding(other, 'chapterStart.title').status).toBe('fix')
    const unnamed = await check('x.docx', docx(...title('Adviser:'), ...body), opts)
    expect(finding(unnamed, 'chapterStart.number').status).toBe('review')
  })

  it('numbers figures by chapter (2.1, 2.2, then 3), takes “Chart S1:” and finds Annex among Appendix', async () => {
    const r = await check(
      'thesis.docx',
      thesis(
        para('Figure 1. First'),
        para('Figure 2.1. Second'),
        para('Figure 2.2. Third'),
        para('Figure 3. Fourth'),
        para('Chart S1: Fifth'),
        para('Table 3 .1 Sixth'),
        para('APPENDICES', '<w:jc w:val="center"/>'),
        para('ANNEX A', '<w:pageBreakBefore/><w:jc w:val="center"/>'),
        para('Survey Form', '<w:jc w:val="center"/>'),
        para('APPENDIX B', '<w:pageBreakBefore/><w:jc w:val="center"/>'),
        para('Interview Guide', '<w:jc w:val="center"/>'),
      ),
      opts,
    )
    expect(finding(r, 'figures.apa').details?.join(' ') ?? '').not.toMatch(/in order/)
    // (which word a program uses is for the student to weigh, except in the MDC's own)
    const labels = finding(r, 'appendices.labels')
    expect(labels.status).toBe('review')
    expect(labels.details?.join(' ') + labels.message).toMatch(/Annex/)
    const c = '<w:jc w:val="center"/>'
    const mdc = await check(
      'thesis.docx',
      docx(
        ...[
          'UNIVERSITY OF THE PHILIPPINES',
          'OPEN UNIVERSITY',
          'MASTER OF DEVELOPMENT COMMUNICATION',
          'Juan A. Cruz',
          'A STUDY OF COMMUNITY RADIO',
        ].map((t) => para(t, c)),
        para('CHAPTER I', `<w:pageBreakBefore/>${c}`),
        para('INTRODUCTION', c),
        para('APPENDICES', c),
        para('ANNEX A', `<w:pageBreakBefore/>${c}`),
        para('Survey Form', c),
        para('APPENDIX B', `<w:pageBreakBefore/>${c}`),
        para('Interview Guide', c),
      ),
      opts,
    )
    expect(finding(mdc, 'appendices.labels').status).toBe('fix')
    const jumbled = await check(
      'thesis.docx',
      thesis(para('Figure 1. First'), para('Figure 3. Second'), para('Figure 4. Third')),
      opts,
    )
    expect(finding(jumbled, 'figures.apa').details?.join(' ')).toMatch(/not numbered in order/)
  })

  it('checks the APA setup of figures and tables: title case, flush left, notes, table lines', async () => {
    expect(titleCase('Profile of Respondents According to Age')).toBeUndefined()
    expect(titleCase('Abundance of Oryza sativa in Two Sites')).toBeUndefined()
    expect(titleCase('Profile of the respondents')).toBe('sentence')
    expect(titleCase('DISTRIBUTION OF RESPONDENTS')).toBe('caps')
    const cell = (t: string) => `<w:tc>${para(t)}</w:tc>`
    const table = (borders: string) =>
      `<w:tbl><w:tblPr><w:tblBorders>${borders}</w:tblBorders></w:tblPr><w:tr>${cell('Age')}${cell('Count')}</w:tr></w:tbl>`
    const r = await check(
      'thesis.docx',
      thesis(
        para('Table 1'),
        para('Profile of the respondents by age group'),
        table('<w:insideV w:val="single"/>'),
        para('Note: Counts from the survey.'),
        para('Figure 1', '<w:jc w:val="center"/>'),
        para('A Map of the Study Area', '<w:jc w:val="center"/>'),
      ),
      opts,
    )
    const apa = finding(r, 'figures.apa')
    expect(apa.status).toBe('fix')
    const d = apa.details?.join(' ') ?? ''
    expect(d).toMatch(/title case.*: Table 1 \(“Profile/)
    expect(d).toMatch(/centred.*: Figure 1/)
    expect(d).toMatch(/“Note:”.*Table 1/)
    expect(d).toMatch(/vertical lines.*: Table 1/)
    const good = await check(
      'thesis.docx',
      thesis(
        para('Table 1 gives the ages.'),
        para('Table 1'),
        para('Profile of the Respondents by Age Group'),
        table('<w:insideH w:val="single"/><w:insideV w:val="nil"/>'),
        `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Note.</w:t></w:r><w:r><w:t xml:space="preserve"> Counts from the survey.</w:t></w:r></w:p>`,
      ),
      opts,
    )
    expect(finding(good, 'figures.apa').details ?? []).toEqual([])
  })

  it('checks that each table is called out in the text and its notes stand below it, general first', async () => {
    const cell = (t: string) => `<w:tc>${para(t)}</w:tc>`
    const table = `<w:tbl><w:tr>${cell('Age')}${cell('Count')}</w:tr></w:tbl>`
    const note = (t: string) =>
      `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Note.</w:t></w:r><w:r><w:t xml:space="preserve"> ${t}</w:t></w:r></w:p>`
    const r = await check(
      'thesis.docx',
      thesis(
        para('The ages of the members are in Tables 1–2.'),
        para('Table 1'),
        para('Members of the Garden Club by Age'),
        table,
        para('*p &lt; .05.'),
        note('Counts from the club roll.'),
        para('Table 2'),
        para('Members of the Garden Club by Town'),
        note('Counts from the club roll.'),
        table,
        para('Table 3'),
        para('Visits to the Garden by Month'),
        table,
      ),
      opts,
    )
    const d = finding(r, 'figures.apa').details?.join(' ') ?? ''
    expect(d).toMatch(/Probability note.*: Table 1 /)
    expect(d).toMatch(/Note above.*: Table 2 /)
    expect(d).toMatch(/Not mentioned in the text.*: Table 3\./)
    expect(d).not.toMatch(/Not mentioned in the text.*Table [12]/)
  })

  it('leaves a missing biographical sketch and dedication to the student outside the MDC', async () => {
    const c = '<w:jc w:val="center"/>'
    const book = (program: string) =>
      check(
        'thesis.docx',
        docx(
          ...['UNIVERSITY OF THE PHILIPPINES', 'OPEN UNIVERSITY', program, 'Juan A. Cruz'].map(
            (t) => para(t, c),
          ),
          para('Acknowledgment', `<w:pageBreakBefore/>${c}`),
          para('Table of Contents', `<w:pageBreakBefore/>${c}`),
          para('Abstract', `<w:pageBreakBefore/>${c}`),
          para('Keywords: community radio'),
          para('CHAPTER I', `<w:pageBreakBefore/>${c}`),
          para('INTRODUCTION', c),
        ),
        opts,
      )
    expect(finding(await book('MASTER OF EDUCATION'), 'prelims.present').status).toBe('review')
    expect(
      finding(await book('MASTER OF DEVELOPMENT COMMUNICATION'), 'prelims.present').status,
    ).toBe('fix')
  })

  it('finds chapters by the contents, “II .”, a numbered references heading and plural appendix labels', async () => {
    const c = '<w:jc w:val="center"/>'
    const text =
      'The study looks at how community radio stations prepare their listeners for typhoons and floods.'
    const entry = (t: string, n: number) => para(`${t}\t${n}`)
    const r = await check(
      'special-problem.docx',
      docx(
        ...[
          'UNIVERSITY OF THE PHILIPPINES',
          'OPEN UNIVERSITY',
          'MASTER OF EDUCATION',
          'Juan A. Cruz',
          'A STUDY OF RADIO',
          'Special Problem Adviser:',
          'MARIA B. SANTOS, Ph.D.',
        ].map((t) => para(t, c)),
        para('Acknowledgment', `<w:pageBreakBefore/>${c}`),
        para('Table of Contents', `<w:pageBreakBefore/>${c}`),
        entry('I. INTRODUCTION', 1),
        entry('II. REVIEW OF LITERATURE', 3),
        entry('III. METHODOLOGY', 5),
        entry('IV. RESULTS', 7),
        entry('V. REFERENCES', 9),
        para('Abstract', `<w:pageBreakBefore/>${c}`),
        para('Keywords: community radio'),
        para('I. INTRODUCTION', `<w:pageBreakBefore/>${c}`),
        para(text),
        para('II . REVIEW OF LITERATURE', `<w:pageBreakBefore/>${c}`),
        para(text),
        para('III. METHODOLOGY', c),
        para(text),
        para('IV. RESULTS', `<w:pageBreakBefore/>${c}`),
        para(text),
        para('V. REFERENCES', `<w:pageBreakBefore/>${c}`),
        para('Cruz, J. (2020). Radio. Press.'),
        para('Appendices A: Survey Form', `<w:pageBreakBefore/>${c}`),
        para('Appendices B: Interview Guide', `<w:pageBreakBefore/>${c}`),
      ),
      opts,
    )
    // All four chapters are found (III follows its text with no break: one is not on a new page).
    expect(finding(r, 'chapterStart.newPage').details?.join(' ')).toMatch(/III\. METHODOLOGY/)
    expect(finding(r, 'chapterStart.newPage').details?.join(' ')).not.toMatch(/REVIEW/)
    // “V. REFERENCES” is the list, not a fifth chapter, and its numbering is for the student to weigh.
    expect(finding(r, 'references.order').status).not.toBe('fix')
    expect(finding(r, 'references.apa').details?.join(' ')).toMatch(
      /numbered “V\. REFERENCES”|reads “V\. REFERENCES”/,
    )
    expect(finding(r, 'references.apa').details?.join(' ')).not.toMatch(/Title the list/)
    expect(finding(r, 'appendices.labels').message).not.toMatch(/No appendices|Label each/)
  })

  it('reads a title line above a name, “title:” on the acceptance page and “Name and Date” left over', async () => {
    const c = '<w:jc w:val="center"/>'
    const r = await check(
      'thesis.docx',
      docx(
        ...[
          'UNIVERSITY OF THE PHILIPPINES',
          'OPEN UNIVERSITY',
          'MASTER OF EDUCATION',
          'Juan A. Cruz',
          'A STUDY OF RADIO',
          'Thesis Adviser:',
          'MARIA B. SANTOS',
        ].map((t) => para(t, c)),
        para('University Permission Page', `<w:pageBreakBefore/>${c}`),
        para('A STUDY OF RADIO', c),
        para('Specifically, I grant the following rights to the University: …'),
        para('Name and Date'),
        para('Signature over Student Name and Date'),
        para('Acceptance Page', `<w:pageBreakBefore/>${c}`),
        para(
          'This thesis of Juan A. Cruz title: “A study of radio” is hereby accepted by the Faculty.',
        ),
        para('ASSISTANT PROFESSOR'),
        para('MARIA B. SANTOS'),
        para('Adviser'),
        para('DR. ANA D. LIM'),
        para('Member'),
      ),
      opts,
    )
    expect(finding(r, 'acceptance.title')).toMatchObject({ status: 'ok' })
    expect(finding(r, 'acceptance.convention').message).toMatch(/All names use titles/)
    expect(finding(r, 'extra.placeholders').details?.join(' ')).toMatch(/Name and Date/)
  })

  it('finds “I specifically allow” in a re-encoded font, and passes no statement on a page it cannot read', async () => {
    const statement = (...lines: string[]) =>
      check(
        'thesis.docx',
        docx(
          para('UNIVERSITY OF THE PHILIPPINES'),
          para('A STUDY OF RADIO'),
          para('University Permission Page', '<w:pageBreakBefore/>'),
          para('A STUDY OF RADIO'),
          ...lines.map((t) => para(t)),
          para('Signature over Student Name and Date'),
        ),
        opts,
      )
    const grant = 'Specifically, I grant the following rights to the University:'
    const shifted = await statement('“I VSHcLILcaOO\\ aOORZ WKH UQLYHUVLW\\ WR:', grant)
    expect(finding(shifted, 'permission.statement').status).toBe('fix')
    const unread = await statement(grant, 'c. GLYH RSHQ accHVV WR WKH ZRUN')
    expect(finding(unread, 'permission.statement').status).toBe('review')
    expect(finding(await statement(grant), 'permission.statement').status).toBe('ok')
  })

  it('leaves bare committee names, or ranks beside the Dean’s degree, to the student', async () => {
    const c = '<w:jc w:val="center"/>'
    const names = (...lines: string[]) =>
      check(
        'thesis.docx',
        docx(
          ...[
            'UNIVERSITY OF THE PHILIPPINES',
            'MASTER OF EDUCATION',
            'Juan A. Cruz',
            'A STUDY OF RADIO',
          ].map((t) => para(t, c)),
          para('Acceptance Page', '<w:pageBreakBefore/>' + c),
          para(
            'This thesis of Juan A. Cruz title: “A study of radio” is hereby accepted by the Faculty.',
          ),
          ...lines.map((t) => para(t)),
        ),
        opts,
      )
    // Bare names, the Dean's line with a degree after it: the Dean's line is the template's.
    const bare = await names(
      'MARIA B. SANTOS',
      'Adviser',
      'ANA D. LIM',
      'Member',
      'JOSE R. REYES, DProfSt',
      'Dean',
    )
    expect(finding(bare, 'acceptance.convention').status).toBe('review')
    // Titles of rank on the committee, a degree after the Dean's name.
    const rank = await names(
      'ASST. PROF. MARIA B. SANTOS',
      'Adviser',
      'ASSOC. PROF. ANA D. LIM',
      'Member',
      'JOSE R. REYES, DProfSt',
      'Dean',
    )
    expect(finding(rank, 'acceptance.convention').status).toBe('review')
    // “Dr.” with a degree after another name is a real mix.
    const mix = await names(
      'DR. MARIA B. SANTOS',
      'Adviser',
      'DR. ANA D. LIM',
      'Member',
      'JOSE R. REYES, Ph.D.',
      'Dean',
    )
    expect(finding(mix, 'acceptance.convention').status).toBe('fix')
    // One degree written two ways on the committee is a mix to make uniform.
    const twoWays = await names(
      'MARIA B. SANTOS, Ph.D.',
      'Adviser',
      'ANA D. LIM, PhD',
      'Member',
      'JOSE R. REYES, Ph.D.',
      'Dean',
    )
    expect(finding(twoWays, 'acceptance.convention').status).toBe('fix')
    // Only the Dean's line (the template's) writes it the other way: the student looks.
    const deanWay = await names(
      'MARIA B. SANTOS, Ph.D.',
      'Adviser',
      'ANA D. LIM, Ph.D.',
      'Member',
      'JOSE R. REYES, PhD',
      'Dean',
    )
    expect(finding(deanWay, 'acceptance.convention').status).toBe('review')
    // A committee member bare beside members with a degree: a mix.
    const oneBare = await names(
      'MARIA B. SANTOS',
      'Adviser',
      'ANA D. LIM, Ph.D.',
      'Member',
      'JOSE R. REYES, DProfSt',
      'Dean',
    )
    expect(finding(oneBare, 'acceptance.convention').status).toBe('fix')
  })

  it('accepts the list headings written “LISTS OF FIGURES” or “List of Table”, with a note', async () => {
    const c = '<w:jc w:val="center"/>'
    const r = await check(
      'thesis.docx',
      docx(
        ...['UNIVERSITY OF THE PHILIPPINES', 'OPEN UNIVERSITY', 'MASTER OF EDUCATION'].map((t) =>
          para(t, c),
        ),
        para('Abstract', `<w:pageBreakBefore/>${c}`),
        para('Keywords: radio'),
        para('LISTS OF FIGURES', `<w:pageBreakBefore/>${c}`),
        para('List of Table', `<w:pageBreakBefore/>${c}`),
        para('CHAPTER I', `<w:pageBreakBefore/>${c}`),
        para('INTRODUCTION', c),
        para('Figure 1. First'),
        para('Table 1. Second'),
      ),
      opts,
    )
    const present = finding(r, 'prelims.present')
    expect((present.details ?? []).concat(present.message).join(' ')).not.toMatch(
      /missing preliminary pages: .*List of/,
    )
    expect((present.details ?? []).concat(present.message).join(' ')).toMatch(/not worded as/)
  })

  it('reads “List ofTables” (words glued) and “AUTHOR’S BIOGRAPHICAL SKETCH” as their pages', async () => {
    const c = '<w:jc w:val="center"/>'
    const r = await check(
      'thesis.docx',
      docx(
        ...['UNIVERSITY OF THE PHILIPPINES', 'OPEN UNIVERSITY', 'MASTER OF EDUCATION'].map((t) =>
          para(t, c),
        ),
        para('AUTHOR’S BIOGRAPHICAL SKETCH', `<w:pageBreakBefore/>${c}`),
        para('List ofTables', `<w:pageBreakBefore/>${c}`),
        para('Abstract', `<w:pageBreakBefore/>${c}`),
        para('Keywords: radio'),
        para('CHAPTER I', `<w:pageBreakBefore/>${c}`),
        para('INTRODUCTION', c),
        para('Table 1. Second'),
      ),
      opts,
    )
    const present = finding(r, 'prelims.present')
    const all = (present.details ?? []).concat(present.message).join(' ')
    expect(all).not.toMatch(/List of Tables|Biographical Sketch/)
  })

  it('stays fast on long runs of spaces and tabs', async () => {
    // These once made two patterns backtrack for minutes, freezing the page.
    const t0 = performance.now()
    await check(
      'thesis.docx',
      thesis(para(`a${' '.repeat(20000)}b`), para(`Name${'\t'.repeat(20000)}`), para('Dean')),
      opts,
    )
    expect(performance.now() - t0).toBeLessThan(2000)
  })

  it('turns away files it cannot read, saying why', async () => {
    expect(() => sniff('notes.txt', strToU8('hello'))).toThrow(FileProblem)
    expect(() => sniff('thesis.gdoc', strToU8('{"url":""}'))).toThrow(/link to Google Docs/)
    expect(() => sniff('a.zip', zipSync({ 'a.txt': strToU8('a') }))).toThrow(/not a Word/)
    await expect(check('empty.docx', new Uint8Array(), opts)).rejects.toThrow('empty')
  })
})

describe('PDF reader', () => {
  // Four pages of body text with a small running title above the page number, set higher than
  // the bottom inch, and a ruled table on the last page.
  async function pdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const text =
      'Body text of the chapter, set in twelve point type, with its words across the page.'
    for (let n = 0; n < 4; n++) {
      const page = doc.addPage([612, 792])
      for (let y = 720; y > 200; y -= 27.6)
        if (n < 3 || y < 540 || y > 620) page.drawText(text, { x: 72, y, size: 12, font })
      page.drawText('A Running Title Set Above The Page Number', { x: 72, y: 84, size: 8, font })
      page.drawText(String(n + 1), { x: 530, y: 51, size: 11, font })
    }
    const last = doc.getPage(3)
    for (const y of [610, 550])
      last.drawLine({ start: { x: 72, y }, end: { x: 540, y }, thickness: 0.75 })
    last.drawText('Cell one', { x: 80, y: 575, size: 12, font })
    last.drawText('Cell two', { x: 320, y: 575, size: 12, font })
    return doc.save()
  }

  it('reads a running title above the bottom inch as the footer, and a ruled table as one', async () => {
    const { readPdf } = await import('./pdf.ts')
    const doc = await readPdf(await pdf(), await import('pdfjs-dist/legacy/build/pdf.mjs'))
    expect(doc.pages!.map((p) => p.footer)).toEqual(
      [1, 2, 3, 4].map((n) => `A Running Title Set Above The Page Number\n${n}`),
    )
    expect(doc.paras.filter((p) => /Running Title/.test(p.text))).toEqual([])
    expect(doc.paras.filter((p) => p.inTable).map((p) => p.text)).toEqual(['Cell one\tCell two'])
  })

  it('reads a bare page number under double-spaced text, higher than the bottom inch, as the footer', async () => {
    const { readPdf } = await import('./pdf.ts')
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    // Lines that differ from page to page, or they read as a running foot.
    const WORDS =
      'ant bee cat dog eel fox gnu hen ibis jay koi lynx mole newt owl pig quail rat seal toad urchin vole wasp yak'.split(
        ' ',
      )
    for (let n = 0; n < 3; n++) {
      const page = doc.addPage([595, 842])
      // Lines 27.6 pt apart, the last 107 pt from the foot; the number 79 pt up, one more line down.
      for (let k = 0; k < 24; k++)
        page.drawText(
          `Body text of the chapter, ${WORDS[k]} and ${WORDS[(k + 7 * n) % 24]}, across.`,
          {
            x: 72,
            y: 106.6 + 27.6 * k,
            size: 12,
            font,
          },
        )
      page.drawText(String(n + 1), { x: 510, y: 79, size: 12, font })
    }
    const read = await readPdf(await doc.save(), await import('pdfjs-dist/legacy/build/pdf.mjs'))
    expect(read.pages!.map((p) => p.footer)).toEqual(['1', '2', '3'])
    expect(read.paras.filter((p) => /^\d$/.test(p.text))).toEqual([])
  })

  it('reports a picture in a chapter with no caption beside it', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const picture = await doc.embedPng(png(40, 30))
    const text =
      'Body text of the chapter, set in twelve point type, with its words across the page.'
    for (let n = 0; n < 2; n++) {
      const page = doc.addPage([612, 792])
      if (n === 0) {
        page.drawText('Chapter I', { x: 280, y: 720, size: 12, font: bold })
        page.drawText('INTRODUCTION', { x: 262, y: 692, size: 12, font: bold })
      }
      for (let y = n ? 720 : 650; y > 400; y -= 27.6)
        page.drawText(text, { x: 72, y, size: 12, font })
      if (n === 1) page.drawImage(picture, { x: 200, y: 150, width: 200, height: 150 })
    }
    const r = await check('thesis.pdf', await doc.save(), {
      pdfjs: () => import('pdfjs-dist/legacy/build/pdf.mjs'),
    })
    expect(finding(r, 'figures.number').status).toBe('fix')
    expect(finding(r, 'figures.number').details).toEqual(['a picture on p.\u00a02'])
  })
})

/** A small grey PNG. */
function png(w: number, h: number): Uint8Array {
  const crc = (b: Uint8Array) => {
    let c = -1
    for (const x of b) {
      c ^= x
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(strToU8(type), 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
    return out
  }
  const head = new Uint8Array(13)
  new DataView(head.buffer).setUint32(0, w)
  new DataView(head.buffer).setUint32(4, h)
  head[8] = 8 // 8-bit grey
  const rows = new Uint8Array(h * (w + 1)).fill(128)
  for (let y = 0; y < h; y++) rows[y * (w + 1)] = 0 // each row: filter "none"
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', zlibSync(rows)),
    chunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
  return out
}

describe('Word comments', () => {
  it('stay valid XML whatever the file name holds', async () => {
    const name = 'Thesis <final> & "v2"\u0001\u0008.docx'
    const r = await check(name, thesis(para('Body text.')), opts)
    const xml = strFromU8(unzipSync(reportDocx(reportModel(r)))['word/document.xml'])
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(doc.documentElement.textContent).toContain('Thesis <final> & "v2".docx')
  })
})

describe('consistency guard', () => {
  const ctxOf = (paras: unknown[], footers: string[] = [], chapters: unknown[] = []) =>
    ({
      doc: {
        kind: 'pdf',
        paras,
        notes: [],
        pages: footers.map((footer, n) => ({
          n,
          footer,
          footerLines: [],
          header: '',
          paras: [],
          images: [],
        })),
      },
      s: { chapters, appendices: [] },
      env: {},
    }) as unknown as Ctx
  const fixOn = (id: string, details: string[], where?: { page: number; quote: string }[]) => ({
    id,
    status: 'fix' as const,
    message: 'Fix it.',
    details,
    where,
  })

  it('reads an ellipsis inside the closing quotation mark of a footer', () => {
    expect(parseFolio('“A Study of Radio…” 12')).toMatchObject({ ellipsis: true, number: '12' })
    expect(parseFolio('A Study of Radio 12')).toMatchObject({ ellipsis: false })
  })

  it('splits a page number run into a two-letter last word of the footer', () => {
    const words = new Set(['study', 'of', 'radio', 'at'])
    expect(parseFolio('A Study of Radio at100', words)).toMatchObject({
      title: 'A Study of Radio at',
      number: '100',
    })
  })

  it('tells a scan-misread footer title from a changed one', () => {
    expect(garbledVariant('Le4rning in Ra:dio Schools', 'Learning in Radio Schools')).toBe(true)
    expect(garbledVariant('Teaching in Radio Schools', 'Learning in Radio Schools')).toBe(false)
  })

  it('turns findings that rest on scanned pages with a machine-read text layer to review', () => {
    const ctx = {
      doc: {
        kind: 'pdf',
        paras: [{ i: 0, page: 0, text: 'A', runs: [] }],
        notes: [],
        pages: [0, 1, 2].map((n) => ({
          n,
          paras: [],
          width: 600,
          height: 800,
          footer: '',
          footerLines: [],
          images: [],
          ocr: n > 0,
        })),
      },
      s: { chapters: [], appendices: [], title: { start: 0, end: 1 } },
      env: {},
    } as unknown as Ctx
    const out = guard(ctx, [
      fixOn('chapterStart.number', ['Use bold Arial 14 pt'], [{ page: 1, quote: 'CHAPTER I' }]),
      fixOn('body.justified', ['p. 3'], [{ page: 2, quote: 'Text…' }]),
      fixOn('title.signature', ['x'], [{ page: 0, quote: 'A' }]),
      { id: 'body.spacing', status: 'ok' as const, message: 'Double-spaced.' },
    ])
    expect(out.map((f) => f.status)).toEqual(['review', 'review', 'fix', 'review'])
    expect(out[0].details).toBeUndefined()
  })

  it('gives no pass over a manuscript whose pages are partly scanned pictures', () => {
    const ctx = (scans: number) =>
      ({
        doc: {
          kind: 'pdf',
          paras: [{ i: 0, page: 0, text: 'A', runs: [] }],
          notes: [],
          pages: Array.from({ length: 10 }, (_, n) => ({
            n,
            paras: n ? [] : [0],
            width: 600,
            height: 800,
            footer: '',
            footerLines: [],
            images: n >= 10 - scans ? [{ x0: 0, y0: 0, x1: 600, y1: 800 }] : [],
          })),
        },
        s: { chapters: [], appendices: [], title: { start: 0, end: 1 } },
        env: {},
      }) as unknown as Ctx
    const found = [
      { id: 'extra.blankPages', status: 'ok' as const, message: 'No blank pages.' },
      { id: 'body.hanging', status: 'ok' as const, message: 'No hanging headings.' },
      { id: 'permission.statement', status: 'ok' as const, message: 'Statement as template.' },
    ]
    expect(guard(ctx(3), found).map((f) => f.status)).toEqual(['review', 'review', 'ok'])
    expect(guard(ctx(1), found).map((f) => f.status)).toEqual(['ok', 'ok', 'ok'])
    // (pages whose letters are drawn as outlines, no text and no picture, are unread too)
    const glyph = (k: number) => ({
      x0: k,
      y0: 100,
      x1: k + 6,
      y1: 108,
      kind: 'path',
      fill: '#000000',
    })
    const drawn = ctx(0)
    for (const pg of drawn.doc.pages!.slice(7))
      pg.marks = Array.from({ length: 40 }, (_, k) => glyph(10 * k))
    expect(guard(drawn, found).map((f) => f.status)).toEqual(['review', 'review', 'ok'])
    // (a title that matches a Title Page that is a scan matched the scan's guess)
    const scannedTitle = ctx(0)
    scannedTitle.doc.pages![0].images = [{ x0: 0, y0: 0, x1: 600, y1: 800 }]
    const same = { id: 'permission.title', status: 'ok' as const, message: 'Matches.' }
    expect(guard(scannedTitle, [same])[0].status).toBe('review')
  })

  it('takes no sentence opening with “Chapter two” for a chapter heading', async () => {
    const r = await check(
      'thesis.docx',
      thesis(
        para('Chapter two reviews the studies on radio listening.', '<w:jc w:val="center"/>'),
        para('Body text.'),
      ),
      opts,
    )
    expect(finding(r, 'chapterStart.number').details?.join(' ') ?? '').not.toContain('two')
  })

  it('turns a footer claim the footers contradict to review, and keeps a uniform real fault', () => {
    const claim = ['No ellipsis (…) after the shortened title on pp. 2–5']
    const odd = ctxOf([], ['A Study… of Radio 2', 'A Study… of Radio 3', 'A Study… of Radio 4'])
    const [f] = guard(odd, [fixOn('body.pageNumbers', claim)])
    expect(f.status).toBe('review')
    expect(f.message).toContain(MISREAD)
    const plain = ctxOf([], ['A Study of Radio 2', 'A Study of Radio 3', 'A Study of Radio 4'])
    expect(guard(plain, [fixOn('body.pageNumbers', claim)])[0].status).toBe('fix')
    // (a footer item with another claim besides keeps its fix)
    const mixed = [...claim, 'p. 3: shows 4; it should be 3']
    expect(guard(odd, [fixOn('body.pageNumbers', mixed)])[0].status).toBe('fix')
  })

  it('turns findings of several items that rest on one line of running text to review', () => {
    const text = `Chapter two reviews ${'the studies of radio listening in towns '.repeat(5)}.`
    const p = { i: 0, page: 4, text, lines: [{}, {}, {}], runs: [] }
    const where = [{ page: 4, quote: 'Chapter two reviews the studies of…' }]
    const ids = ['chapterStart.newPage', 'chapterStart.number', 'chapterStart.title']
    const out = guard(ctxOf([p], [], [{ heading: 0 }]), [
      ...ids.map((id) => fixOn(id, ['x'], where)),
      fixOn('body.justified', ['y'], [{ page: 9, quote: 'Other text…' }]),
    ])
    expect(out.map((f) => f.status)).toEqual(['review', 'review', 'review', 'fix'])
    // (a short bold heading is no running text: its faults stand)
    const head = { i: 0, page: 4, text: 'Chapter 2', lines: [{}], runs: [] }
    const kept = guard(ctxOf([head], [], [{ heading: 0 }]), [
      ...ids.map((id) => fixOn(id, ['x'], [{ page: 4, quote: 'Chapter 2' }])),
    ])
    expect(kept.map((f) => f.status)).toEqual(['fix', 'fix', 'fix'])
  })
})

describe('evidence strength', () => {
  const line = (y: number, x1: number) => ({
    page: 0,
    y,
    x0: 72,
    x1,
    size: 12,
    text: 'w',
    runs: [],
    spans: [],
  })
  // PDF paragraphs of running text, three lines each: `ragged` of them left-aligned.
  const pdfCtx = (n: number, ragged: number, spacing = 2) =>
    ({
      doc: {
        kind: 'pdf',
        pages: [{ n: 0, width: 612, height: 792, margins: { left: 72, right: 540 } }],
        paras: Array.from({ length: n }, (_, i) => ({
          i,
          page: 0,
          text: 'Some made-up running text that goes on for three lines and ends here.',
          runs: [{ text: 'Some made-up running text.' }],
          align: i < ragged ? 'left' : 'justify',
          spacing: i < ragged ? 1 : spacing,
          indent: { left: 0, firstLine: 0 },
          lines: [
            line(100, i < ragged ? 500 : 540),
            line(124, i < ragged ? 510 : 540),
            line(148, 300),
          ],
        })),
      },
    }) as unknown as Ctx

  it('weighs a finding: fix on strong evidence, a “Check:” review on weak', async () => {
    const { weigh } = await import('./report.ts')
    expect(weigh(true, 'x', 'Do it.', 'it may be so.').status).toBe('fix')
    const weak = weigh(false, 'x', 'Do it.', 'it may be so.')
    expect([weak.status, weak.message]).toEqual(['review', 'Check: it may be so.'])
  })

  it('reviews a few ragged PDF paragraphs among justified ones, fixes a large share', async () => {
    const { justified } = await import('./rules/body.ts')
    expect(
      justified(pdfCtx(40, 2), 'body.justified', pdfCtx(40, 2).doc.paras, 'the chapters').status,
    ).toBe('review')
    expect(
      justified(pdfCtx(40, 10), 'body.justified', pdfCtx(40, 10).doc.paras, 'the chapters').status,
    ).toBe('fix')
    // (two paragraphs whose lines end at many points short of the margin: ragged, firm evidence)
    const ctx = pdfCtx(40, 2)
    for (const p of ctx.doc.paras.slice(0, 2))
      p.lines = [500, 520, 490, 530, 300].map((x1, k) => line(100 + 24 * k, x1))
    expect(justified(ctx, 'body.justified', ctx.doc.paras, 'the chapters').status).toBe('fix')
  })

  it('fixes PDF spacing only on a clear single-spaced paragraph of running text', async () => {
    const { doubleSpaced } = await import('./rules/body.ts')
    const ctx = pdfCtx(40, 1)
    expect(doubleSpaced(ctx, 'body.spacing', ctx.doc.paras, 'the chapters').status).toBe('fix')
    // (the same paragraph in italics: a caption or note read as body text)
    ctx.doc.paras[0].runs = [{ text: 'Some made-up running text.', italic: true }]
    expect(doubleSpaced(ctx, 'body.spacing', ctx.doc.paras, 'the chapters').status).toBe('review')
  })
})
