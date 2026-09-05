/**
 * SQL as text, for the guards that reason about a statement's structure
 * rather than about the words it happens to contain.
 */

/**
 * Remove string literals and comments, so `'order by'` in a value or
 * `-- delete` in a comment is neither a clause nor a keyword.
 */
export function stripLiteralsAndComments(sql: string): string {
  return sql
    .replace(/'(?:''|[^'])*'/g, "''") // single-quoted strings
    .replace(/"(?:""|[^"])*"/g, '""') // quoted identifiers
    .replace(/--[^\n]*/g, ' ') // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' '); // block comments
}
