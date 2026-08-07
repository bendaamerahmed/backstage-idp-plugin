#!/usr/bin/env node
/**
 * Stage the npm package.
 *
 *     npm run build:npm          # writes dist/npm/
 *     npm run build:npm -- --dry # also runs `npm pack --dry-run` and lists contents
 *
 * Then publish from the staged directory:
 *
 *     npm publish dist/npm --access public
 *
 * Why a staging directory rather than a package.json inside the plugin:
 *
 *  - The plugin directory must stay content-only. Tier 0's
 *    `plugin-bundle-contents` allows .md and .json, so a package.json would
 *    technically pass — and would then ship inside the .plugin bundle, telling
 *    every adopter their Claude Code plugin is an npm package. It is not.
 *  - The root package.json is `private: true` and describes the test harness,
 *    which has two devDependencies and 96 files nobody installing this wants.
 *
 * The version is read from the plugin manifest, never typed here, so the npm
 * version and the plugin version cannot drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT, PLUGIN_DIR, PLUGIN_MANIFEST, readJson, rel } from '../test/helpers/repo.mjs';

export const NPM_SCOPE = '@backstage-idp-plugin';
export const NPM_NAME = `${NPM_SCOPE}/backstage-idp`;
const OUT = path.join(REPO_ROOT, 'dist', 'npm');

/**
 * Guarded so importing this module does not build anything. Tier 0 imports it
 * to assert the npm name still matches the plugin name; without the guard, that
 * assertion would stage a package as a side effect and print over the test
 * output.
 */
function main() {
  const manifest = readJson(PLUGIN_MANIFEST);

  if (`${NPM_SCOPE}/${manifest.name}` !== NPM_NAME) {
    console.error(
      `The npm package name (${NPM_NAME}) no longer matches the plugin name (${manifest.name}).\n` +
        'They are deliberately identical so there is one identity across npm, the marketplace and\n' +
        '`/plugin install`. Change both, or change neither.',
    );
    process.exit(1);
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // The plugin content, verbatim.
  fs.cpSync(PLUGIN_DIR, OUT, { recursive: true });

  // Things npm consumers expect at the package root.
  fs.copyFileSync(path.join(REPO_ROOT, 'LICENSE'), path.join(OUT, 'LICENSE'));

  // The one executable in the package. It lives in npm/ rather than inside the
  // plugin so the .plugin bundle an adopter installs into Claude Code stays
  // markdown and JSON only — `plugin-bundle-contents` enforces that, and adding
  // a script under plugins/ would break it. See SECURITY.md, which describes
  // this file to adopters.
  fs.mkdirSync(path.join(OUT, 'bin'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'npm/bin/backstage-idp.mjs'), path.join(OUT, 'bin/backstage-idp.mjs'));

  const repoUrl = 'https://github.com/bendaamerahmed/backstage-idp-plugin';

  const pkg = {
    name: NPM_NAME,
    version: manifest.version,
    description: manifest.description,
    keywords: [...(manifest.keywords ?? []), 'claude-code', 'claude-code-plugin', 'ai-agent'],
    license: manifest.license,
    author: manifest.author,
    homepage: `${repoUrl}#readme`,
    repository: { type: 'git', url: `git+${repoUrl}.git` },
    bugs: { url: `${repoUrl}/issues` },
    // No `main` on purpose: this package is markdown, not a module. Declaring one
    // would make `require()` half-work and mislead anyone who tried. The `bin`
    // exists only so `npx` explains itself instead of failing with "could not
    // determine executable to run".
    type: 'module',
    bin: { 'backstage-idp': 'bin/backstage-idp.mjs' },
    files: ['.claude-plugin/', 'agents/', 'skills/', 'bin/', 'README.md', 'LICENSE'],
    engines: { node: '>=22.0.0' },
    publishConfig: { access: 'public' },
    // Consumed by `npm view` and by anyone auditing what an install would run.
    scripts: {},
  };

  fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  // npm ignores a file literally named .gitignore inside a package and renames
  // .npmignore; neither exists here, but `files` above is the allowlist that
  // actually decides, so assert it covers what we copied.
  const staged = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else staged.push(path.relative(OUT, p).split(path.sep).join('/'));
    }
  })(OUT);

  const allowed = (f) =>
    f === 'package.json' ||
    pkg.files.some((pattern) => (pattern.endsWith('/') ? f.startsWith(pattern) : f === pattern));

  const orphans = staged.filter((f) => !allowed(f));
  if (orphans.length) {
    console.error(`Staged files that \`files\` would exclude — they would silently not publish:\n${orphans.map((f) => `  ${f}`).join('\n')}`);
    process.exit(1);
  }

  console.log(`${rel(OUT)}`);
  console.log(`  ${pkg.name}@${pkg.version}`);
  console.log(`  ${staged.length} files`);

  if (process.argv.includes('--dry')) {
    console.log('\n--- npm pack --dry-run ---');
    const npm = process.platform === 'win32' ? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js') : null;
    const res = npm && fs.existsSync(npm)
      ? execFileSync(process.execPath, [npm, 'pack', '--dry-run'], { cwd: OUT, encoding: 'utf8', stdio: 'pipe' })
      : execFileSync('npm', ['pack', '--dry-run'], { cwd: OUT, encoding: 'utf8', stdio: 'pipe' });
    console.log(res);
  }

  console.log('\nPublish with:');
  console.log(`  npm publish ${rel(OUT)} --access public`);
  console.log('\nThis script does not publish. It does not run `npm login` and does not read a token.');

}

if (process.argv[1]?.endsWith('build-npm-package.mjs')) main();
