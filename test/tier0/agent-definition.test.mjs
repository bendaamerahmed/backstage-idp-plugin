import test from 'node:test';
import { loadAgent, loadBaseline, headings } from '../helpers/repo.mjs';
import { checkRule } from '../helpers/rules.mjs';

const agent = loadAgent();
const baseline = loadBaseline();

// Fields Claude Code recognises on a plugin-shipped subagent definition.
const KNOWN_AGENT_FIELDS = new Set([
  'name',
  'description',
  'tools',
  'model',
  'effort',
  'permissionMode',
  'memory',
  'background',
  'color',
  'skills',
  'isolation',
  'maxTurns',
  'hooks',
  'mcpServers',
]);

// Fields that Claude Code ignores for a plugin-shipped agent. Present without a
// comment, each is a silent no-op that the next maintainer will assume works.
const IGNORED_FOR_PLUGIN_AGENTS = ['hooks', 'mcpServers', 'permissionMode'];

test('agent frontmatter parses and uses only recognised fields', () => {
  checkRule(
    'agent-frontmatter-known-fields',
    'the agent definition parses as YAML and declares only fields Claude Code recognises for a plugin agent',
    'An unrecognised field is dropped at load with no warning. `effort: hgih` reads as a configured agent and runs at the default effort.',
    (r) => {
      if (!r.require(!agent.frontmatterError, agent.relFile, {
        line: 1,
        found: agent.frontmatterError ?? 'ok',
        expected: 'a --- delimited YAML mapping',
        fix: 'fix the YAML; the agent will not load at all until this parses',
      })) return;

      for (const key of Object.keys(agent.frontmatter)) {
        r.require(KNOWN_AGENT_FIELDS.has(key), agent.relFile, {
          line: 1,
          found: `${key}:`,
          expected: `one of ${[...KNOWN_AGENT_FIELDS].sort().join(', ')}`,
          fix: 'fix the typo, or add the field to KNOWN_AGENT_FIELDS with a comment saying what reads it',
        });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// The load-bearing safety properties.
//
// Each of these was already the cause of a real failure mode; see
// docs/adr/0003 through 0006, which state each one. They are
// asserted individually, with the failure mode in the rationale, so that a
// future maintainer who deletes one gets told what breaks rather than a diff.
// ---------------------------------------------------------------------------

test('background: false is present', () => {
  checkRule(
    'agent-background-false',
    'the agent declares `background: false`',
    'Since Claude Code v2.1.198 subagents run in the background by default, and a background subagent silently loses TaskCreate/TaskGet/TaskList/TaskUpdate, BashOutput and KillShell. This agent\'s execution protocol depends on task tracking and on tailing long-running dev servers. Removing this line does not produce an error — it produces an agent that cannot track its own work. See ADR-0004.',
    (r) => {
      r.require(agent.frontmatter?.background === false, agent.relFile, {
        line: 1,
        found: `background: ${JSON.stringify(agent.frontmatter?.background)}`,
        expected: 'background: false',
        fix: 'restore the line. If you believe the platform default changed, update ADR-0004 with evidence first — do not delete the assertion to make a run pass.',
      });
    },
  );
});

test('AskUserQuestion is absent from the tools list', () => {
  checkRule(
    'agent-no-ask-user-question',
    '`AskUserQuestion` does not appear in the agent\'s `tools`',
    'Claude Code strips AskUserQuestion from every subagent regardless of the tools list. Granting it produces an agent that believes it can ask, then either invents a default silently or prints a question and returns as though it were answered. The designed alternative is a structured BLOCKED report. See ADR-0003.',
    (r) => {
      const tools = String(agent.frontmatter?.tools ?? '');
      r.require(!/\bAskUserQuestion\b/.test(tools), agent.relFile, {
        line: 1,
        found: `tools: ${tools.slice(0, 120)}…`,
        expected: 'no AskUserQuestion entry',
        fix: 'remove it and route the decision through the BLOCKED report in §5.6',
      });
    },
  );
});

test('isolation is absent', () => {
  checkRule(
    'agent-no-worktree-isolation',
    'the agent does not declare `isolation`',
    'A worktree branches from the repository DEFAULT branch, not the parent session HEAD. An agent invoked while the user is on a feature branch would work against a copy that does not contain the user\'s work, then report success against code the user cannot see. See ADR-0005.',
    (r) => {
      r.require(!('isolation' in (agent.frontmatter ?? {})), agent.relFile, {
        line: 1,
        found: `isolation: ${JSON.stringify(agent.frontmatter?.isolation)}`,
        expected: 'the field to be absent',
        fix: 'remove it. Worktree isolation is correct only for a throwaway spike, and then it belongs in the task prompt, not the definition.',
      });
    },
  );
});

test('maxTurns is absent', () => {
  checkRule(
    'agent-no-max-turns',
    'the agent does not declare `maxTurns`',
    'A hard turn cap truncates a long vertical slice mid-validation, leaving the agent having written code but not run tests — manufacturing exactly the unverified "done" claim §5.5 exists to prevent. Bound work by scope. See ADR-0006.',
    (r) => {
      r.require(!('maxTurns' in (agent.frontmatter ?? {})), agent.relFile, {
        line: 1,
        found: `maxTurns: ${JSON.stringify(agent.frontmatter?.maxTurns)}`,
        expected: 'the field to be absent',
        fix: 'remove it and bound the work through task scope instead',
      });
    },
  );
});

test('the agent can read and stop long-running processes', () => {
  checkRule(
    'agent-has-process-control-tools',
    'the agent grants BashOutput, KillShell and Monitor',
    'Without these the agent has no way to read a backgrounded process or stop one. The observed failure is a foreground `yarn start` that never exits and hangs the whole session. Granting them is what makes §14\'s "never run a watch process in the foreground" an instruction the agent can actually follow.',
    (r) => {
      const tools = String(agent.frontmatter?.tools ?? '');
      for (const t of ['BashOutput', 'KillShell', 'Monitor']) {
        r.require(new RegExp(`\\b${t}\\b`).test(tools), agent.relFile, {
          line: 1,
          found: `${t} not in tools`,
          expected: `${t} present in tools`,
          fix: `add ${t}; without it the agent cannot manage the processes §14 tells it to background`,
        });
      }
    },
  );
});

test('fields ignored for plugin agents carry an explanatory comment', () => {
  checkRule(
    'agent-ignored-fields-explained',
    `if ${IGNORED_FOR_PLUGIN_AGENTS.join(', ')} appear in frontmatter, an HTML comment in the file explains why they are retained`,
    'A field that Claude Code silently ignores for a plugin-shipped agent is a trap: the next maintainer reads it as configured behaviour and debugs the wrong thing. Either delete it or say in the file why it stays.',
    (r) => {
      const comments = (agent.raw.match(/<!--[\s\S]*?-->/g) ?? []).join('\n');
      for (const field of IGNORED_FOR_PLUGIN_AGENTS) {
        if (!(field in (agent.frontmatter ?? {}))) continue;
        r.require(new RegExp(`\\b${field}\\b`).test(comments), agent.relFile, {
          line: 1,
          found: `${field}: ${JSON.stringify(agent.frontmatter[field])} declared, not mentioned in any HTML comment`,
          expected: `an HTML comment naming \`${field}\` and saying why it is kept`,
          fix: `either delete \`${field}\` from the frontmatter, or add a note to the FRONTMATTER NOTES comment block explaining what reads it and what happens if it does not`,
        });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Section 0 must agree with baseline.json.
// ---------------------------------------------------------------------------

/** Parse the `| Fact | Value |` table under `## 0. Version Baseline`. */
function parseBaselineTable() {
  const lines = agent.raw.split('\n');
  const start = lines.findIndex((l) => /^##\s+0\.\s+Version Baseline/.test(l));
  if (start === -1) return null;
  const rows = new Map();
  for (let i = start; i < lines.length; i++) {
    if (i > start && /^#{1,2}\s/.test(lines[i])) break;
    const m = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/.exec(lines[i]);
    if (!m) continue;
    if (/^:?-+:?$/.test(m[1].trim())) continue; // separator row
    if (/^Fact$/i.test(m[1].trim())) continue; // header row
    rows.set(m[1].trim(), { value: m[2].trim(), line: i + 1 });
  }
  return rows;
}

test('Section 0 agrees with baseline.json', () => {
  checkRule(
    'agent-section0-matches-baseline',
    'every fact in the Section 0 table is consistent with the corresponding entry in baseline.json',
    'Section 0 is what the agent reads; baseline.json is what the currency job checks. If they drift, the weekly job passes while the agent acts on a stale number — the exact failure this whole harness exists to prevent.',
    (r) => {
      const rows = parseBaselineTable();
      if (!r.require(rows && rows.size > 0, agent.relFile, {
        found: 'no "## 0. Version Baseline" table found, or it has no rows',
        expected: 'a `| Fact | Value |` table under Section 0',
        fix: 'restore the table; baseline.json alone is not read by the agent',
      })) return;

      const expectations = [
        {
          fact: 'Current stable release line',
          test: (v) => v.includes(baseline.release.currentLine),
          expected: `must mention ${baseline.release.currentLine} (baseline.release.currentLine)`,
        },
        {
          fact: 'Supported Node.js',
          test: (v) => baseline.node.supportedMajors.every((m) => new RegExp(`\\b${m}\\b`).test(v)),
          expected: `must mention every supported major: ${baseline.node.supportedMajors.join(', ')} (baseline.node.supportedMajors)`,
        },
        {
          fact: 'Frontend system',
          test: (v) =>
            v.includes(baseline.createApp.nfsDefaultSince) &&
            /--legacy/.test(v) &&
            baseline.createApp.removedFlags.every((f) => v.includes(f)),
          expected: `must state NFS default since ${baseline.createApp.nfsDefaultSince} and that ${baseline.createApp.removedFlags.join(', ')} was replaced by --legacy (baseline.createApp)`,
        },
        {
          fact: 'UI library',
          test: (v) => v.includes(baseline.uiLibrary.package) && v.includes(baseline.uiLibrary.shortName),
          expected: `must name ${baseline.uiLibrary.package} and ${baseline.uiLibrary.shortName} (baseline.uiLibrary)`,
        },
        {
          fact: 'Community plugins',
          test: (v) => v.includes(baseline.communityPlugins.scope),
          expected: `must name the ${baseline.communityPlugins.scope} scope (baseline.communityPlugins)`,
        },
      ];

      for (const e of expectations) {
        const row = rows.get(e.fact);
        if (!row) {
          r.violation(agent.relFile, {
            found: `Section 0 has no row "${e.fact}"`,
            expected: e.expected,
            fix: 'add the row, or rename the expectation in this test if the row was deliberately renamed',
          });
          continue;
        }
        r.require(e.test(row.value), agent.relFile, {
          line: row.line,
          found: `${e.fact} | ${row.value}`,
          expected: e.expected,
          fix: 'update Section 0 and baseline.json together, cite the source in the commit body, and set a fresh verifiedOn',
        });
      }
    },
  );
});

test('Section 0 carries a verification date and a repository-wins rule', () => {
  checkRule(
    'agent-section0-self-dating',
    'Section 0 states the month it was verified and instructs the agent that the repository overrides the table',
    'The table is a hypothesis with a shelf life. Without the date the agent cannot judge how much to trust it, and without the override rule it will contradict a repository that is legitimately on an older line.',
    (r) => {
      const idx = agent.raw.indexOf('## 0. Version Baseline');
      const sec = agent.raw.slice(idx, idx + 3000);
      r.require(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d\d\b/.test(sec), agent.relFile, {
        found: 'no "<Month> <Year>" verification date in Section 0',
        expected: 'an explicit verification month and year',
        fix: 'state when the table was verified',
      });
      r.require(/repository wins|the repository wins/i.test(sec), agent.relFile, {
        found: 'no "the repository wins" override rule in Section 0',
        expected: 'an explicit instruction that a repository on an older line overrides the table',
        fix: 'restore the override rule; without it a stale table becomes an instruction',
      });
    },
  );
});

test('the agent definition has a single H1 and numbered sections', () => {
  checkRule(
    'agent-section-numbering',
    'the agent definition has exactly one H1 and its level-2 sections are numbered without gaps or repeats',
    'Every cross-reference in the document and in the twelve skills is by section number. A renumber that introduces a gap silently redirects a reference to the wrong section.',
    (r) => {
      const hs = headings(agent);
      const h1s = hs.filter((h) => h.level === 1);
      r.require(h1s.length === 1, agent.relFile, {
        found: `${h1s.length} level-1 headings`,
        expected: 'exactly one',
        fix: 'demote the extras',
      });
      const numbered = hs
        .filter((h) => h.level === 2)
        .map((h) => ({ ...h, m: /^(\d+)\.\s/.exec(h.text) }))
        .filter((h) => h.m);
      let expected = 0;
      for (const h of numbered) {
        const n = Number(h.m[1]);
        if (n !== expected) {
          r.violation(agent.relFile, {
            line: h.line,
            found: `## ${h.text}`,
            expected: `## ${expected}. …`,
            fix: 'renumber; every §N reference in the plugin resolves against this sequence',
          });
        }
        expected = n + 1;
      }
    },
  );
});
