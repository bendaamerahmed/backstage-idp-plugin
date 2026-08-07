#!/usr/bin/env node
/**
 * Cache the published Kubernetes plugin config schema next to a fixture.
 *
 *     node scripts/fixtures/fetch-kubernetes-schema.mjs [fixture]
 *
 * `backstage-kubernetes` tells the agent to write specific `kubernetes.*` config
 * keys, and getting `customResources` wrong is a silent no-match rather than an
 * error — so the shape is worth pinning to something real.
 *
 * The fixture is a plain `create-app`, which does not install the Kubernetes
 * plugin. Adding it to the fixture would mean a much larger install for one
 * scenario, so the schema is fetched from the registry instead. That is arguably
 * the better source anyway: it is the version an adopter would install today,
 * not whatever a fixture happened to pin when it was built.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { REPO_ROOT, rel } from '../../test/helpers/repo.mjs';
import { npmDistTags, downloadPackage } from '../../test/helpers/net.mjs';
import { FIXTURES_DIR } from './build-all.mjs';

const PACKAGE = '@backstage/plugin-kubernetes-backend';
const fixture = process.argv[2] ?? 'nfs-current';
const dest = path.join(FIXTURES_DIR, fixture);

if (!fs.existsSync(dest)) {
  console.error(`fixture "${fixture}" is not built. Run: npm run fixtures:build -- ${fixture}`);
  process.exit(1);
}

const tags = await npmDistTags(PACKAGE);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsidp-k8s-schema-'));
try {
  const pkg = await downloadPackage(PACKAGE, tags.latest, tmp);
  const schemaPath = path.join(pkg, 'config.schema.json');
  if (!fs.existsSync(schemaPath)) {
    console.error(
      `${PACKAGE}@${tags.latest} no longer ships config.schema.json.\n` +
        'The Tier 4 scenario reads it directly; find where the schema moved and update this script.',
    );
    process.exit(1);
  }
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const out = path.join(dest, '.kubernetes-config.schema.json');
  fs.writeFileSync(
    out,
    JSON.stringify({ _source: `npm:${PACKAGE}@${tags.latest}`, _fetchedOn: new Date().toISOString(), ...schema }, null, 2) + '\n',
  );
  console.log(`${rel(out)}  (from ${PACKAGE}@${tags.latest})`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
