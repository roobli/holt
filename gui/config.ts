/**
 * Local GUI preferences (last ledger path). Not the task ledger itself.
 * Stored at ~/.config/holt/gui.json
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface GuiConfig {
  lastLedger?: string;
}

function configDir(): string {
  return join(homedir(), '.config', 'holt');
}

export function guiConfigPath(): string {
  return join(configDir(), 'gui.json');
}

export async function loadGuiConfig(): Promise<GuiConfig> {
  try {
    const raw = await readFile(guiConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as GuiConfig;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveGuiConfig(partial: GuiConfig): Promise<GuiConfig> {
  await mkdir(configDir(), { recursive: true });
  const prev = await loadGuiConfig();
  const next: GuiConfig = { ...prev, ...partial };
  await writeFile(guiConfigPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}
