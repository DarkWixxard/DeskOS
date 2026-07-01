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

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  });
  // Endet ein Prozess, wird der andere ebenfalls beendet.
  child.on('exit', (code) => shutdown(code ?? 0));
  children.push(child);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

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
