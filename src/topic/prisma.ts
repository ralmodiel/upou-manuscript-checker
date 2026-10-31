// The PRISMA 2020 checklists in their own words: the 27 items (42 with their parts) of the main
// checklist and the 12 of PRISMA 2020 for Abstracts, as the PRISMA site publishes them under
// CC BY 4.0. The Topic planner shows them, drafts what it can, and writes them into the plan.

export interface PrismaItem {
  id: string
  section: string
  topic: string
  text: string
}

export const PRISMA_CITATION =
  'Page MJ, McKenzie JE, Bossuyt PM, Boutron I, Hoffmann TC, Mulrow CD, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. BMJ 2021;372:n71. doi:10.1136/bmj.n71'
export const PRISMA_LICENCE = 'https://creativecommons.org/licenses/by/4.0/'
export const PRISMA_SITE = 'https://www.prisma-statement.org/prisma-2020-checklist'
export const PRISMA_HOME = 'https://www.prisma-statement.org/'
export const PRISMA_FLOW = 'https://www.prisma-statement.org/prisma-2020-flow-diagram'
export const PRISMA_EXTENSIONS = 'https://www.prisma-statement.org/extensions'
export const PRISMA_SCOPING = 'https://www.prisma-statement.org/scoping'
export const PRISMA_ENDORSEMENT = 'https://www.prisma-statement.org/endorsement'
/** The PRISMA group's own checklist app, which fills the checklist in online. */
export const PRISMA_APP = 'https://prisma.shinyapps.io/checklist/'
/** What PRISMA asks those who endorse it to say (prisma-statement.org/endorsement), in this
 *  planner's words. */
export const ENDORSEMENT =
  'This planner follows the PRISMA 2020 statement. When you report a systematic review or meta-analysis, complete the PRISMA 2020 checklist and include a PRISMA flow diagram: templates for both are on the PRISMA website, which also describes PRISMA extensions for other designs and types of data (a scoping review reports with PRISMA-ScR). At minimum, your manuscript should report the content addressed by each item of the checklist; meeting these basic reporting requirements greatly improves the value of your review and may improve its chances of publication.'

const item = (section: string, topic: string, id: string, text: string): PrismaItem => ({
  id,
  section,
  topic,
  text,
})

export const MAIN: PrismaItem[] = [
  item('Title', 'Title', '1', 'Identify the report as a systematic review.'),
  item('Abstract', 'Abstract', '2', 'See the PRISMA 2020 for Abstracts checklist.'),
  item(
    'Introduction',
    'Rationale',
    '3',
    'Describe the rationale for the review in the context of existing knowledge.',
  ),
  item(
    'Introduction',
    'Objectives',
    '4',
    'Provide an explicit statement of the objective(s) or question(s) the review addresses.',
  ),
  item(
    'Methods',
    'Eligibility criteria',
    '5',
    'Specify the inclusion and exclusion criteria for the review and how studies were grouped for the syntheses.',
  ),
  item(
    'Methods',
    'Information sources',
    '6',
    'Specify all databases, registers, websites, organisations, reference lists and other sources searched or consulted to identify studies. Specify the date when each source was last searched or consulted.',
  ),
  item(
    'Methods',
    'Search strategy',
    '7',
    'Present the full search strategies for all databases, registers and websites, including any filters and limits used.',
  ),
  item(
    'Methods',
    'Selection process',
    '8',
    'Specify the methods used to decide whether a study met the inclusion criteria of the review, including how many reviewers screened each record and each report retrieved, whether they worked independently, and if applicable, details of automation tools used in the process.',
  ),
  item(
    'Methods',
    'Data collection process',
    '9',
    'Specify the methods used to collect data from reports, including how many reviewers collected data from each report, whether they worked independently, any processes for obtaining or confirming data from study investigators, and if applicable, details of automation tools used in the process.',
  ),
  item(
    'Methods',
    'Data items',
    '10a',
    'List and define all outcomes for which data were sought. Specify whether all results that were compatible with each outcome domain in each study were sought (e.g. for all measures, time points, analyses), and if not, the methods used to decide which results to collect.',
  ),
  item(
    'Methods',
    'Data items',
    '10b',
    'List and define all other variables for which data were sought (e.g. participant and intervention characteristics, funding sources). Describe any assumptions made about any missing or unclear information.',
  ),
  item(
    'Methods',
    'Study risk of bias assessment',
    '11',
    'Specify the methods used to assess risk of bias in the included studies, including details of the tool(s) used, how many reviewers assessed each study and whether they worked independently, and if applicable, details of automation tools used in the process.',
  ),
  item(
    'Methods',
    'Effect measures',
    '12',
    'Specify for each outcome the effect measure(s) (e.g. risk ratio, mean difference) used in the synthesis or presentation of results.',
  ),
  item(
    'Methods',
    'Synthesis methods',
    '13a',
    'Describe the processes used to decide which studies were eligible for each synthesis (e.g. tabulating the study intervention characteristics and comparing against the planned groups for each synthesis (item #5)).',
  ),
  item(
    'Methods',
    'Synthesis methods',
    '13b',
    'Describe any methods required to prepare the data for presentation or synthesis, such as handling of missing summary statistics, or data conversions.',
  ),
  item(
    'Methods',
    'Synthesis methods',
    '13c',
    'Describe any methods used to tabulate or visually display results of individual studies and syntheses.',
  ),
  item(
    'Methods',
    'Synthesis methods',
    '13d',
    'Describe any methods used to synthesize results and provide a rationale for the choice(s). If meta-analysis was performed, describe the model(s), method(s) to identify the presence and extent of statistical heterogeneity, and software package(s) used.',
  ),
  item(
    'Methods',
    'Synthesis methods',
    '13e',
    'Describe any methods used to explore possible causes of heterogeneity among study results (e.g. subgroup analysis, meta-regression).',
  ),
  item(
    'Methods',
    'Synthesis methods',
    '13f',
    'Describe any sensitivity analyses conducted to assess robustness of the synthesized results.',
  ),
  item(
    'Methods',
    'Reporting bias assessment',
    '14',
    'Describe any methods used to assess risk of bias due to missing results in a synthesis (arising from reporting biases).',
  ),
  item(
    'Methods',
    'Certainty assessment',
    '15',
    'Describe any methods used to assess certainty (or confidence) in the body of evidence for an outcome.',
  ),
  item(
    'Results',
    'Study selection',
    '16a',
    'Describe the results of the search and selection process, from the number of records identified in the search to the number of studies included in the review, ideally using a flow diagram.',
  ),
  item(
    'Results',
    'Study selection',
    '16b',
    'Cite studies that might appear to meet the inclusion criteria, but which were excluded, and explain why they were excluded.',
  ),
  item(
    'Results',
    'Study characteristics',
    '17',
    'Cite each included study and present its characteristics.',
  ),
  item(
    'Results',
    'Risk of bias in studies',
    '18',
    'Present assessments of risk of bias for each included study.',
  ),
  item(
    'Results',
    'Results of individual studies',
    '19',
    'For all outcomes, present, for each study: (a) summary statistics for each group (where appropriate) and (b) an effect estimate and its precision (e.g. confidence/credible interval), ideally using structured tables or plots.',
  ),
  item(
    'Results',
    'Results of syntheses',
    '20a',
    'For each synthesis, briefly summarise the characteristics and risk of bias among contributing studies.',
  ),
  item(
    'Results',
    'Results of syntheses',
    '20b',
    'Present results of all statistical syntheses conducted. If meta-analysis was done, present for each the summary estimate and its precision (e.g. confidence/credible interval) and measures of statistical heterogeneity. If comparing groups, describe the direction of the effect.',
  ),
  item(
    'Results',
    'Results of syntheses',
    '20c',
    'Present results of all investigations of possible causes of heterogeneity among study results.',
  ),
  item(
    'Results',
    'Results of syntheses',
    '20d',
    'Present results of all sensitivity analyses conducted to assess the robustness of the synthesized results.',
  ),
  item(
    'Results',
    'Reporting biases',
    '21',
    'Present assessments of risk of bias due to missing results (arising from reporting biases) for each synthesis assessed.',
  ),
  item(
    'Results',
    'Certainty of evidence',
    '22',
    'Present assessments of certainty (or confidence) in the body of evidence for each outcome assessed.',
  ),
  item(
    'Discussion',
    'Discussion',
    '23a',
    'Provide a general interpretation of the results in the context of other evidence.',
  ),
  item(
    'Discussion',
    'Discussion',
    '23b',
    'Discuss any limitations of the evidence included in the review.',
  ),
  item('Discussion', 'Discussion', '23c', 'Discuss any limitations of the review processes used.'),
  item(
    'Discussion',
    'Discussion',
    '23d',
    'Discuss implications of the results for practice, policy, and future research.',
  ),
  item(
    'Other information',
    'Registration and protocol',
    '24a',
    'Provide registration information for the review, including register name and registration number, or state that the review was not registered.',
  ),
  item(
    'Other information',
    'Registration and protocol',
    '24b',
    'Indicate where the review protocol can be accessed, or state that a protocol was not prepared.',
  ),
  item(
    'Other information',
    'Registration and protocol',
    '24c',
    'Describe and explain any amendments to information provided at registration or in the protocol.',
  ),
  item(
    'Other information',
    'Support',
    '25',
    'Describe sources of financial or non-financial support for the review, and the role of the funders or sponsors in the review.',
  ),
  item(
    'Other information',
    'Competing interests',
    '26',
    'Declare any competing interests of review authors.',
  ),
  item(
    'Other information',
    'Availability of data, code and other materials',
    '27',
    'Report which of the following are publicly available and where they can be found: template data collection forms; data extracted from included studies; data used for all analyses; analytic code; any other materials used in the review.',
  ),
]

export const ABSTRACT: PrismaItem[] = [
  item('Title', 'Title', 'A1', 'Identify the report as a systematic review.'),
  item(
    'Background',
    'Objectives',
    'A2',
    'Provide an explicit statement of the main objective(s) or question(s) the review addresses.',
  ),
  item(
    'Methods',
    'Eligibility criteria',
    'A3',
    'Specify the inclusion and exclusion criteria for the review.',
  ),
  item(
    'Methods',
    'Information sources',
    'A4',
    'Specify the information sources (e.g. databases, registers) used to identify studies and the date when each was last searched.',
  ),
  item(
    'Methods',
    'Risk of bias',
    'A5',
    'Specify the methods used to assess risk of bias in the included studies.',
  ),
  item(
    'Methods',
    'Synthesis of results',
    'A6',
    'Specify the methods used to present and synthesise results.',
  ),
  item(
    'Results',
    'Included studies',
    'A7',
    'Give the total number of included studies and participants and summarise relevant characteristics of studies.',
  ),
  item(
    'Results',
    'Synthesis of results',
    'A8',
    'Present results for main outcomes, preferably indicating the number of included studies and participants for each. If meta-analysis was done, report the summary estimate and confidence/credible interval. If comparing groups, indicate the direction of the effect (i.e. which group is favoured).',
  ),
  item(
    'Discussion',
    'Limitations of evidence',
    'A9',
    'Provide a brief summary of the limitations of the evidence included in the review (e.g. study risk of bias, inconsistency and imprecision).',
  ),
  item(
    'Discussion',
    'Interpretation',
    'A10',
    'Provide a general interpretation of the results and important implications.',
  ),
  item('Other', 'Funding', 'A11', 'Specify the primary source of funding for the review.'),
  item('Other', 'Registration', 'A12', 'Provide the register name and registration number.'),
]

/** The item number as the checklist prints it ("A3" is abstract item 3). */
export const itemNumber = (id: string) => id.replace(/^A/, '')
