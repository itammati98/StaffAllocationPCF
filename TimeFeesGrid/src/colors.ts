/**
 * Studio-configurable colours.
 *
 * Each colour is a text property in the manifest, so a maker can paste a hex value or an
 * `rgb()`/`rgba()` function into the component's property pane. Anything unreadable falls back to
 * the Fluent default, so a half-filled pane can never render an unusable grid.
 *
 * The values are handed to the stylesheet as CSS custom properties on the grid root, which is the
 * single place the defaults live; nothing below reads a literal brand colour.
 */

/** Property names read from the host, in the order the property pane lists them. */
export const COLOR_PROPERTIES = {
  accent: 'accentColor',
  background: 'backgroundColor',
  header: 'headerColor',
  text: 'textColor',
  overCapacity: 'overCapacityColor',
  overCapacityText: 'overCapacityTextColor',
} as const;

export interface GridColors {
  /** Buttons, focus rings, the selected segment, the active cell and the first avatar tone. */
  accent: string;
  /** Table and grid viewport background. */
  background: string;
  /** Header row and totals row background. */
  header: string;
  /** Body text. */
  text: string;
  /** Fill of a period cell that holds more hours than the period can take. */
  overCapacity: string;
  /** Text of a period cell that holds more hours than the period can take. */
  overCapacityText: string;
}

export const DEFAULT_COLORS: GridColors = {
  accent: '#0f6cbd',
  background: '#ffffff',
  header: '#f3f2f1',
  text: '#201f1e',
  overCapacity: '#fff8e1',
  overCapacityText: '#8a6116',
};

/** Alpha applied to the accent for soft fills: selected segment, active cell, active row. */
const SOFT_ALPHA = 0.1;
const ACTIVE_ROW_ALPHA = 0.06;
/** How much `overCapacity` is darkened for the active over-capacity cell. */
const OVER_CAPACITY_ACTIVE_DARKEN = 0.06;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_FUNCTION = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+)\s*)?\)$/i;

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Parses the colour shapes a maker can reasonably paste. Returns null for everything else
 * (a named colour, a `var(...)` reference, a half-typed value) so the caller keeps its default.
 */
function parseColor(value: string): Rgba | null {
  if (HEX.test(value)) {
    const digits = value.slice(1);
    const full = digits.length === 3 ? digits.split('').map((digit) => digit + digit).join('') : digits;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }
  const match = RGB_FUNCTION.exec(value);
  if (!match) {
    return null;
  }
  const channels = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (channels.some((channel) => channel > 255)) {
    return null;
  }
  return { r: channels[0], g: channels[1], b: channels[2], a: match[4] === undefined ? 1 : Number(match[4]) };
}

/** The colour as typed when it is usable, else `fallback`. */
export function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const text = value.trim();
  return parseColor(text) ? text : fallback;
}

function withAlpha(color: string, alpha: number, fallback: string): string {
  const parsed = parseColor(color);
  if (!parsed) {
    return fallback;
  }
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`;
}

function darken(color: string, amount: number, fallback: string): string {
  const parsed = parseColor(color);
  if (!parsed) {
    return fallback;
  }
  const scale = 1 - amount;
  return `rgb(${Math.round(parsed.r * scale)}, ${Math.round(parsed.g * scale)}, ${Math.round(parsed.b * scale)})`;
}

/** Reads the six colour properties through `read` (the raw value of a property, by name). */
export function readColors(read: (name: string) => unknown): GridColors {
  return {
    accent: normalizeColor(read(COLOR_PROPERTIES.accent), DEFAULT_COLORS.accent),
    background: normalizeColor(read(COLOR_PROPERTIES.background), DEFAULT_COLORS.background),
    header: normalizeColor(read(COLOR_PROPERTIES.header), DEFAULT_COLORS.header),
    text: normalizeColor(read(COLOR_PROPERTIES.text), DEFAULT_COLORS.text),
    overCapacity: normalizeColor(read(COLOR_PROPERTIES.overCapacity), DEFAULT_COLORS.overCapacity),
    overCapacityText: normalizeColor(read(COLOR_PROPERTIES.overCapacityText), DEFAULT_COLORS.overCapacityText),
  };
}

/** True when both palettes hold the same colours, so callers can keep a stable object. */
export function colorsEqual(left: GridColors, right: GridColors): boolean {
  return (
    left.accent === right.accent &&
    left.background === right.background &&
    left.header === right.header &&
    left.text === right.text &&
    left.overCapacity === right.overCapacity &&
    left.overCapacityText === right.overCapacityText
  );
}

/**
 * The CSS custom properties the stylesheet reads. Tints that used to be hardcoded (soft accent,
 * active row, the darker over-capacity fill) are derived from the maker's colours.
 */
export function colorVars(colors: GridColors): Record<string, string> {
  return {
    '--tfg-accent': colors.accent,
    '--tfg-accent-soft': withAlpha(colors.accent, SOFT_ALPHA, DEFAULT_COLORS.accent),
    '--tfg-active-row': withAlpha(colors.accent, ACTIVE_ROW_ALPHA, DEFAULT_COLORS.accent),
    '--tfg-bg': colors.background,
    '--tfg-bg-head': colors.header,
    '--tfg-bg-foot': colors.header,
    '--tfg-text': colors.text,
    '--tfg-warn-bg': colors.overCapacity,
    '--tfg-warn-strong': darken(colors.overCapacity, OVER_CAPACITY_ACTIVE_DARKEN, DEFAULT_COLORS.overCapacity),
    '--tfg-warn-text': colors.overCapacityText,
  };
}
