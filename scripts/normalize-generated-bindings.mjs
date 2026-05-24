#!/usr/bin/env node
/**
 * normalize-generated-bindings.mjs
 * Removes UTF-8 BOM from Wails-generated binding files in frontend/wailsjs/.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT    = join(__dirname, '..');
const WAILSJS = join(ROOT, 'frontend', 'wailsjs');

if (!existsSync(WAILSJS)) {
  console.log('OK  wailsjs directory not found — nothing to normalize');
  process.exit(0);
}

let fixed = 0;

function normalize(fp) {
  const buf = readFileSync(fp);
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    writeFileSync(fp, buf.slice(3));
    console.log('FIXED  removed BOM from: ' + relative(ROOT, fp));
    fixed++;
  }
}

function walk(dir) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(js|ts|d\.ts)$/.test(e)) normalize(full);
  }
}

walk(WAILSJS);
if (fixed === 0) console.log('OK  no normalization needed');
else console.log('OK  ' + fixed + ' file(s) normalized');
process.exit(0);
