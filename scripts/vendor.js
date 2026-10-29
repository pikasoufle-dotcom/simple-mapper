#!/usr/bin/env node
/**
 * Télécharge les dépendances vendor dans ./vendor/ pour cache local.
 * Usage : npm run vendor
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(ROOT, 'vendor');

const DEPS = {
  'three.module.js': 'https://unpkg.com/three@0.160.0/build/three.module.js',
  'jszip.min.js': 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
};

const c = { reset: '\x1b[0m', dim: '\x1b[2m', green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m' };

async function main() {
  await fs.mkdir(VENDOR_DIR, { recursive: true });

  for (const [name, url] of Object.entries(DEPS)) {
    const dest = path.join(VENDOR_DIR, name);

    if (existsSync(dest)) {
      const stat = await fs.stat(dest);
      console.log(`${c.green}✓${c.reset} ${name} déjà présent (${(stat.size / 1024).toFixed(1)} KB)`);
      continue;
    }

    console.log(`${c.cyan}↓${c.reset} Téléchargement de ${name}…`);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} pour ${url}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    await fs.writeFile(dest, buffer);
    console.log(`${c.green}✓${c.reset} ${name} sauvegardé (${(buffer.length / 1024).toFixed(1)} KB)`);
  }

  console.log(`\n${c.green}✅ Dépendances prêtes dans vendor/${c.reset}`);
}

main().catch((err) => {
  console.error(`\x1b[31m✗\x1b[0m ${err.message}`);
  process.exit(1);
});