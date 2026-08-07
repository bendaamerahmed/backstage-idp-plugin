#!/usr/bin/env node
/** Remove built fixtures. `npm run fixtures:clean [name]` */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../../test/helpers/repo.mjs';

const dir = path.join(REPO_ROOT, 'fixtures');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!fs.existsSync(dir)) {
  console.log('nothing to clean');
  process.exit(0);
}
for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  if (only.length && !only.includes(e.name)) continue;
  fs.rmSync(path.join(dir, e.name), { recursive: true, force: true });
  console.log(`removed fixtures/${e.name}`);
}
