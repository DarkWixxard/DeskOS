#!/usr/bin/env node
// DeskOS – Oszi-USB-Doctor-Wrapper.
//
// Startet services/oszi/doctor.py mit dem venv-Python (services/oszi/.venv),
// damit die Diagnose plattformübergreifend per `npm run oszi:doctor` läuft.
// Fehlt die venv, wird auf `npm run setup:oszi` verwiesen.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const venvPython = isWin
  ? join(rootDir, 'services', 'oszi', '.venv', 'Scripts', 'python.exe')
  : join(rootDir, 'services', 'oszi', '.venv', 'bin', 'python');

if (!existsSync(venvPython)) {
  console.error('Keine Python-venv gefunden. Zuerst einrichten mit: npm run setup:oszi');
  process.exit(1);
}

const res = spawnSync(venvPython, ['services/oszi/doctor.py'], {
  stdio: 'inherit',
  cwd: rootDir,
});
process.exit(res.status ?? 1);
