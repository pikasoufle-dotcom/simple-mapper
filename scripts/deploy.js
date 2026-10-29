#!/usr/bin/env node
/**
 * Simple Mapper — Deploy script
 * Déploie sur GitHub Pages et/ou Netlify.
 *
 * Usage :
 *   node scripts/deploy.js                    → demande interactivement
 *   node scripts/deploy.js --github           → GitHub Pages
 *   node scripts/deploy.js --netlify          → Netlify
 *   node scripts/deploy.js --github --netlify → les deux
 *   node scripts/deploy.js --lite             → déploie la version lite (défaut : offline)
 *   node scripts/deploy.js --dry-run          → simule sans déployer
 *
 * Prérequis :
 *   GitHub Pages : git + remote origin configuré
 *   Netlify : CLI netlify (`npm i -g netlify-cli`) + `netlify login`
 *             OU variable NETLIFY_AUTH_TOKEN + NETLIFY_SITE_ID
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

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
// Arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const DEPLOY_GITHUB = args.includes('--github');
const DEPLOY_NETLIFY = args.includes('--netlify');
const DEPLOY_LITE = args.includes('--lite');
const DRY_RUN = args.includes('--dry-run');

const buildType = DEPLOY_LITE ? 'lite' : 'offline';
const folderName = `simple-mapper-${buildType}-v${VERSION}`;
const sourceDir = path.join(DIST, folderName);

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
function run(cmd, opts = {}) {
  if (DRY_RUN) {
    log.info(`[dry-run] ${cmd}`);
    return '';
  }
  try {
    return execSync(cmd, { cwd: ROOT, stdio: opts.inherit ? 'inherit' : 'pipe', encoding: 'utf8' });
  } catch (err) {
    if (opts.ignoreError) return '';
    throw new Error(`Commande échouée : ${cmd}\n${err.stderr || err.message}`);
  }
}

function checkCommand(cmd) {
  const result = spawnSync(cmd, ['--version'], { stdio: 'pipe', shell: true });
  return result.status === 0;
}

async function ensureBuild() {
  if (!existsSync(sourceDir)) {
    log.err(`Build introuvable : ${sourceDir}`);
    log.info(`Lancez d'abord : ${c.cyan}npm run build${c.reset}`);
    process.exit(1);
  }
  const stats = await fs.stat(sourceDir);
  if (!stats.isDirectory()) {
    log.err(`${sourceDir} n'est pas un dossier`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Déploiement GitHub Pages
// ---------------------------------------------------------------------------
async function deployGitHub() {
  log.step(`Déploiement GitHub Pages (${c.bold}${buildType}${c.reset})`);

  // Vérifications
  if (!existsSync(path.join(ROOT, '.git'))) {
    log.err('Pas de dépôt git détecté à la racine');
    log.info('Initialisez : git init && git remote add origin <url>');
    process.exit(1);
  }

  const remoteUrl = run('git config --get remote.origin.url', { ignoreError: true }).trim();
  if (!remoteUrl) {
    log.err('Aucun remote "origin" configuré');
    log.info('Configurez : git remote add origin <url>');
    process.exit(1);
  }
  log.info(`Remote : ${remoteUrl}`);

  const currentBranch = run('git rev-parse --abbrev-ref HEAD').trim();
  const gitStatus = run('git status --porcelain', { ignoreError: true }).trim();
  if (gitStatus && !DRY_RUN) {
    log.warn('Des modifications non commitées existent');
    log.dim('Elles ne seront PAS incluses dans le déploiement (on déploie dist/)');
  }

  if (DRY_RUN) {
    log.info(`[dry-run] git checkout --orphan gh-pages`);
    log.info(`[dry-run] copie de ${folderName}/ vers la racine`);
    log.info(`[dry-run] git add . && git commit && git push origin gh-pages`);
    log.info(`[dry-run] git checkout ${currentBranch}`);
    return { url: 'https://votre-org.github.io/simple-mapper/' };
  }

  // Utilise un sous-dossier temporaire pour éviter de polluer le repo
  const tmpDir = path.join(ROOT, '.gh-pages-tmp');
  if (existsSync(tmpDir)) await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    // Copier le contenu du build dans le dossier temporaire
    log.info('Préparation du contenu…');
    await copyDirContents(sourceDir, tmpDir);

    // Créer un fichier .nojekyll (nécessaire pour GitHub Pages avec des fichiers _*)
    await fs.writeFile(path.join(tmpDir, '.nojekyll'), '');

    // Basculer sur une branche orpheline
    log.info('Création de la branche gh-pages (orpheline)…');
    run('git stash push -u -m "deploy-tmp"', { ignoreError: true });
    run('git checkout --orphan gh-pages-tmp');
    run('git rm -rf . --quiet', { ignoreError: true });

    // Copier le contenu depuis tmpDir
    for (const entry of await fs.readdir(tmpDir)) {
      await fs.cp(path.join(tmpDir, entry), path.join(ROOT, entry), { recursive: true });
    }

    // Commit + push
    run(`git add -A`);
    const commitMsg = `deploy: v${VERSION} (${buildType}) — ${new Date().toISOString()}`;
    run(`git -c user.email="deploy@simple-mapper" -c user.name="Deploy Bot" commit -m "${commitMsg}" --quiet`, { ignoreError: true });

    log.info('Push vers origin/gh-pages…');
    run('git push origin HEAD:gh-pages --force', { inherit: true });

    // Retour à la branche d'origine
    log.info(`Retour sur ${currentBranch}…`);
    run(`git checkout ${currentBranch} --quiet`);
    run('git branch -D gh-pages-tmp --quiet', { ignoreError: true });
    run('git stash pop --quiet', { ignoreError: true });

    // Extraire le nom du repo pour l'URL
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    const url = match
      ? `https://${match[1]}.github.io/${match[2]}/`
      : '(URL inconnue — vérifier GitHub Pages)';

    log.ok(`Déployé sur GitHub Pages`);
    log.dim(`URL : ${url}`);
    log.dim(`N'oubliez pas d'activer GitHub Pages dans Settings → Pages → Source : gh-pages`);

    return { url };
  } finally {
    if (existsSync(tmpDir)) await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function copyDirContents(src, dest) {
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyDirContents(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Déploiement Netlify
// ---------------------------------------------------------------------------
async function deployNetlify() {
  log.step(`Déploiement Netlify (${c.bold}${buildType}${c.reset})`);

  // Détection de la méthode
  const hasCli = checkCommand('netlify');
  const hasToken = !!process.env.NETLIFY_AUTH_TOKEN;
  const hasSiteId = !!process.env.NETLIFY_SITE_ID;

  if (!hasCli && !(hasToken && hasSiteId)) {
    log.err('Netlify non configuré');
    log.info('Deux options :');
    log.dim('  Option A (recommandée) : npm i -g netlify-cli && netlify login');
    log.dim('  Option B : export NETLIFY_AUTH_TOKEN=xxx && export NETLIFY_SITE_ID=yyy');
    process.exit(1);
  }

  if (hasCli) {
    log.info('Méthode : Netlify CLI');

    if (DRY_RUN) {
      log.info(`[dry-run] netlify deploy --prod --dir="${sourceDir}"`);
      return { url: '(URL Netlify)' };
    }

    // Vérifier l'authentification
    try {
      run('netlify status');
    } catch (err) {
      log.err('Non connecté à Netlify');
      log.info('Lancez : netlify login');
      process.exit(1);
    }

    log.info(`Upload de ${folderName}/…`);
    const output = run(
      `netlify deploy --prod --dir="${sourceDir}" --message="v${VERSION} (${buildType})"`,
      { inherit: true }
    );

    log.ok('Déployé sur Netlify');
    return { url: '(voir la sortie de netlify deploy)' };
  }

  // Fallback : API directe
  log.info('Méthode : API Netlify (token)');
  if (DRY_RUN) {
    log.info(`[dry-run] POST https://api.netlify.com/api/v1/sites/${process.env.NETLIFY_SITE_ID}/deploys`);
    return { url: '(URL Netlify)' };
  }

  // Utiliser netlify-cli en mode headless avec le token
  log.warn('Utilisez netlify-cli pour cette méthode');
  log.info(`NETLIFY_AUTH_TOKEN=${hasToken ? '✓ défini' : '✗ manquant'}`);
  log.info(`NETLIFY_SITE_ID=${hasSiteId ? '✓ défini' : '✗ manquant'}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n${c.bold}${c.magenta}🚀 Simple Mapper — Deploy v${VERSION}${c.reset}`);
  console.log(`${c.dim}   Type : ${buildType}${DRY_RUN ? ' · dry-run' : ''}${c.reset}`);

  await ensureBuild();
  log.ok(`Build trouvé : ${folderName}`);

  // Aucun flag → demander interactivement
  let deployGh = DEPLOY_GITHUB;
  let deployNf = DEPLOY_NETLIFY;

  if (!DEPLOY_GITHUB && !DEPLOY_NETLIFY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log(`\n${c.bold}Que voulez-vous déployer ?${c.reset}`);
    console.log(`  1. ${c.cyan}GitHub Pages${c.reset}`);
    console.log(`  2. ${c.cyan}Netlify${c.reset}`);
    console.log(`  3. ${c.cyan}Les deux${c.reset}`);
    console.log(`  4. ${c.dim}Annuler${c.reset}`);
    const answer = await rl.question('\nChoix (1-4) : ');
    rl.close();

    if (answer === '1') deployGh = true;
    else if (answer === '2') deployNf = true;
    else if (answer === '3') { deployGh = true; deployNf = true; }
    else { console.log('Annulé.'); return; }
  }

  const results = [];

  if (deployGh) {
    try {
      results.push({ target: 'GitHub Pages', ...(await deployGitHub()) });
    } catch (err) {
      log.err(`GitHub Pages : ${err.message}`);
    }
  }

  if (deployNf) {
    try {
      results.push({ target: 'Netlify', ...(await deployNetlify()) });
    } catch (err) {
      log.err(`Netlify : ${err.message}`);
    }
  }

  // Résumé
  console.log(`\n${c.bold}${c.green}✅ Déploiement terminé${c.reset}\n`);
  for (const r of results) {
    console.log(`  ${c.cyan}${r.target}${c.reset}`);
    console.log(`    ${c.dim}URL : ${r.url}${c.reset}\n`);
  }
}

main().catch((err) => {
  console.error(`\n${c.red}✗ Deploy échoué :${c.reset}`, err.message);
  if (err.stack) console.error(c.dim(err.stack));
  process.exit(1);
});