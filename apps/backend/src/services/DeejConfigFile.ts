// deej-compatible config.yaml support.
//
// The original deej (https://github.com/omriharel/deej) is configured through a
// single `config.yaml`. Users coming from deej expect to edit that file, so
// DeskOS reads the exact same format: a `slider_mapping` (index -> target, where
// a target can be `master`, `mic`, `system`, `deej.current`, `deej.unmapped`, a
// process name, or a LIST of process names to form a group), plus
// `invert_sliders`, `com_port`, `baud_rate` and `noise_reduction`.
//
// This module is pure/string-level: it resolves where the file lives, parses it
// into a normalised config, and can render a config back to the commented deej
// format (used to seed a starter file on first run). The DeejService owns the
// side effects (reading/writing/watching + applying).

import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import type { DeejTarget, DeejNoiseReduction } from '@shared/types';

export interface ParsedDeejSlider {
  index: number;
  target: DeejTarget;
  apps?: string[];
  label: string;
}

export interface ParsedDeejConfig {
  comPort?: string;
  baud?: number;
  invert?: boolean;
  noiseReduction?: DeejNoiseReduction;
  sliders: ParsedDeejSlider[];
}

const NOISE_VALUES: DeejNoiseReduction[] = ['low', 'default', 'high'];

/** Human-friendly UI label for a target + optional app group. */
export function labelForTarget(target: DeejTarget, apps?: string[]): string {
  switch (target) {
    case 'master':
      return 'Master';
    case 'mic':
      return 'Mikrofon';
    case 'system':
      return 'System';
    case 'current':
      return 'Aktive App';
    case 'unmapped':
      return 'Frei';
    case 'app':
      if (!apps || apps.length === 0) return 'App';
      return apps.map((a) => a.replace(/\.exe$/i, '')).map((a) => a.charAt(0).toUpperCase() + a.slice(1)).join(' + ');
    default:
      return 'Regler';
  }
}

/** Map one slider_mapping value (string or list) to a target + app list. */
function mapValue(value: unknown): { target: DeejTarget; apps?: string[] } {
  if (Array.isArray(value)) {
    const apps = value.map((v) => String(v).trim()).filter(Boolean);
    return { target: 'app', apps };
  }
  const raw = String(value ?? '').trim();
  switch (raw.toLowerCase()) {
    case 'master':
      return { target: 'master' };
    case 'mic':
      return { target: 'mic' };
    case 'system':
      return { target: 'system' };
    case 'deej.current':
      return { target: 'current' };
    case 'deej.unmapped':
    case '':
      return { target: 'unmapped' };
    default:
      return { target: 'app', apps: [raw] };
  }
}

/** Parse deej-format YAML text into a normalised config. Never throws on bad input. */
export function parseDeejConfig(text: string): ParsedDeejConfig {
  let doc: any = {};
  try {
    doc = yaml.load(text) ?? {};
  } catch {
    doc = {};
  }

  const result: ParsedDeejConfig = { sliders: [] };

  if (typeof doc.com_port === 'string') result.comPort = doc.com_port.trim();
  if (typeof doc.baud_rate === 'number') result.baud = doc.baud_rate;
  if (typeof doc.invert_sliders === 'boolean') result.invert = doc.invert_sliders;
  if (typeof doc.noise_reduction === 'string' && NOISE_VALUES.includes(doc.noise_reduction as DeejNoiseReduction)) {
    result.noiseReduction = doc.noise_reduction as DeejNoiseReduction;
  }

  const mapping = doc.slider_mapping;
  if (mapping && typeof mapping === 'object') {
    // Collect the explicit indices, then fill any gaps up to the max with 'Frei'.
    const byIndex = new Map<number, { target: DeejTarget; apps?: string[] }>();
    let maxIndex = -1;
    for (const key of Object.keys(mapping)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index > 32) continue;
      byIndex.set(index, mapValue(mapping[key]));
      maxIndex = Math.max(maxIndex, index);
    }
    for (let i = 0; i <= maxIndex; i++) {
      const m = byIndex.get(i) ?? { target: 'unmapped' as DeejTarget };
      result.sliders.push({ index: i, target: m.target, apps: m.apps, label: labelForTarget(m.target, m.apps) });
    }
  }

  return result;
}

/** Render a config back to the commented deej-format YAML (used to seed a file). */
export function configToYaml(cfg: {
  comPort: string;
  baud: number;
  invert: boolean;
  noiseReduction: DeejNoiseReduction;
  sliders: { index: number; target: DeejTarget; apps?: string[] }[];
}): string {
  const lines: string[] = [];
  lines.push('# DeskOS – deej-kompatible Konfiguration (Format wie https://github.com/omriharel/deej)');
  lines.push('#');
  lines.push('# slider_mapping: Regler-Index -> Ziel. Mögliche Ziele:');
  lines.push("#   master            – System-Gesamtlautstärke");
  lines.push("#   mic               – Mikrofon / Standard-Eingabegerät");
  lines.push("#   system            – System-/Benachrichtigungston (nur Windows)");
  lines.push("#   deej.current      – gerade aktive Anwendung (nur Windows)");
  lines.push("#   deej.unmapped     – nicht zugewiesen");
  lines.push("#   <prozess.exe>     – eine App (z. B. spotify.exe)");
  lines.push('#   eine Liste        – eine Gruppe mehrerer Apps (siehe Beispiel unten)');
  lines.push('# Wichtig: Der Index startet bei 0 und entspricht der Reihenfolge in der seriellen Zeile.');
  lines.push('slider_mapping:');
  for (const s of cfg.sliders) {
    if (s.target === 'app' && s.apps && s.apps.length > 1) {
      lines.push(`  ${s.index}:`);
      for (const app of s.apps) lines.push(`    - ${app}`);
    } else {
      lines.push(`  ${s.index}: ${targetToYamlValue(s.target, s.apps)}`);
    }
  }
  lines.push('');
  lines.push('# Regler invertieren (true = oben 0 %, unten 100 %)');
  lines.push(`invert_sliders: ${cfg.invert}`);
  lines.push('');
  lines.push('# Verbindung zum Arduino/deej-Board');
  lines.push(`com_port: ${cfg.comPort || 'COM3'}`);
  lines.push(`baud_rate: ${cfg.baud}`);
  lines.push('');
  lines.push('# Rauschunterdrückung: "low" (gute Hardware), "default" oder "high" (verrauscht)');
  lines.push(`noise_reduction: ${cfg.noiseReduction}`);
  lines.push('');
  return lines.join('\n');
}

function targetToYamlValue(target: DeejTarget, apps?: string[]): string {
  switch (target) {
    case 'master':
      return 'master';
    case 'mic':
      return 'mic';
    case 'system':
      return 'system';
    case 'current':
      return 'deej.current';
    case 'unmapped':
      return 'deej.unmapped';
    case 'app':
      return apps && apps[0] ? apps[0] : 'deej.unmapped';
    default:
      return 'deej.unmapped';
  }
}

/**
 * Decide where config.yaml lives. Honour DEEJ_CONFIG, then look next to the
 * process (cwd) and at the repo root; if none exists yet, return the repo-root
 * path as the place to create a starter file.
 */
export function resolveConfigPath(): { path: string; exists: boolean } {
  const repoRoot = path.join(__dirname, '..', '..', '..', '..');
  const candidates = [
    process.env.DEEJ_CONFIG,
    path.resolve(process.cwd(), 'config.yaml'),
    path.resolve(process.cwd(), '..', '..', 'config.yaml'),
    path.join(repoRoot, 'config.yaml'),
  ].filter((p): p is string => !!p);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return { path: p, exists: true };
    } catch {
      /* ignore */
    }
  }
  // Nothing exists yet: prefer DEEJ_CONFIG if set, otherwise the repo root.
  return { path: process.env.DEEJ_CONFIG || path.join(repoRoot, 'config.yaml'), exists: false };
}
