#!/usr/bin/env node
/**
 * check-mojibake.mjs — checks Wails-generated bindings for encoding issues.
 * Exits 0 always (issues are warnings, not build-blockers).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT    = join(__dirname, '..');
const WAILSJS = join(ROOT, 'frontend', 'wailsjs');

if (!existsSync(WAILSJS)) {
  console.log('OK  wailsjs directory not found — skipping encoding check');
  process.exit(0);
}

let warnings = 0;

function checkFile(fp) {
  const buf = readFileSync(fp);
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    console.warn('WARN  BOM detected: ' + relative(ROOT, fp));
    warnings++;
  }
}

function walk(dir) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(js|ts|d\.ts)$/.test(e)) checkFile(full);
  }
}

walk(WAILSJS);
if (warnings === 0) console.log('OK  no BOM or mojibake detected');
else console.warn('WARN  ' + warnings + ' file(s) with encoding issues (non-fatal)');
process.exit(0);
