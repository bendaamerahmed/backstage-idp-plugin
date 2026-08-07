#!/usr/bin/env node
/**
 * Build the distributable `.plugin` bundle.
 *
 *     npm run build:plugin
 *
 * A `.plugin` is a zip of the plugin directory. It is a build OUTPUT — it is
 * never committed, because a committed zip is a second copy of the content that
 * drifts from the first and that no test reads.
 *
 * Reproducibility: entries are sorted, timestamps are fixed, and no filesystem
 * mode bits are carried through, so the same commit produces a byte-identical
 * bundle on any machine. That is what makes "the release artifact matches the
 * tag" a checkable claim rather than a hope.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { REPO_ROOT, PLUGIN_DIR, PLUGIN_MANIFEST, readJson, rel } from '../test/helpers/repo.mjs';

const DIST = path.join(REPO_ROOT, 'dist');

/** Fixed timestamp so the bundle is reproducible. 1980-01-01, the zip epoch. */
const DOS_TIME = 0;
const DOS_DATE = 33; // (1980-1980)<<9 | 1<<5 | 1

function collect(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(abs, base, out);
    else out.push({ name: path.relative(base, abs).split(path.sep).join('/'), abs });
  }
  return out;
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/**
 * Minimal deterministic zip writer. Deflate, no extra fields, no mode bits.
 *
 * Entries are ROOT-RELATIVE (`skills/backstage-catalog/SKILL.md`), matching the
 * 1.0.0 bundle recoverable from the first commit. An earlier version of this
 * script prefixed every path with the plugin name, which produces a bundle that
 * builds cleanly, hashes reproducibly, and does not install.
 */
function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const raw = fs.readFileSync(f.abs);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const data = useDeflate ? deflated : raw;
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(raw);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0, 6); // flags
    lfh.writeUInt16LE(useDeflate ? 8 : 0, 8);
    lfh.writeUInt16LE(DOS_TIME, 10);
    lfh.writeUInt16LE(DOS_DATE, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(data.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    local.push(lfh, nameBuf, data);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(useDeflate ? 8 : 0, 10);
    cdh.writeUInt16LE(DOS_TIME, 12);
    cdh.writeUInt16LE(DOS_DATE, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(data.length, 20);
    cdh.writeUInt32LE(raw.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(offset, 42);
    central.push(cdh, nameBuf);

    offset += lfh.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...local, centralBuf, eocd]);
}

const manifest = readJson(PLUGIN_MANIFEST);
const files = collect(PLUGIN_DIR);

// The bundle is content, not tooling. Anything else in there is an unreviewed
// file riding along with a markdown package.
const unexpected = files.filter((f) => !/\.(md|json)$/.test(f.name));
if (unexpected.length) {
  console.error(`Refusing to build: the plugin directory contains non-content files:\n${unexpected.map((f) => `  ${f.name}`).join('\n')}`);
  process.exit(1);
}

fs.mkdirSync(DIST, { recursive: true });
const out = path.join(DIST, `${manifest.name}-${manifest.version}.plugin`);
const buf = zip(files);
fs.writeFileSync(out, buf);

const sha = crypto.createHash('sha256').update(buf).digest('hex');
fs.writeFileSync(`${out}.sha256`, `${sha}  ${path.basename(out)}\n`);

console.log(`${rel(out)}`);
console.log(`  ${files.length} files, ${(buf.length / 1024).toFixed(1)} KiB`);
console.log(`  sha256 ${sha}`);
console.log('\nReproducible: fixed timestamps, sorted entries, no mode bits. The same commit');
console.log('always produces this exact hash.');
