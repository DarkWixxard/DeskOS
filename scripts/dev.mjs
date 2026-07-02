#!/usr/bin/env node
// DeskOS Dev-Launcher
//
// Liest die zentrale Root-.env und startet Backend + Frontend mit den dort
// konfigurierten Ports. Ersetzt das frühere POSIX-"&"-Konstrukt und
// funktioniert dadurch auch unter Windows.
//
// Wichtig: Backend und Next.js lesen beide process.env.PORT. Deshalb werden
// hier getrennte Variablen (BACKEND_PORT / FRONTEND_PORT) verwendet und der
// Backend-Port zusätzlich als NEXT_PUBLIC_BACKEND_PORT an das Frontend
// durchgereicht, damit custom Ports auch im Dev "just work".

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// Root-.env laden, ohne bereits gesetzte Shell-Variablen zu überschreiben.
try {
  const content = readFileSync(join(rootDir, '.env'), 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (key in process.env) continue;
    process.env[key] = match[2].replace(/^["']|["']$/g, '');
  }
} catch {
  // Keine .env vorhanden -> es greifen die Defaults unten.
}

const FRONTEND_PORT = process.env.FRONTEND_PORT || '4000';
const BACKEND_PORT = process.env.BACKEND_PORT || '4001';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Preflight: sicherstellen, dass die Workspace-Abhängigkeiten installiert und
// aktuell sind. Ohne das läuft "npm run dev" mit veraltetem node_modules an und
// scheitert erst zur Laufzeit mit "Module not found" (z. B. @xterm/xterm), wenn
// eine neue Abhängigkeit dazukam, aber kein "npm install" lief.
//
// Heuristik über npms verstecktes Lockfile (node_modules/.package-lock.json),
// das npm nach jeder Installation schreibt:
//   - node_modules fehlt            -> installieren
//   - verstecktes Lockfile fehlt    -> Installation unvollständig -> installieren
//   - package-lock.json ist neuer   -> Abhängigkeiten geändert    -> installieren
// Abschaltbar über DESKOS_SKIP_INSTALL=1.
function ensureDependencies() {
  if (process.env.DESKOS_SKIP_INSTALL === '1') return;

  const nodeModules = join(rootDir, 'node_modules');
  const lockfile = join(rootDir, 'package-lock.json');
  const installedLock = join(nodeModules, '.package-lock.json');

  let reason = '';
  if (!existsSync(nodeModules)) {
    reason = 'node_modules fehlt';
  } else if (!existsSync(installedLock)) {
    reason = 'Installation unvollständig';
  } else if (existsSync(lockfile)) {
    try {
      if (statSync(lockfile).mtimeMs > statSync(installedLock).mtimeMs) {
        reason = 'package-lock.json ist neuer als die letzte Installation';
      }
    } catch {
      // mtime nicht lesbar -> nicht blockieren, Start wie gehabt.
    }
  }

  if (!reason) return;

  console.log(`📦 Abhängigkeiten werden installiert (${reason}) …`);
  const result = spawnSync(npm, ['install'], {
    stdio: 'inherit',
    cwd: rootDir,
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error('❌ npm install fehlgeschlagen — bitte manuell "npm install" ausführen.');
    process.exit(result.status ?? 1);
  }
}

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGINT');
  }
  process.exit(code);
}

function start(args, extraEnv) {
  const child = spawn(npm, args, {
    stdio: 'inherit',
    cwd: rootDir,
    env: { ...process.env, ...extraEnv },
    // Windows benötigt für .cmd-Dateien (npm.cmd) shell:true, sonst wirft
    // Node >=18.20.2/20.12.2 wegen CVE-2024-27980 ein "spawn EINVAL".
    shell: process.platform === 'win32',
  });
  // Endet ein Prozess, wird der andere ebenfalls beendet.
  child.on('exit', (code) => shutdown(code ?? 0));
  children.push(child);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

ensureDependencies();

console.log(`▶ DeskOS dev — Backend :${BACKEND_PORT}, Frontend :${FRONTEND_PORT}, Simulator`);

start(['run', 'dev', '--workspace=apps/backend'], {
  BACKEND_PORT,
});
start(['run', 'dev', '--workspace=apps/frontend', '--', '-p', FRONTEND_PORT], {
  NEXT_PUBLIC_BACKEND_PORT: BACKEND_PORT,
  // Shared-Token (falls gesetzt) ans Frontend durchreichen, damit es API+WS authentifiziert.
  NEXT_PUBLIC_DESKOS_TOKEN: process.env.DESKOS_TOKEN || '',
});
start(['run', 'dev', '--workspace=apps/simulator'], {});
