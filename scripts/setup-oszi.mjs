#!/usr/bin/env node
// DeskOS – Oszi-Setup
//
// Richtet die Python-Umgebung für den Oszi-Dienst (services/oszi/oszi_server.py)
// ein: legt eine venv unter services/oszi/.venv an und installiert die schlanken
// Web-Abhängigkeiten aus services/oszi/requirements-web.txt.
//
// Idempotent – existiert die venv bereits, werden nur die Abhängigkeiten
// aktualisiert. Plattformübergreifend (nutzt nur Node + System-Python).
//
// Aufruf:  npm run setup:oszi

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

const osziDir = join(rootDir, 'services', 'oszi');
const venvDir = join(osziDir, '.venv');
const venvPython = isWin
  ? join(venvDir, 'Scripts', 'python.exe')
  : join(venvDir, 'bin', 'python');
const requirements = join(osziDir, 'requirements-web.txt');

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: rootDir, ...opts });
  return res.status === 0;
}

// System-Python finden: python3 bevorzugt, sonst python.
function findSystemPython() {
  for (const cand of ['python3', 'python']) {
    const res = spawnSync(cand, ['--version'], { stdio: 'ignore' });
    if (res.status === 0) return cand;
  }
  return null;
}

// 1. venv anlegen (falls noch nicht vorhanden) ------------------------------
if (!existsSync(venvPython)) {
  const py = findSystemPython();
  if (!py) {
    console.error('❌ Kein Python gefunden (python3/python). Bitte Python 3 installieren.');
    process.exit(1);
  }
  console.log(`🐍 Lege Python-venv an: ${venvDir}`);
  if (!run(py, ['-m', 'venv', venvDir])) {
    console.error('❌ venv konnte nicht erstellt werden.');
    console.error('   Unter Debian/Ubuntu ggf. zuerst:  sudo apt install python3-venv');
    process.exit(1);
  }
}

// 2. Abhängigkeiten installieren --------------------------------------------
console.log('📦 Installiere Oszi-Abhängigkeiten (flask, numpy, pyvisa, …) …');
run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], { stdio: 'ignore' });
if (!run(venvPython, ['-m', 'pip', 'install', '-r', requirements])) {
  console.error('❌ pip install fehlgeschlagen.');
  process.exit(1);
}

console.log('✅ Oszi-Setup fertig. Der Dienst startet ab jetzt automatisch mit "npm run dev".');
