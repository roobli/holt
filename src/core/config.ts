/**
 * Shared holt preferences (CLI + GUI). Not the task ledger itself.
 * Stored at $XDG_CONFIG_HOME/holt/config.json (default ~/.config/holt/config.json).
 * Falls back to legacy ~/.config/holt/gui.json for lastLedger on read.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface HoltConfig {
  lastLedger?: string;
}

export function holtConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return join(xdg, 'holt');
  return join(homedir(), '.config', 'holt');
}

export function holtConfigPath(): string {
  return join(holtConfigDir(), 'config.json');
}

/** Legacy GUI-only path; still read as fallback. */
export function legacyGuiConfigPath(): string {
  return join(holtConfigDir(), 'gui.json');
}

async function readJsonFile(path: string): Promise<HoltConfig | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as HoltConfig;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return null;
  }
}

export async function loadHoltConfig(): Promise<HoltConfig> {
  const primary = await readJsonFile(holtConfigPath());
  if (primary && typeof primary.lastLedger === 'string' && primary.lastLedger.trim()) {
    return primary;
  }
  const legacy = await readJsonFile(legacyGuiConfigPath());
  if (legacy) {
    // Prefer primary fields, fill lastLedger from legacy when missing.
    return { ...legacy, ...primary };
  }
  return primary ?? {};
}

export async function saveHoltConfig(partial: HoltConfig): Promise<HoltConfig> {
  await mkdir(holtConfigDir(), { recursive: true });
  const prev = await loadHoltConfig();
  const next: HoltConfig = { ...prev, ...partial };
  await writeFile(holtConfigPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}
