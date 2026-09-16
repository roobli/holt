/** Parse / display helpers for estimate (+ dual-write minutes). 1d = 8h. */

const ESTIMATE_RE = /^\s*(\d+(?:\.\d+)?)\s*([mhd])?\s*$/i;

export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 8;
export const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;

export class EstimateParseError extends Error {
  constructor(raw: string) {
    super(`估时格式应为 45m / 2h / 1d（收到: ${JSON.stringify(raw)}）`);
    this.name = 'EstimateParseError';
  }
}

/** Parse user estimate string → non-negative minutes (floored). */
export function parseEstimateToMinutes(raw: string): number {
  const m = ESTIMATE_RE.exec(raw);
  if (!m) throw new EstimateParseError(raw);
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) throw new EstimateParseError(raw);
  const unit = (m[2] ?? 'm').toLowerCase();
  let minutes: number;
  if (unit === 'h') minutes = n * MINUTES_PER_HOUR;
  else if (unit === 'd') minutes = n * MINUTES_PER_DAY;
  else minutes = n;
  return Math.floor(minutes);
}

/** Prefer raw `estimate`; fallback legacy `estimate_min` → `Nm`. */
export function displayEstimate(meta: {
  estimate?: string;
  estimate_min?: number;
}): string | undefined {
  if (meta.estimate != null && String(meta.estimate).trim() !== '') {
    return String(meta.estimate).trim();
  }
  if (meta.estimate_min != null && Number.isFinite(meta.estimate_min)) {
    return `${meta.estimate_min}m`;
  }
  return undefined;
}

/** Normalized minutes for block height: from estimate string or legacy min. */
export function estimateMinutesOf(meta: {
  estimate?: string;
  estimate_min?: number;
}): number | undefined {
  if (meta.estimate != null && String(meta.estimate).trim() !== '') {
    try {
      return parseEstimateToMinutes(String(meta.estimate));
    } catch {
      /* fall through to legacy */
    }
  }
  if (meta.estimate_min != null && Number.isFinite(meta.estimate_min)) {
    return meta.estimate_min;
  }
  return undefined;
}

/** Apply estimate string → dual-write estimate + estimate_min on meta-like object. */
export function applyEstimateDualWrite(
  target: { estimate?: string; estimate_min?: number },
  raw: string | null,
): void {
  if (raw === null || raw.trim() === '') {
    delete target.estimate;
    delete target.estimate_min;
    return;
  }
  const trimmed = raw.trim();
  const minutes = parseEstimateToMinutes(trimmed);
  target.estimate = trimmed;
  target.estimate_min = minutes;
}
