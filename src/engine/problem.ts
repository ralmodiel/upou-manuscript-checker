/** Says why a file cannot be checked, in words for the student. Readers throw it; check() shows its
 *  message as it is, and a general one for any other error (a library's own text never shows). */
export class FileProblem extends Error {
  name = 'FileProblem'
}
