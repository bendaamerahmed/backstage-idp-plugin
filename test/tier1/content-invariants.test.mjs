import test from 'node:test';
import { loadSkills, loadAgent, proseLines, section, loadBaseline } from '../helpers/repo.mjs';
import { checkRule } from '../helpers/rules.mjs';

const skills = loadSkills().filter((s) => s.exists);
const agent = loadAgent();
const baseline = loadBaseline();

test('the plugin never emits a squatted bare CLI invocation', () => {
  const squats = baseline.supplyChain?.squattedBareNames ?? [];
  checkRule(
    'no-squatted-cli-invocation',
    `no content instructs running a bare npm name that resolves to something else: ${squats.map((s) => s.name).join(', ')}`,
    'The agent runs commands it finds in a procedure verbatim. `npx backstage-cli repo lint` downloads and executes an unrelated third-party package published by a different maintainer — it is not the Backstage CLI. The safe forms are the workspace binary (`yarn backstage-cli`) or the scoped package (`npx @backstage/cli`).',
    (r) => {
      for (const s of [...skills, agent]) {
        for (const line of proseLines(s)) {
          for (const squat of squats) {
            const re = new RegExp(`\\b(?:npx|npm\\s+exec|pnpm\\s+dlx|bunx)\\s+(?:--[a-z-]+\\s+)*${squat.name}\\b`);
            if (!re.test(line.text)) continue;
            r.violation(s.relFile, {
              line: line.line,
              found: line.text.trim().slice(0, 100),
              expected: `\`yarn ${squat.name}\` (the workspace binary) or \`npx ${squat.actual}\``,
              fix: `${squat.risk} Verified ${squat.verifiedOn}: ${squat.verifiedBy}`,
            });
          }
        }
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Generation detection
// ---------------------------------------------------------------------------

/** A skill is generation-sensitive if its own content turns on which system is in use. */
const GENERATION_SENSITIVE =
  /\b(?:New Frontend System|NFS|new backend system|legacy (?:frontend|backend)|createFrontendPlugin|createBackendPlugin|app-defaults|frontend-defaults)\b/i;

/**
 * Detection means reading what the repository imports or composes — never a
 * version number. `backstage.json` says nothing about composition: an app on
 * 1.53 can still be legacy and an app on 1.20 can have been hand-migrated.
 *
 * Two forms both count, and the second is the better one:
 *
 *   imperative   "Detect the frontend generation before wiring anything."
 *   declarative  "`createBackend()` is the new backend system; a `createRouter`
 *                 under packages/backend/src/plugins/ is legacy."
 *
 * The declarative form is stronger because it hands over the discriminator
 * instead of the instruction to go find one, so the rule accepts any section
 * naming a marker from BOTH sides. The first version of this rule matched only
 * the imperative phrasing and flagged four skills whose preconditions were
 * better than what it was asking for.
 */
const NFS_SIDE_MARKER =
  /@backstage\/frontend-defaults|@backstage\/frontend-plugin-api|createFrontendPlugin|createFrontendModule|\w+Blueprint\b|createBackend\(\)|createBackendPlugin|createBackendModule|\bis NFS\b|new backend system|New Frontend System/i;
const LEGACY_SIDE_MARKER =
  /@backstage\/app-defaults|createRoutableExtension|createComponentExtension|FlatRoutes|CatalogBuilder|createServiceBuilder|PluginEnvironment|\bis legacy\b|legacy backend|legacy frontend|createRouter/i;
const EXPLICIT_DETECTION =
  /\b(?:detect|determine|identify|establish|confirm|check)\b[^.]{0,120}\b(?:generation|which system|NFS|legacy|frontend system|backend system)\b|\b(?:generation|which system)\b[^.]{0,60}\b(?:known|established|determined|detected|identified)\b|`backstage-repo-discovery`/i;

function instructsDetection(text) {
  if (EXPLICIT_DETECTION.test(text)) return true;
  return NFS_SIDE_MARKER.test(text) && LEGACY_SIDE_MARKER.test(text);
}

test('generation-sensitive skills instruct detecting the generation before acting', () => {
  checkRule(
    'generation-detected-before-acting',
    'a skill whose procedure differs between system generations instructs detecting the generation — in Preconditions or before the first mutating step',
    'Scaffolding a legacy plugin into an NFS app, or wiring an NFS extension into a legacy app, produces code that type-checks and never loads. The release line does not predict composition, so the detection has to be an explicit step, not an inference.',
    (r) => {
      for (const s of skills) {
        const body = proseLines(s).map((l) => l.text).join('\n');
        if (!GENERATION_SENSITIVE.test(body)) continue;

        const pre = (section(s, 'Preconditions') ?? []).map((l) => l.text).join('\n');
        const proc = section(s, 'Procedure') ?? [];
        // "Before acting" = the first third of the procedure. A detection step
        // buried at step 9 does not stop step 2 from writing the wrong shape.
        const earlyProc = proc.slice(0, Math.max(6, Math.ceil(proc.length / 3))).map((l) => l.text).join('\n');

        const detected = instructsDetection(pre) || instructsDetection(earlyProc);
        r.require(detected, s.relFile, {
          found: 'branches on system generation but never gives the reader a way to tell which one they are in, up front',
          expected: 'either an explicit detection step, or markers from BOTH sides, in `## Preconditions` or the opening third of `## Procedure`',
          fix: 'name the discriminator on each side — e.g. "`createBackend()` in packages/backend/src/index.ts is the new backend system; a `createRouter` under packages/backend/src/plugins/ is legacy." Detection must be by import source, never by release line.',
        });
      }
    },
  );
});

test('nothing infers system generation from a version number', () => {
  checkRule(
    'no-generation-from-version',
    'no content tells the agent to conclude which system generation a repository uses from its release line or version',
    'This is the single most common wrong inference about a Backstage repo. `backstage.json` records the line the app was last bumped to and says nothing about composition. An app on 1.53 can still be legacy; an app on 1.20 can have been hand-migrated to NFS.',
    (r) => {
      const BAD = /\b(?:if|when|since)\b[^.]{0,60}\b(?:1\.\d\d|backstage\.json|release line|version)\b[^.]{0,60}\b(?:then )?(?:it is|use|assume|treat as|means)\b[^.]{0,40}\b(?:NFS|new frontend system|legacy)\b/i;
      for (const s of [...skills, agent]) {
        for (const line of proseLines(s)) {
          if (!BAD.test(line.text)) continue;
          if (/\bnever\b|\bdo not\b|\bdoes not\b|\bcannot\b|\bpredicts nothing\b/i.test(line.text)) continue;
          r.violation(s.relFile, {
            line: line.line,
            found: line.text.trim().slice(0, 120),
            expected: 'detection by import source and composition',
            fix: 'replace with an import-source check — see backstage-repo-discovery step 4',
          });
        }
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Version sensitivity
// ---------------------------------------------------------------------------

/**
 * A heuristic, and labelled as one. It looks for a known Backstage API name
 * immediately followed by `(` outside a code fence — the shape of prose that
 * states a call signature as settled fact. It cannot distinguish
 * "`createRouter(options)` takes a logger" (a claim that ages badly) from
 * "call `createRouter(...)`" (fine), so the rule requires only that such a
 * claim carries a version-sensitivity marker nearby.
 *
 * docs/test-coverage.md records this as heuristic, plus the manual review
 * checklist item that backs it.
 */
const API_NAMES = [
  'createRouter', 'createBackend', 'createBackendPlugin', 'createBackendModule',
  'createFrontendPlugin', 'createFrontendModule', 'createExtension', 'createExtensionPoint',
  'createTemplateAction', 'createPermission', 'createConditionFactory', 'createApp',
  'createServiceBuilder', 'createRouteRef', 'createApiRef', 'createPlugin',
  'convertLegacyPlugin', 'convertLegacyApp', 'coreServices', 'catalogServiceRef',
];

const VERSION_SENSITIVITY_MARKER =
  /\b(?:read the installed|installed package|check the (?:installed )?types|its? (?:own )?type|\.d\.ts|version-sensitive|verify against|may have changed|signature (?:varies|changed|differs)|as of|in your version|the repository wins|do not guess)\b/i;

test('no skill states an API signature as settled fact without a version-sensitivity marker', () => {
  checkRule(
    'api-signatures-marked-version-sensitive',
    'a prose claim about a named Backstage API call carries a version-sensitivity marker within its paragraph',
    'Backstage ships monthly and signatures move. A skill that states a signature flatly gives the agent no reason to check, so it writes the remembered shape and gets a type error it then "fixes" by casting. HEURISTIC — see docs/test-coverage.md; it detects the shape of such a claim, not its truth.',
    (r) => {
      const nameAlt = API_NAMES.join('|');
      // A signature claim: the API name, an open paren, at least one named
      // argument (not `...` or empty), outside a fence.
      const CLAIM = new RegExp(`\\b(${nameAlt})\\(\\s*(?!\\.\\.\\.|\\)|\\s*\\))([A-Za-z{][^)]{2,60})\\)`);
      for (const s of [...skills, agent]) {
        const lines = proseLines(s);
        lines.forEach((line, i) => {
          const m = CLAIM.exec(line.text);
          if (!m) return;
          // Paragraph context: the surrounding non-blank run of prose lines.
          let a = i;
          while (a > 0 && lines[a - 1].text.trim() !== '') a--;
          let b = i;
          while (b < lines.length - 1 && lines[b + 1].text.trim() !== '') b++;
          const para = lines.slice(a, b + 1).map((l) => l.text).join(' ');
          if (VERSION_SENSITIVITY_MARKER.test(para)) return;
          r.violation(s.relFile, {
            line: line.line,
            found: `${m[1]}(${m[2].slice(0, 40)}…) stated without a version-sensitivity marker`,
            expected: 'the same claim with an instruction to verify against the installed package',
            fix: 'add "read the installed package\'s types" (or equivalent) to the paragraph, or drop the argument list and name only the function',
          });
        });
      }
    },
  );
});

test('the agent tells itself which surfaces it must not trust from memory', () => {
  checkRule(
    'agent-names-untrusted-surfaces',
    'the agent definition names the surfaces where remembered knowledge is not good enough',
    'Training data is stale by construction. Without a named list, "verify version-sensitive facts" is advice the agent applies inconsistently; with one, it is a checklist.',
    (r) => {
      const required = ['import path', 'signature', 'config key', 'package name'];
      const raw = agent.raw.toLowerCase();
      for (const surface of required) {
        r.require(raw.includes(surface), agent.relFile, {
          found: `the agent never names "${surface}" as a surface to verify rather than recall`,
          expected: `an explicit instruction covering ${surface}s`,
          fix: 'add it to the list of surfaces where memory must not be trusted (§33 area)',
        });
      }
    },
  );
});

// Symptom-first ordering, enforced structurally.
//
// The first attempt at this rule matched a keyword vocabulary of "symptom
// words" and produced 56 false positives against content that was already
// correct — "Deleting an entity in the UI does nothing", "The processing loop
// falls behind" and "Two sources claim the same entity ref" are all perfectly
// good symptoms and share no vocabulary. The vocabulary of a symptom is not
// enumerable.
//
// What IS checkable is the shape the content already uses and which produces
// the ordering: `- **<lead>.** <cause, then fix>`. This rule enforces that the
// lead exists and that something follows it. Whether the lead is genuinely a
// symptom rather than a restated cause stays a human review item, recorded as
// such in docs/test-coverage.md.
test('every Failure modes entry leads with a symptom and then explains it', () => {
  checkRule(
    'failure-modes-symptom-first',
    'each top-level `Failure modes` bullet opens with a bolded lead and has explanatory text after it',
    'The agent matches this list against what it is currently seeing, so the observable has to come first. An entry that opens with the cause ("processor ordering follows module load order") is unfindable at the moment it is needed, because at that moment the agent knows only the symptom. The bold-lead convention is what forces the ordering.',
    (r) => {
      for (const s of skills) {
        const fm = section(s, 'Failure modes');
        if (!fm) continue;
        // Top-level entries only: a bullet at column 0. Indented bullets are
        // continuation of the entry above them — auth's "Session lost on
        // reload" entry has four of them enumerating where the cookie went —
        // and requiring each to carry its own bold lead would flatten a
        // deliberate hierarchy into a wall of bold.
        const isBullet = (t) => /^[-*]\s/.test(t);
        const isSubBullet = (t) => /^\s+[-*]\s/.test(t);
        const entries = fm.map((l, i) => ({ l, i })).filter(({ l }) => isBullet(l.text));
        for (const { l, i } of entries) {
          let text = l.text;
          for (let j = i + 1; j < fm.length && !isBullet(fm[j].text) && fm[j].text.trim() !== ''; j++) {
            if (isSubBullet(fm[j].text)) break; // the entry's own prose ends where its sub-list starts
            text += ' ' + fm[j].text.trim();
          }
          const lead = /^\s{0,3}[-*]\s+\*\*(.+?)\*\*/.exec(text);
          if (!lead) {
            r.violation(s.relFile, {
              line: l.line,
              found: text.trim().slice(0, 110),
              expected: '- **<what you observe>.** <why it happens, then what to do>',
              fix: 'bold the observable symptom at the front of the entry',
            });
            continue;
          }
          const rest = text.slice(text.indexOf(lead[0]) + lead[0].length).trim();
          // An entry may put its explanation in a sub-list rather than inline —
          // scaffolder's "Task sits in open/processing forever" enumerates three
          // distinct causes as sub-bullets. That is explained.
          const hasSubList = isSubBullet(fm[i + 1]?.text ?? '');
          r.require(rest.length >= 25 || hasSubList, s.relFile, {
            line: l.line,
            found: `lead "${lead[1].slice(0, 60)}" followed by ${rest.length} characters`,
            expected: 'at least a sentence explaining the cause and the fix',
            fix: 'a symptom with no explanation tells the agent it has a problem and nothing else',
          });
        }
      }
    },
  );
});
