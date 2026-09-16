import { appendFile, readFile } from 'node:fs/promises';
import type { HoltEvent } from './types.ts';

export async function appendEvent(historyPath: string, event: HoltEvent): Promise<void> {
  const line = `${JSON.stringify(event)}\n`;
  await appendFile(historyPath, line, 'utf8');
}

export async function readEvents(historyPath: string): Promise<HoltEvent[]> {
  let raw = '';
  try {
    raw = await readFile(historyPath, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HoltEvent);
}
