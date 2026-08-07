#!/usr/bin/env node
/**
 * Prove the rules can fail.
 *
 * A validation suite that is green on a healthy tree tells you nothing on its
 * own — a suite of `assert(true)` is also green. For each mutant below we copy
 * the plugin into a scratch tree, break exactly one thing, run the fast tiers
 * against that tree, and require BOTH that the run fails AND that the specific
 * rule we expected reports it. A mutant that fails for a different reason is
 * reported as a miss, not as a pass.
 *
 *     node scripts/mutation-check.mjs           # all mutants
 *     node scripts/mutation-check.mjs --only agent-background-false
 *
 * Runs in CI on every push. If you add a rule, add a mutant.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from '../test/helpers/repo.mjs';

/**
 * Files the rules read. Copied per mutant; everything else stays shared.
 *
 * If a rule reads a file that is not here, the suite throws ENOENT against the
 * scratch tree and the mutant is reported as "caught by (no rule named)" — a
 * crash, not a detection. That is the correct report: a rule that cannot run
 * against the scratch tree is not proven to work.
 */
const TRACKED = ['plugins', 'baseline.json', '.claude-plugin', 'package.json', 'README.md'];

/**
 * Each mutant: what it breaks, which rule must catch it, and the edit.
 * `edit(root)` mutates the scratch tree in place.
 */
const MUTANTS = [
  {
    id: 'agent-background-false',
    what: 'delete `background: false` from the agent frontmatter',
    edit: (root) => patchAgent(root, (s) => s.replace(/^background: false$/m, 'background: true')),
  },
  {
    id: 'agent-no-ask-user-question',
    what: 'grant AskUserQuestion in the tools list',
    edit: (root) => patchAgent(root, (s) => s.replace(/^(tools: .*)$/m, '$1, AskUserQuestion')),
  },
  {
    id: 'agent-no-worktree-isolation',
    what: 'add `isolation: worktree`',
    edit: (root) => patchAgent(root, (s) => s.replace(/^background: false$/m, 'background: false\nisolation: worktree')),
  },
  {
    id: 'agent-no-max-turns',
    what: 'add a turn cap',
    edit: (root) => patchAgent(root, (s) => s.replace(/^background: false$/m, 'background: false\nmaxTurns: 120')),
  },
  {
    id: 'agent-has-process-control-tools',
    what: 'remove KillShell, leaving no way to stop a dev server',
    edit: (root) => patchAgent(root, (s) => s.replace(/, KillShell/, '')),
  },
  {
    id: 'agent-section0-matches-baseline',
    what: 'move the Section 0 release line off the baseline',
    edit: (root) => patchAgent(root, (s) => s.replace(/`v1\.53\.x`/, '`v1.41.x`')),
  },
  {
    id: 'agent-skill-list-matches-shipped',
    what: 'ship a skill that section 16 does not list',
    edit: (root) => {
      const dir = path.join(root, 'plugins/backstage-idp/skills/backstage-orphan');
      fs.mkdirSync(dir, { recursive: true });
      const donor = fs.readFileSync(
        path.join(root, 'plugins/backstage-idp/skills/backstage-catalog/SKILL.md'),
        'utf8',
      );
      fs.writeFileSync(
        path.join(dir, 'SKILL.md'),
        donor.replace(/^name: backstage-catalog$/m, 'name: backstage-orphan'),
      );
    },
  },
  {
    id: 'skill-frontmatter-quote-trap',
    what: 'unquote a when_to_use that begins with a double quote — the exact bug that shipped three times',
    edit: (root) =>
      patchSkill(root, 'backstage-plugin-create', (s) =>
        s.replace(/^when_to_use: '(.*)'$/m, (_, inner) => `when_to_use: ${inner.replace(/''/g, "'")}`),
      ),
  },
  {
    id: 'skill-name-matches-directory',
    what: 'rename a skill without renaming its directory',
    edit: (root) => patchSkill(root, 'backstage-catalog', (s) => s.replace(/^name: backstage-catalog$/m, 'name: backstage-catalogue')),
  },
  {
    id: 'skill-description-bounds',
    what: 'push a description past the listing cap',
    edit: (root) =>
      patchSkill(root, 'backstage-catalog', (s) =>
        s.replace(/^description: (.*)$/m, (_, d) => `description: ${d}${' and also '.repeat(30)}`),
      ),
  },
  {
    id: 'skill-required-sections',
    what: 'delete the `Do not` section from a skill',
    edit: (root) => patchSkill(root, 'backstage-scaffolder', (s) => s.replace(/\n## Do not\n[\s\S]*$/, '\n')),
  },
  {
    id: 'skill-procedure-is-numbered',
    what: 'turn a numbered procedure into bullets',
    edit: (root) =>
      patchSkill(root, 'backstage-techdocs', (s) =>
        s.replace(/## Procedure\n\n1\./, '## Procedure\n\n-'),
      ),
  },
  {
    id: 'skill-cross-reference-resolves',
    what: 'reference a sibling skill that does not exist',
    edit: (root) =>
      patchSkill(root, 'backstage-catalog', (s) => s.replace(/## Verification/, 'See `backstage-nonexistent`.\n\n## Verification')),
  },
  {
    id: 'skill-no-placeholder-residue',
    what: 'leave a TODO in shipped content',
    edit: (root) => patchSkill(root, 'backstage-auth', (s) => s.replace(/## Verification/, 'TODO: finish this.\n\n## Verification')),
  },
  {
    id: 'no-trailing-whitespace',
    what: 'leave trailing whitespace',
    edit: (root) => patchSkill(root, 'backstage-upgrade', (s) => s.replace(/## Verification/, '## Verification   ')),
  },
  {
    id: 'lf-line-endings',
    what: 'convert a skill to CRLF',
    edit: (root) => patchSkill(root, 'backstage-permissions', (s) => s.replace(/\n/g, '\r\n')),
  },
  {
    id: 'no-emoji',
    what: 'add an emoji',
    edit: (root) => patchSkill(root, 'backstage-quality-gate', (s) => s.replace(/## Verification/, '## Verification ✅')),
  },
  {
    id: 'version-single-source',
    what: 'bump the plugin manifest without the marketplace',
    edit: (root) => {
      const p = path.join(root, 'plugins/backstage-idp/.claude-plugin/plugin.json');
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      j.version = '9.9.9';
      fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
    },
  },
  {
    id: 'test-scripts-are-portable',
    what: 'revert a test script to the bare-directory form that fails on Windows and Linux CI',
    edit: (root) => {
      const p = path.join(root, 'package.json');
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      j.scripts['test:tier0'] = 'node --test test/tier0/';
      fs.writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`);
    },
  },
  {
    id: 'skill-count-claims-accurate',
    what: 'revert the plugin description to the stale "twelve skills" that shipped in three releases',
    edit: (root) => {
      const p = path.join(root, 'plugins/backstage-idp/.claude-plugin/plugin.json');
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      j.description = j.description.replace('fifteen', 'twelve');
      fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
    },
  },
  {
    id: 'mutation-commands-gated',
    what: 'add an ungated `git push` to a procedure step',
    edit: (root) =>
      patchSkill(root, 'backstage-upgrade', (s) =>
        s.replace(/## Verification/, '13. Ship it with `git push --force origin main`.\n\n## Verification'),
      ),
  },
  {
    id: 'no-mid-run-questions',
    what: 'instruct the agent to ask the user mid-run',
    edit: (root) =>
      patchSkill(root, 'backstage-catalog', (s) =>
        s.replace(/## Verification/, '11. Ask the user which namespace to use.\n\n## Verification'),
      ),
  },
  {
    id: 'no-squatted-cli-invocation',
    what: 'use the squatted bare `npx backstage-cli`',
    edit: (root) =>
      patchSkill(root, 'backstage-quality-gate', (s) =>
        s.replace(/## Verification/, 'Run `npx backstage-cli repo lint`.\n\n## Verification'),
      ),
  },
  {
    id: 'generation-detected-before-acting',
    what: 'delete the generation-detection precondition while leaving the generation-dependent procedure',
    // The mutation has to remove the DETECTION, not the generation-sensitivity.
    // A first attempt rewrote every mention of NFS and legacy, which also made
    // the skill stop qualifying as generation-sensitive — so the rule correctly
    // skipped it and the mutant survived for the wrong reason. This is the
    // realistic regression: someone trims the preconditions as "obvious" and
    // leaves a procedure that still branches on which system is in use.
    // backstage-plugin-create is the right subject: it carries the detection in
    // its Preconditions and still branches on generation at steps 5, 7 and 8.
    // Deleting the preconditions leaves a skill that is unambiguously
    // generation-sensitive and no longer tells you how to tell which you are in.
    edit: (root) =>
      patchSkill(root, 'backstage-plugin-create', (s) => {
        const [, pre, rest] = /^([\s\S]*?## Procedure\n)([\s\S]*)$/.exec(s);
        const kept = [];
        let dropping = false;
        for (const line of pre.split('\n')) {
          if (/^-\s/.test(line)) dropping = /\b(generation|NFS|legacy|frontend system|backend system)\b/i.test(line);
          else if (!/^\s+\S/.test(line)) dropping = false; // ends the bullet's continuation
          if (!dropping) kept.push(line);
        }
        return kept.join('\n') + rest.replace(/`backstage-repo-discovery`/g, 'the repository map');
      }),
  },
];

function patchAgent(root, fn) {
  const p = path.join(root, 'plugins/backstage-idp/agents/backstage-fullstack-developer.md');
  const before = fs.readFileSync(p, 'utf8');
  const after = fn(before);
  if (before === after) throw new Error(`mutation was a no-op on ${p}`);
  fs.writeFileSync(p, after);
}

function patchSkill(root, name, fn) {
  const p = path.join(root, 'plugins/backstage-idp/skills', name, 'SKILL.md');
  const before = fs.readFileSync(p, 'utf8');
  const after = fn(before);
  if (before === after) throw new Error(`mutation was a no-op on ${p}`);
  fs.writeFileSync(p, after);
}

function copyTracked(dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of TRACKED) {
    fs.cpSync(path.join(REPO_ROOT, entry), path.join(dest, entry), { recursive: true });
  }
}

function runFastTiers(root) {
  return spawnSync(
    process.execPath,
    ['--test', 'test/tier0/*.test.mjs', 'test/tier1/*.test.mjs'],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, BSIDP_REPO_ROOT: root, CLAUDE_CLI_REQUIRED: '' },
      encoding: 'utf8',
      timeout: 180_000,
    },
  );
}

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const selected = only ? MUTANTS.filter((m) => m.id === only) : MUTANTS;
if (selected.length === 0) {
  console.error(`no mutant with id "${only}". Known: ${MUTANTS.map((m) => m.id).join(', ')}`);
  process.exit(2);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsidp-mutants-'));
let caught = 0;
const misses = [];

console.log(`Mutation check: ${selected.length} mutant(s)\n`);

for (const mutant of selected) {
  const root = path.join(tmpRoot, mutant.id);
  copyTracked(root);
  try {
    mutant.edit(root);
  } catch (err) {
    misses.push({ mutant, reason: `could not apply the mutation: ${err.message}` });
    console.log(`  BROKEN  ${mutant.id} — ${err.message}`);
    continue;
  }

  const res = runFastTiers(root);
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const failed = res.status !== 0;
  const namedTheRule = output.includes(`RULE VIOLATED: ${mutant.id}`);

  if (failed && namedTheRule) {
    caught++;
    console.log(`  caught  ${mutant.id.padEnd(38)} ${mutant.what}`);
  } else if (failed) {
    misses.push({
      mutant,
      reason: `the suite went red, but ${mutant.id} did not report it. Another rule caught it first, which means ${mutant.id} is not actually covering this case.`,
      output: output.match(/RULE VIOLATED: \S+/g)?.join(', ') ?? '(no rule named)',
    });
    console.log(`  WRONG   ${mutant.id.padEnd(38)} caught by ${(output.match(/RULE VIOLATED: (\S+)/g) ?? []).join(', ')}`);
  } else {
    misses.push({ mutant, reason: 'the suite stayed green. This rule cannot fail.' });
    console.log(`  SURVIVED ${mutant.id.padEnd(37)} ${mutant.what}`);
  }
}

fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log(`\n${caught}/${selected.length} mutants caught by the rule that should catch them.`);

if (misses.length) {
  console.error('\nMisses:\n');
  for (const m of misses) {
    console.error(`  ${m.mutant.id}`);
    console.error(`    broke:  ${m.mutant.what}`);
    console.error(`    reason: ${m.reason}`);
    if (m.output) console.error(`    saw:    ${m.output}`);
    console.error('');
  }
  process.exit(1);
}
