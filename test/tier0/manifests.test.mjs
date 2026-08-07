import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  PLUGIN_MANIFEST,
  MARKETPLACE_MANIFEST,
  REPO_ROOT,
  PLUGIN_DIR,
  readJson,
  readRaw,
  rel,
} from '../helpers/repo.mjs';
import { checkRule } from '../helpers/rules.mjs';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

test('plugin.json is valid JSON with a kebab-case name and a semver version', () => {
  checkRule(
    'plugin-manifest-shape',
    'plugin.json parses, `name` is kebab-case, `version` is valid semver',
    'A malformed manifest fails plugin installation with a message about JSON, not about the field that is wrong. A non-semver version breaks the release workflow\'s ordering and the marketplace update check.',
    (r) => {
      let manifest;
      try {
        manifest = readJson(PLUGIN_MANIFEST);
      } catch (err) {
        r.violation(rel(PLUGIN_MANIFEST), { found: err.message, expected: 'valid JSON', fix: 'fix the syntax error at the reported offset' });
        return;
      }
      r.require(KEBAB.test(String(manifest.name)), rel(PLUGIN_MANIFEST), {
        found: `name: ${JSON.stringify(manifest.name)}`,
        expected: 'lowercase kebab-case, e.g. backstage-idp',
        fix: 'rename; the plugin name is the user-facing install identifier and appears in every `plugin:skill` reference',
      });
      r.require(SEMVER.test(String(manifest.version)), rel(PLUGIN_MANIFEST), {
        found: `version: ${JSON.stringify(manifest.version)}`,
        expected: 'a valid semver string, e.g. 1.1.0',
        fix: 'set a semver version; the release workflow tags from this field',
      });
      for (const required of ['description', 'author', 'license']) {
        r.require(manifest[required] !== undefined, rel(PLUGIN_MANIFEST), {
          found: `${required} missing`,
          expected: `a \`${required}\` field`,
          fix: 'adopting teams read all three before installing an agent with write access to their repository',
        });
      }
    },
  );
});

test('marketplace.json resolves to the plugins it lists', () => {
  checkRule(
    'marketplace-entries-resolve',
    'every marketplace entry names a directory that exists and contains a matching .claude-plugin/plugin.json',
    'A marketplace entry pointing at a missing or mismatched directory installs nothing, and the failure surfaces to the adopter as an empty plugin rather than as a broken manifest.',
    (r) => {
      let market;
      try {
        market = readJson(MARKETPLACE_MANIFEST);
      } catch (err) {
        r.violation(rel(MARKETPLACE_MANIFEST), { found: err.message, expected: 'valid JSON', fix: 'fix the syntax error' });
        return;
      }
      r.require(Array.isArray(market.plugins) && market.plugins.length > 0, rel(MARKETPLACE_MANIFEST), {
        found: `plugins: ${JSON.stringify(market.plugins)}`,
        expected: 'a non-empty array',
        fix: 'list at least one plugin',
      });
      for (const entry of market.plugins ?? []) {
        const src = path.resolve(REPO_ROOT, entry.source ?? '');
        const manifestPath = path.join(src, '.claude-plugin', 'plugin.json');
        if (!fs.existsSync(manifestPath)) {
          r.violation(rel(MARKETPLACE_MANIFEST), {
            found: `source: ${entry.source} → ${rel(manifestPath)} does not exist`,
            expected: 'a directory containing .claude-plugin/plugin.json',
            fix: 'fix the source path, or remove the entry if the plugin was deleted',
          });
          continue;
        }
        const pluginManifest = readJson(manifestPath);
        r.require(pluginManifest.name === entry.name, rel(MARKETPLACE_MANIFEST), {
          found: `entry name "${entry.name}" vs plugin.json name "${pluginManifest.name}"`,
          expected: 'the two names to be identical',
          fix: 'the marketplace entry name is what users type to install; make it match the plugin',
        });
        r.require(pluginManifest.version === entry.version, rel(MARKETPLACE_MANIFEST), {
          found: `entry version "${entry.version}" vs plugin.json version "${pluginManifest.version}"`,
          expected: 'the two versions to be identical',
          fix: 'bump both together — the release workflow reads plugin.json and the update check reads the marketplace',
        });
      }
    },
  );
});

test('the repository version, plugin version and marketplace version agree', () => {
  checkRule(
    'version-single-source',
    'package.json, plugin.json and marketplace.json declare the same version',
    'Three files carrying a version is already one too many. When they disagree, the tag, the bundled manifest and the marketplace listing describe different artifacts and an adopter cannot tell which one they installed.',
    (r) => {
      const pkg = readJson(path.join(REPO_ROOT, 'package.json'));
      const plugin = readJson(PLUGIN_MANIFEST);
      const market = readJson(MARKETPLACE_MANIFEST);
      const versions = {
        'package.json': pkg.version,
        'plugins/backstage-idp/.claude-plugin/plugin.json': plugin.version,
        '.claude-plugin/marketplace.json (metadata.version)': market.metadata?.version,
      };
      for (const entry of market.plugins ?? []) {
        versions[`.claude-plugin/marketplace.json (plugins[${entry.name}])`] = entry.version;
      }
      const distinct = [...new Set(Object.values(versions))];
      r.require(distinct.length === 1, rel(MARKETPLACE_MANIFEST), {
        found: Object.entries(versions).map(([k, v]) => `${k} = ${v}`).join('\n'),
        expected: 'one version across all of them',
        fix: 'run `node scripts/set-version.mjs <version>` rather than editing them by hand',
      });
    },
  );
});

test('the plugin bundle contains no unexpected file types', () => {
  checkRule(
    'plugin-bundle-contents',
    'the plugin directory contains only markdown, JSON and directories',
    'The bundle is shipped to adopters and read by an agent with write access. A stray script, binary or archive in it is an unreviewed executable riding along with a markdown package.',
    (r) => {
      const allowed = new Set(['.md', '.json']);
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (!allowed.has(path.extname(e.name))) {
            r.violation(rel(p), {
              found: `extension "${path.extname(e.name) || '(none)'}"`,
              expected: `one of ${[...allowed].join(', ')}`,
              fix: 'move the file out of the plugin directory, or extend this rule with a comment saying why the type is safe to ship',
            });
          }
        }
      };
      walk(PLUGIN_DIR);
    },
  );
});

// `claude plugin validate` is the authority on plugin structure. Reimplementing
// it here would mean maintaining a second, always-slightly-wrong copy of rules
// we do not own. CI installs the CLI and requires this to pass
// (CLAUDE_CLI_REQUIRED=1); locally it reports SKIPPED rather than failing a
// contributor who has the desktop app but not the CLI on PATH.
test('claude plugin validate exits zero', (t) => {
  const bin = process.env.CLAUDE_CLI ?? 'claude';
  let available = false;
  try {
    execFileSync(bin, ['--version'], { stdio: 'pipe', timeout: 30_000 });
    available = true;
  } catch {
    available = false;
  }

  if (!available) {
    if (process.env.CLAUDE_CLI_REQUIRED === '1') {
      throw new Error(
        [
          '',
          'RULE VIOLATED: plugin-validate-cli-available',
          '  must hold: the `claude` CLI is on PATH when CLAUDE_CLI_REQUIRED=1',
          '  because:   CI is the only place this rule is authoritative. If the CLI is missing there,',
          '             `claude plugin validate` never runs and the structural suite is checking a',
          '             strictly weaker set of rules than it claims to.',
          '  fix:       install it in the workflow (npm i -g @anthropic-ai/claude-code), or set CLAUDE_CLI',
          '             to its path.',
          '',
        ].join('\n'),
      );
    }
    t.skip(
      'claude CLI not on PATH — `claude plugin validate` not run. ' +
        'This is the authority on plugin structure; the rest of Tier 0 does not replace it. ' +
        'Install with `npm i -g @anthropic-ai/claude-code`, or set CLAUDE_CLI=/path/to/claude. ' +
        'CI sets CLAUDE_CLI_REQUIRED=1 so this cannot be skipped there.',
    );
    return;
  }

  // Both manifests: the plugin an adopter installs, and the marketplace entry
  // that points at it. A valid plugin behind a broken marketplace is still
  // uninstallable.
  for (const [what, target] of [
    ['plugin', rel(PLUGIN_DIR)],
    ['marketplace', '.'],
  ]) {
    try {
      execFileSync(bin, ['plugin', 'validate', target], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
        timeout: 120_000,
      });
    } catch (err) {
      const out = [err.stdout?.toString(), err.stderr?.toString()].filter(Boolean).join('\n');
      throw new Error(
        [
          '',
          `RULE VIOLATED: plugin-validate-passes (${what})`,
          `  must hold: \`claude plugin validate ${target}\` exits zero`,
          '  because:   this is the loader that adopters actually run. Every other rule in Tier 0 is',
          '             our reading of the contract; this one is the contract.',
          `  exit code: ${err.status}`,
          '  output:',
          out.split('\n').map((l) => `    ${l}`).join('\n'),
          '',
        ].join('\n'),
      );
    }
  }
});

export { SEMVER, KEBAB, readRaw };

test('the npm package identity matches the plugin identity', async () => {
  const { NPM_NAME, NPM_SCOPE } = await import('../../scripts/build-npm-package.mjs');
  checkRule(
    'npm-name-matches-plugin',
    'the npm package name is `<scope>/<plugin name>`, so npm, the marketplace and `/plugin install` all use one identity',
    'Two names for one artifact means an adopter who finds it on npm cannot tell whether it is the same thing they were told to install, and a rename on one side is invisible on the other. The npm version is read from plugin.json for the same reason.',
    (r) => {
      const manifest = readJson(PLUGIN_MANIFEST);
      r.require(NPM_NAME === `${NPM_SCOPE}/${manifest.name}`, 'scripts/build-npm-package.mjs', {
        found: `npm name "${NPM_NAME}" vs plugin name "${manifest.name}" under scope "${NPM_SCOPE}"`,
        expected: `${NPM_SCOPE}/${manifest.name}`,
        fix: 'change both or neither — the build script refuses to stage a package when they disagree',
      });
    },
  );
});
