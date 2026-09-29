/** Value formatting for the Time & fees grid. Pure functions, no DOM. */

const EM_DASH = '\u2013';

/** Hours in a period cell: integers stay integers, fractions keep up to two decimals. */
export function formatHours(value: number): string {
  if (!isFinite(value) || Math.abs(value) < 0.005) return EM_DASH;
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : stripTrailingZeros(rounded.toFixed(2));
}

/** Rates and counts: whole numbers, thousands separators dropped for density. */
export function formatRate(value: number): string {
  if (!isFinite(value)) return EM_DASH;
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : stripTrailingZeros(rounded.toFixed(2));
}

/** Fees are shown in thousands to match the canvas app's DisplayThousand column. */
export function formatThousands(value: number): string {
  if (!isFinite(value) || value === 0) return EM_DASH;
  const thousands = value / 1000;
  const text = Math.abs(thousands) >= 100 ? String(Math.round(thousands)) : stripTrailingZeros(thousands.toFixed(1));
  return text;
}

/** A fraction (0.29) as a whole percentage. */
export function formatPercent(fraction: number): string {
  if (!isFinite(fraction) || fraction === 0) return EM_DASH;
  return `${Math.round(fraction * 100)}%`;
}

/** Seed text for the inline editor. */
export function formatEditableNumber(value: number): string {
  if (!isFinite(value) || value === 0) return '';
  return Number.isInteger(value) ? String(value) : stripTrailingZeros(value.toFixed(4));
}

/**
 * Parses hours/rates typed by a user. Accepts a comma as the decimal separator.
 * Returns null for anything that is not a usable number so the caller can revert.
 */
export function parseEditableNumber(text: string): number | null {
  const normalised = text.trim().replace(/\s/g, '').replace(',', '.');
  if (normalised === '') return 0;
  if (!/^-?\d*\.?\d*$/.test(normalised)) return null;
  const value = Number(normalised);
  if (!isFinite(value)) return null;
  if (value < 0) return null;
  if (value > 100000) return null;
  return Math.round(value * 10000) / 10000;
}

/** Up to two letters for the row avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_TONES = 6;

/** Deterministic tone index so a person keeps the same avatar colour across renders. */
export function avatarTone(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 100000;
  }
  return hash % AVATAR_TONES;
}

function stripTrailingZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}
