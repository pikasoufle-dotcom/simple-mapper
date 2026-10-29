#!/usr/bin/env node
/**
 * Simple Mapper — Build script
 * Package le projet en ZIP distribuables, avec mode watch.
 *
 * Usage :
 *   node scripts/build.js                    → build offline + lite
 *   node scripts/build.js --offline          → build offline uniquement
 *   node scripts/build.js --lite             → build lite uniquement
 *   node scripts/build.js --keep             → ne pas supprimer dist/ avant
 *   node scripts/build.js --watch            → rebuild à chaque changement
 *   node scripts/build.js --watch --offline  → watch en mode offline uniquement
 */

import fs from 'node:fs/promises';
import { createWriteStream, existsSync, watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import archiver from 'archiver';

// ---------------------------------------------------------------------------
// Chemins et constantes
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const NOW = new Date();
const DATE_HUMAN = NOW.toLocaleDateString('fr-FR', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
  red: '\x1b[31m', blue: '\x1b[34m', magenta: '\x1b[35m',
};

const log = {
  info: (m) => console.log(`  ${c.cyan}ℹ${c.reset} ${m}`),
  ok: (m) => console.log(`  ${c.green}✓${c.reset} ${m}`),
  warn: (m) => console.log(`  ${c.yellow}⚠${c.reset} ${m}`),
  err: (m) => console.error(`  ${c.red}✗${c.reset} ${m}`),
  step: (m) => console.log(`\n${c.bold}${c.blue}▶ ${m}${c.reset}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`),
};

// ---------------------------------------------------------------------------
// Arguments CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const WATCH_MODE = args.includes('--watch');
const BUILD_OFFLINE = args.includes('--offline') || !args.includes('--lite');
const BUILD_LITE = args.includes('--lite') || !args.includes('--offline');
const KEEP_DIST = args.includes('--keep') || WATCH_MODE;

if (!BUILD_OFFLINE && !BUILD_LITE) {
  log.err('Aucun type de build. Utilisez --offline, --lite, ou les deux.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const VENDOR_DEPS = {
  'three.module.js': 'https://unpkg.com/three@0.160.0/build/three.module.js',
  'jszip.min.js': 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
};

const INCLUDE_FILES = ['index.html', 'app.html', 'README.md', 'LICENSE'];
const INCLUDE_DIRS = ['assets', 'demos', 'docs', 'legal'];

const SKIP_PATTERNS = [
  /\.DS_Store$/, /Thumbs\.db$/, /desktop\.ini$/,
  /node_modules/, /^dist\//, /^scripts\//, /\.git\//,
  /\.log$/, /\.tmp$/, /\.zip$/, /\.sha256$/,
];

const CDN_PATTERNS = [
  {
    pattern: /https:\/\/unpkg\.com\/three@[\d.]+\/build\/three\.module\.js/g,
    replacement: './vendor/three.module.js',
  },
  {
    pattern: /https:\/\/cdn\.jsdelivr\.net\/npm\/jszip@[\d.]+\/dist\/jszip\.min\.js/g,
    replacement: './vendor/jszip.min.js',
  },
];

// Fichiers/dossiers surveillés en mode --watch
const WATCH_TARGETS = [
  'index.html', 'app.html', 'README.md', 'LICENSE', 'package.json',
  'assets', 'demos', 'docs', 'legal',
];

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
function shouldSkip(relPath) {
  return SKIP_PATTERNS.some((re) => re.test(relPath));
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

async function copyDir(src, dest) {
  await ensureDir(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relPath = path.relative(ROOT, srcPath);
    if (shouldSkip(relPath)) continue;
    if (entry.isDirectory()) await copyDir(srcPath, destPath);
    else if (entry.isFile()) await copyFile(srcPath, destPath);
  }
}

async function downloadFile(url, dest) {
  if (existsSync(dest)) return;
  log.info(`Téléchargement : ${url}`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} pour ${url}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  await ensureDir(path.dirname(dest));
  await fs.writeFile(dest, buffer);
  log.ok(`Sauvegardé : ${path.basename(dest)} (${(buffer.length / 1024).toFixed(1)} KB)`);
}

async function patchAppHtml(filePath) {
  const original = await fs.readFile(filePath, 'utf8');
  let patched = original;
  let count = 0;
  for (const { pattern, replacement } of CDN_PATTERNS) {
    const before = patched;
    patched = patched.replace(pattern, replacement);
    if (patched !== before) count++;
  }
  if (count === 0) {
    log.warn('Aucun pattern CDN dans app.html — vérifiez manuellement');
    return;
  }
  await fs.writeFile(filePath, patched, 'utf8');
  log.ok(`app.html patché (${count} CDN → vendor/)`);
}

async function createZip(sourceDir, zipPath, rootFolderName) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(archive.pointer()));
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') log.warn(err.message);
      else reject(err);
    });
    archive.pipe(output);
    archive.directory(sourceDir, rootFolderName);
    archive.finalize();
  });
}

async function sha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function generateInstallMd(buildType) {
  const isOffline = buildType === 'offline';
  const vendorNote = isOffline
    ? `Cette version **inclut les bibliothèques nécessaires** dans \`vendor/\`. Elle fonctionne **sans connexion Internet**.`
    : `Cette version **utilise des CDN**. Une connexion est requise au premier chargement.`;

  return `# Simple Mapper — Installation rapide

**Version** : ${VERSION} · **Build** : ${DATE_HUMAN} · **Type** : ${buildType}

${vendorNote}

## 🚀 Démarrage en 30 secondes

\`\`\`bash
cd simple-mapper-${buildType}-v${VERSION}
python -m http.server 8000
\`\`\`

Ouvrir : **http://localhost:8000/index.html**

## 🎯 Premier mapping en 5 minutes

1. Ouvrir **http://localhost:8000/app.html**
2. Autoriser les **popups** (nécessaire pour les fenêtres de sortie)
3. Connecter le projecteur en mode **« Étendre »**
4. Cliquer sur **« ▶ Sortie simple »**
5. Glisser la fenêtre sur le projecteur, **⛶ Plein écran**
6. Créer une surface, glisser un média → projeter !

## 🎨 Tester les démos

Ouvrir **http://localhost:8000/demos/index.html** et cliquer sur **▶ Charger**.

## 📞 Support

- Documentation : \`README.md\` et \`docs/guide.md\`
- GitHub : ${pkg.repository.url}

*Simple Mapper — MIT License — ${DATE_HUMAN}*
`;
}

// ---------------------------------------------------------------------------
// Build principal (réutilisable en mode watch)
// ---------------------------------------------------------------------------
async function buildOne(type, opts = {}) {
  const isOffline = type === 'offline';
  const folderName = `simple-mapper-${type}-v${VERSION}`;
  const buildDir = path.join(DIST, folderName);
  const quiet = opts.quiet || false;

  if (!quiet) log.step(`Build ${c.bold}${type}${c.reset} → ${folderName}`);

  // Supprimer l'ancien dossier pour rebuild propre
  if (existsSync(buildDir)) {
    await fs.rm(buildDir, { recursive: true, force: true });
  }
  await ensureDir(buildDir);

  for (const file of INCLUDE_FILES) {
    const src = path.join(ROOT, file);
    if (!existsSync(src)) continue;
    await copyFile(src, path.join(buildDir, file));
  }
  for (const dir of INCLUDE_DIRS) {
    const src = path.join(ROOT, dir);
    if (!existsSync(src)) continue;
    await copyDir(src, path.join(buildDir, dir));
  }

  if (isOffline) {
    const vendorDir = path.join(buildDir, 'vendor');
    await ensureDir(vendorDir);
    for (const [name, url] of Object.entries(VENDOR_DEPS)) {
      const dest = path.join(vendorDir, name);
      const cachePath = path.join(ROOT, 'vendor', name);
      if (existsSync(cachePath)) {
        await copyFile(cachePath, dest);
      } else {
        await downloadFile(url, dest);
        await ensureDir(path.dirname(cachePath));
        await copyFile(dest, cachePath);
      }
    }
    await patchAppHtml(path.join(buildDir, 'app.html'));
  }

  const installMd = await generateInstallMd(type);
  await fs.writeFile(path.join(buildDir, 'INSTALL.md'), installMd, 'utf8');

  const zipPath = path.join(DIST, `${folderName}.zip`);
  if (existsSync(zipPath)) await fs.rm(zipPath);
  const size = await createZip(buildDir, zipPath, folderName);
  const hash = await sha256(zipPath);
  await fs.writeFile(
    path.join(DIST, `${folderName}.zip.sha256`),
    `${hash}  ${folderName}.zip\n`,
    'utf8'
  );

  if (!quiet) {
    log.ok(`ZIP créé : ${formatBytes(size)}`);
    log.dim(`SHA256 : ${hash.slice(0, 16)}…`);
  }

  return { type, folder: folderName, zipPath, size, hash };
}

// ---------------------------------------------------------------------------
// Mode watch
// ---------------------------------------------------------------------------
function startWatch() {
  const pending = new Set();
  let debounceTimer = null;
  let buildInProgress = false;
  let rebuildQueued = false;

  const debouncedRebuild = (reason) => {
    pending.add(reason);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (buildInProgress) {
        rebuildQueued = true;
        return;
      }
      buildInProgress = true;
      const reasons = Array.from(pending).slice(0, 3).join(', ');
      const count = pending.size;
      pending.clear();

      console.log(`\n${c.yellow}⟳${c.reset} Changement détecté (${count > 3 ? count + ' fichiers' : reasons}) — rebuild…`);
      const t0 = Date.now();

      try {
        const results = [];
        if (BUILD_OFFLINE) results.push(await buildOne('offline', { quiet: true }));
        if (BUILD_LITE) results.push(await buildOne('lite', { quiet: true }));
        const elapsed = Date.now() - t0;
        const summaries = results.map((r) => `${r.type} ${formatBytes(r.size)}`).join(' · ');
        log.ok(`Rebuild terminé en ${elapsed}ms (${summaries})`);
      } catch (err) {
        log.err(`Rebuild échoué : ${err.message}`);
      }

      buildInProgress = false;
      if (rebuildQueued) {
        rebuildQueued = false;
        debouncedRebuild('file-queued');
      }
    }, 300);
  };

  const watchers = [];

  for (const target of WATCH_TARGETS) {
    const fullPath = path.join(ROOT, target);
    if (!existsSync(fullPath)) continue;

    try {
      const watcher = watch(fullPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        if (shouldSkip(filename)) return;
        if (filename.includes('node_modules')) return;
        if (filename.includes('dist/')) return;
        if (filename.endsWith('.swp') || filename.endsWith('.tmp')) return;
        debouncedRebuild(filename);
      });
      watchers.push(watcher);
    } catch (err) {
      log.warn(`Impossible de surveiller ${target} : ${err.message}`);
    }
  }

  // Nettoyage propre à l'arrêt
  const cleanup = () => {
    console.log(`\n${c.dim}Arrêt du watch…${c.reset}`);
    for (const w of watchers) {
      try { w.close(); } catch (_) {}
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  console.log(`\n${c.bold}${c.green}👁 Mode watch actif${c.reset}`);
  console.log(`${c.dim}   Surveillance : ${WATCH_TARGETS.length} cibles${c.reset}`);
  console.log(`${c.dim}   Types : ${[BUILD_OFFLINE && 'offline', BUILD_LITE && 'lite'].filter(Boolean).join(', ')}${c.reset}`);
  console.log(`${c.dim}   Ctrl+C pour quitter${c.reset}\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const startTime = Date.now();

  console.log(`\n${c.bold}${c.magenta}🎯 Simple Mapper — Build v${VERSION}${c.reset}`);
  console.log(`${c.dim}   ${DATE_HUMAN} · Node ${process.version}${WATCH_MODE ? ' · watch' : ''}${c.reset}`);

  log.step('Vérification du projet');
  const requiredFiles = ['app.html', 'index.html', 'package.json'];
  const missing = requiredFiles.filter((f) => !existsSync(path.join(ROOT, f)));
  if (missing.length > 0) {
    log.err(`Fichiers manquants : ${missing.join(', ')}`);
    process.exit(1);
  }
  log.ok('Structure valide');

  if (!KEEP_DIST && existsSync(DIST)) {
    log.info('Nettoyage de dist/…');
    await fs.rm(DIST, { recursive: true, force: true });
  }
  await ensureDir(DIST);

  const results = [];
  if (BUILD_OFFLINE) results.push(await buildOne('offline'));
  if (BUILD_LITE) results.push(await buildOne('lite'));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n${c.bold}${c.green}✅ Build terminé en ${elapsed}s${c.reset}\n`);
  console.log(`${c.bold}📦 Artefacts dans dist/ :${c.reset}\n`);
  for (const r of results) {
    console.log(`  ${c.cyan}${r.folder}.zip${c.reset}  ${c.dim}${formatBytes(r.size)}${c.reset}`);
  }

  if (WATCH_MODE) {
    startWatch();
  } else {
    console.log(`\n${c.dim}Pour tester : ${c.reset}npm run serve:dist\n`);
  }
}

main().catch((err) => {
  console.error(`\n${c.red}✗ Build échoué :${c.reset}`, err.message);
  if (err.stack) console.error(c.dim(err.stack));
  process.exit(1);
});