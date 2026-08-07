/**
 * Violation reporting.
 *
 * A structural suite that fails on the first bad file makes the maintainer
 * re-run it once per defect. Every rule here collects across all files and
 * throws once, with a report naming the rule, each offending `file:line`, what
 * was found, what was expected, and what to do about it.
 *
 * The contract: no assertion in this repository is allowed to fail with a
 * message that does not identify a file and a rule.
 */

export class Rule {
  /**
   * @param {string} id        stable kebab-case rule identifier, quoted in docs
   * @param {string} statement what must be true, in one line
   * @param {string} rationale why it must be true — the part that stops a
   *                           future maintainer from "fixing" it by deletion
   */
  constructor(id, statement, rationale) {
    this.id = id;
    this.statement = statement;
    this.rationale = rationale;
    this.violations = [];
  }

  /**
   * @param {string} file  repo-relative path
   * @param {{line?: number, found?: string, expected?: string, fix?: string}} detail
   */
  violation(file, detail = {}) {
    this.violations.push({ file, ...detail });
    return this;
  }

  /** Record a violation only when `condition` is false. Returns the condition. */
  require(condition, file, detail = {}) {
    if (!condition) this.violation(file, detail);
    return Boolean(condition);
  }

  get ok() {
    return this.violations.length === 0;
  }

  report() {
    const lines = [
      '',
      `RULE VIOLATED: ${this.id}`,
      `  must hold: ${this.statement}`,
      `  because:   ${this.rationale}`,
      `  offenders: ${this.violations.length}`,
      '',
    ];
    for (const v of this.violations) {
      lines.push(`  ${v.file}${v.line ? `:${v.line}` : ''}`);
      if (v.found !== undefined) lines.push(`      found:    ${indent(v.found)}`);
      if (v.expected !== undefined) lines.push(`      expected: ${indent(v.expected)}`);
      if (v.fix !== undefined) lines.push(`      fix:      ${indent(v.fix)}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  /** Throw a fully-formed report if anything was collected. */
  assert() {
    if (!this.ok) {
      const err = new Error(this.report());
      err.ruleId = this.id;
      // node:test prints a diff for assertion errors; this is a report, not a
      // comparison, so keep the stack short and the message primary.
      err.stack = `${err.message}\n    at rule ${this.id}`;
      throw err;
    }
  }
}

function indent(value) {
  return String(value).split('\n').join('\n                ');
}

export function rule(id, statement, rationale) {
  return new Rule(id, statement, rationale);
}

/**
 * Run a rule body and assert it collected nothing. Keeps every test in the
 * suite to the same three lines and guarantees the reporting shape.
 */
export function checkRule(id, statement, rationale, body) {
  const r = rule(id, statement, rationale);
  body(r);
  r.assert();
  return r;
}
