#!/usr/bin/env node
// DeskOS Agent-Launcher
//
// Startet den Remote-PC-Agent und stellt vorher sicher, dass seine
// Abhängigkeiten wirklich installiert sind.
//
// Hintergrund: der Agent wird meistens als *einzelner kopierter Ordner* auf den
// Remote-PC gebracht. Fehlt dort node_modules (Ordner ohne Installation kopiert,
// abgebrochenes "npm install", oder mit "--omit=dev"/"--production" installiert,
// wodurch das devDependency tsx fehlt), scheiterte "npm run dev" bisher mit der
// wenig hilfreichen Meldung der Windows-Shell:
//
//   Der Befehl "tsx" ist entweder falsch geschrieben oder konnte nicht gefunden werden.
//
// Dieser Launcher erkennt den Fall, installiert nach und startet tsx danach über
// seinen aufgelösten CLI-Pfad — also unabhängig von node_modules/.bin und PATH.

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const agentDir = join(dirname(fileURLToPath(import.meta.url)), '..');
// Auflösung ausdrücklich ab dem Agent-Ordner: findet tsx sowohl im kopierten
// Einzelordner (apps/agent/node_modules) als auch im Monorepo (Root-hoisted).
const requireFromAgent = createRequire(join(agentDir, 'package.json'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// --- Node-Version ----------------------------------------------------------
// Auf Remote-PCs steckt oft noch eine alte Node-Installation. Ohne diese
// Prüfung endet das später in Syntax-/Modulfehlern tief im Agent-Code.
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (Number.isFinite(nodeMajor) && nodeMajor < 18) {
  console.error(`❌ Node.js ${process.versions.node} ist zu alt — der Agent benötigt Node 18 oder neuer.`);
  console.error('   Aktuelle LTS-Version: https://nodejs.org/');
  process.exit(1);
}

// --- Monorepo oder kopierter Einzelordner? ---------------------------------
// Im Monorepo liegen die Abhängigkeiten (hoisted) im Repo-Root, im kopierten
// Ordner direkt daneben. Danach richtet sich, wo "npm install" laufen muss.
function findInstallDir() {
  const repoRoot = join(agentDir, '..', '..');
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    if (pkg.workspaces) return repoRoot;
  } catch {
    // Kein Repo-Root vorhanden -> der Agent-Ordner steht für sich allein.
  }
  return agentDir;
}

const installDir = findInstallDir();
const standalone = installDir === agentDir;

// --- .env bereitstellen ----------------------------------------------------
// Ohne .env läuft der Agent zwar (Defaults im Code), verbindet sich aber gegen
// die falsche Backend-URL — auf einem Remote-PC praktisch immer ein Fehlstart.
function ensureEnvFile() {
  const envFile = join(agentDir, '.env');
  const example = join(agentDir, '.env.example');
  if (existsSync(envFile) || !existsSync(example)) return;
  try {
    copyFileSync(example, envFile);
    console.log('⚙️  .env aus .env.example angelegt.');
    console.log(`   Bitte BACKEND_URL (und AGENT_NAME) anpassen: ${envFile}`);
  } catch (error) {
    console.warn('⚠️  .env konnte nicht angelegt werden:', error.message);
  }
}

// --- Abhängigkeiten sicherstellen ------------------------------------------
// Gleiche Heuristik wie im Root-Launcher (scripts/dev.mjs), über npms
// verstecktes Lockfile (node_modules/.package-lock.json):
//   - node_modules fehlt            -> installieren
//   - verstecktes Lockfile fehlt    -> Installation unvollständig -> installieren
//   - package-lock.json ist neuer   -> Abhängigkeiten geändert    -> installieren
//   - tsx nicht auflösbar           -> devDependencies fehlen     -> installieren
// Abschaltbar über DESKOS_SKIP_INSTALL=1.
function installReason(tsxMissing) {
  const nodeModules = join(installDir, 'node_modules');
  const lockfile = join(installDir, 'package-lock.json');
  const installedLock = join(nodeModules, '.package-lock.json');

  if (!existsSync(nodeModules)) return 'node_modules fehlt';
  if (!existsSync(installedLock)) return 'Installation unvollständig';
  if (tsxMissing) return 'tsx fehlt — vermutlich ohne devDependencies installiert';
  if (existsSync(lockfile)) {
    try {
      if (statSync(lockfile).mtimeMs > statSync(installedLock).mtimeMs) {
        return 'package-lock.json ist neuer als die letzte Installation';
      }
    } catch {
      // mtime nicht lesbar -> nicht blockieren, Start wie gehabt.
    }
  }
  return '';
}

function resolveTsxCli() {
  try {
    return requireFromAgent.resolve('tsx/cli');
  } catch {
    return null;
  }
}

function install(reason) {
  console.log(`📦 Abhängigkeiten werden installiert (${reason}) …`);
  console.log(`   Verzeichnis: ${installDir}`);
  // "--include=dev" erzwingt die devDependencies (u. a. tsx) auch dann, wenn
  // auf dem Rechner NODE_ENV=production oder npm config production=true gesetzt
  // ist — genau die Konstellation, die tsx sonst wieder verschwinden lässt.
  const result = spawnSync(npm, ['install', '--include=dev'], {
    stdio: 'inherit',
    cwd: installDir,
    env: process.env,
    // Windows benötigt für .cmd-Dateien (npm.cmd) shell:true, sonst wirft
    // Node >=18.20.2/20.12.2 wegen CVE-2024-27980 ein "spawn EINVAL".
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

ensureEnvFile();

let tsxCli = resolveTsxCli();
if (process.env.DESKOS_SKIP_INSTALL !== '1') {
  const reason = installReason(tsxCli === null);
  if (reason && install(reason)) tsxCli = resolveTsxCli();
}

if (!tsxCli) {
  console.error('❌ tsx wurde nicht gefunden — der Agent kann die TypeScript-Quellen nicht starten.');
  console.error('');
  console.error('   Bitte im Agent-Ordner ausführen:');
  console.error(`     cd "${agentDir}"`);
  console.error('     npm install --include=dev');
  console.error('');
  if (standalone) {
    console.error('   Hinweis: Dieser Ordner wurde ohne das übrige Repository kopiert.');
    console.error('   Das ist in Ordnung — er braucht dann aber eine eigene Installation.');
  }
  console.error('   Alternative ohne tsx (fertig gebaut auf dem Hauptrechner):');
  console.error('     npm run build   →   node dist/index.js');
  process.exit(1);
}

// tsx wird direkt über seinen CLI-Pfad gestartet (nicht über node_modules/.bin),
// damit weder PATH noch fehlende .bin-Shims den Start verhindern können.
const child = spawn(process.execPath, [tsxCli, 'watch', 'src/index.ts'], {
  stdio: 'inherit',
  cwd: agentDir,
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on('error', (error) => {
  console.error('❌ Agent konnte nicht gestartet werden:', error.message);
  process.exit(1);
});
