/**
 * Studio-configurable colours.
 *
 * Each colour is a text property in the manifest, so a maker can paste a hex value or an
 * `rgb()`/`rgba()` function into the component's property pane. Anything unreadable falls back to
 * the Fluent default, so a half-filled pane can never render an unusable grid.
 *
 * The values are handed to the stylesheet as CSS custom properties on the grid root, which is the
 * single place the defaults live; nothing below reads a literal brand colour.
 *
 * Every fill that can land on a pinned column is composited over the grid background before it is
 * handed over, so it stays opaque: a translucent tint would let the timeline scroll through the
 * person and rate columns.
 */

/** Property names read from the host, in the order the property pane lists them. */
export const COLOR_PROPERTIES = {
  accent: 'accentColor',
  background: 'backgroundColor',
  header: 'headerColor',
  text: 'textColor',
  overCapacity: 'overCapacityColor',
  overCapacityText: 'overCapacityTextColor',
  border: 'borderColor',
  mutedText: 'mutedTextColor',
  hover: 'hoverColor',
  subtleBackground: 'subtleBackgroundColor',
  danger: 'dangerColor',
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
  /** Cell separators, grid lines and the scrollbar. */
  border: string;
  /** Secondary text: job level and team, header labels, totals captions and hints. */
  mutedText: string;
  /** Row fill under the pointer. */
  hover: string;
  /** Subtle fill behind hovered buttons and segments. */
  subtleBackground: string;
  /** Destructive affordances: the row remove button and the error banner. */
  danger: string;
}

export const DEFAULT_COLORS: GridColors = {
  accent: '#0f6cbd',
  background: '#ffffff',
  header: '#f3f2f1',
  text: '#201f1e',
  overCapacity: '#fff8e1',
  overCapacityText: '#8a6116',
  border: '#edebe9',
  mutedText: '#605e5c',
  hover: '#f8f8f7',
  subtleBackground: '#faf9f8',
  danger: '#a4262c',
};

/** colorBrandBackgroundHover and colorBrandBackgroundPressed of Fluent's web light theme. */
const FLUENT_BRAND_HOVER = '#115ea3';
const FLUENT_BRAND_PRESSED = '#0c3b5e';
/** How far a custom accent is darkened for the button's hover and pressed states. */
const BUTTON_HOVER_ALPHA = 0.14;
const BUTTON_PRESSED_ALPHA = 0.5;

/** Alpha of the soft accent chrome (selected segment, status strip, pricing chip). */
const SOFT_ALPHA = 0.1;
/** Alpha the accent is composited at for the row that holds the focused cell. */
const ACTIVE_ROW_ALPHA = 0.06;
/** Alpha the accent is composited at for the focused cell itself. */
const ACTIVE_CELL_ALPHA = 0.1;
/** Alpha the danger colour is composited at for its soft fill. */
const DANGER_SOFT_ALPHA = 0.08;
/** How far muted text is mixed toward the background for the softest text. */
const SOFT_TEXT_ALPHA = 0.62;
/** How much the border colour is darkened for the stronger separators. */
const BORDER_STRONG_DARKEN = 0.12;
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

/** The colour as typed, with an alpha, as `rgba(...)`. */
function withAlpha(color: string, alpha: number, fallback: string): string {
  const parsed = parseColor(color);
  if (!parsed) {
    return fallback;
  }
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`;
}

/** `color` composited over `base` at `alpha`, always opaque. */
/**
 * The hover or pressed fill of the primary button. The default accent is Fluent's brand colour, so
 * it takes Fluent's own shade, the one a modern Power Apps button uses; any other accent is darkened
 * by about the same amount.
 */
function buttonShade(accent: string, fluentShade: string, alpha: number): string {
  return accent.toLowerCase() === DEFAULT_COLORS.accent ? fluentShade : blendOver('#000000', accent, alpha, fluentShade);
}

function blendOver(color: string, base: string, alpha: number, fallback: string): string {
  const top = parseColor(color);
  const bottom = parseColor(base);
  if (!top || !bottom) {
    return fallback;
  }
  const channel = (upper: number, lower: number): number => Math.round(upper * alpha + lower * (1 - alpha));
  return `rgb(${channel(top.r, bottom.r)}, ${channel(top.g, bottom.g)}, ${channel(top.b, bottom.b)})`;
}

function darken(color: string, amount: number, fallback: string): string {
  const parsed = parseColor(color);
  if (!parsed) {
    return fallback;
  }
  const scale = 1 - amount;
  return `rgb(${Math.round(parsed.r * scale)}, ${Math.round(parsed.g * scale)}, ${Math.round(parsed.b * scale)})`;
}

/** The colour as typed when it is already opaque, else flattened over white. */
function opaque(color: string, fallback: string): string {
  const parsed = parseColor(color);
  if (!parsed) {
    return fallback;
  }
  return parsed.a >= 1 ? color : blendOver(color, '#ffffff', parsed.a, fallback);
}

/** Reads the colour properties through `read` (the raw value of a property, by name). */
export function readColors(read: (name: string) => unknown): GridColors {
  return {
    accent: normalizeColor(read(COLOR_PROPERTIES.accent), DEFAULT_COLORS.accent),
    background: normalizeColor(read(COLOR_PROPERTIES.background), DEFAULT_COLORS.background),
    header: normalizeColor(read(COLOR_PROPERTIES.header), DEFAULT_COLORS.header),
    text: normalizeColor(read(COLOR_PROPERTIES.text), DEFAULT_COLORS.text),
    overCapacity: normalizeColor(read(COLOR_PROPERTIES.overCapacity), DEFAULT_COLORS.overCapacity),
    overCapacityText: normalizeColor(read(COLOR_PROPERTIES.overCapacityText), DEFAULT_COLORS.overCapacityText),
    border: normalizeColor(read(COLOR_PROPERTIES.border), DEFAULT_COLORS.border),
    mutedText: normalizeColor(read(COLOR_PROPERTIES.mutedText), DEFAULT_COLORS.mutedText),
    hover: normalizeColor(read(COLOR_PROPERTIES.hover), DEFAULT_COLORS.hover),
    subtleBackground: normalizeColor(read(COLOR_PROPERTIES.subtleBackground), DEFAULT_COLORS.subtleBackground),
    danger: normalizeColor(read(COLOR_PROPERTIES.danger), DEFAULT_COLORS.danger),
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
    left.overCapacityText === right.overCapacityText &&
    left.border === right.border &&
    left.mutedText === right.mutedText &&
    left.hover === right.hover &&
    left.subtleBackground === right.subtleBackground &&
    left.danger === right.danger
  );
}

/**
 * The CSS custom properties the stylesheet reads. Everything the grid paints on top of another
 * surface - the active row, the active cell, the over-capacity fill - is opaque, because the
 * timeline scrolls underneath the pinned columns.
 */
export function colorVars(colors: GridColors): Record<string, string> {
  const background = opaque(colors.background, DEFAULT_COLORS.background);
  return {
    '--tfg-accent': colors.accent,
    '--tfg-accent-hover': buttonShade(colors.accent, FLUENT_BRAND_HOVER, BUTTON_HOVER_ALPHA),
    '--tfg-accent-pressed': buttonShade(colors.accent, FLUENT_BRAND_PRESSED, BUTTON_PRESSED_ALPHA),
    '--tfg-accent-soft': withAlpha(colors.accent, SOFT_ALPHA, DEFAULT_COLORS.accent),
    '--tfg-active-row': blendOver(colors.accent, background, ACTIVE_ROW_ALPHA, DEFAULT_COLORS.accent),
    '--tfg-active-cell': blendOver(colors.accent, background, ACTIVE_CELL_ALPHA, DEFAULT_COLORS.accent),
    '--tfg-bg': background,
    '--tfg-bg-head': opaque(colors.header, DEFAULT_COLORS.header),
    '--tfg-bg-foot': opaque(colors.header, DEFAULT_COLORS.header),
    '--tfg-bg-subtle': opaque(colors.subtleBackground, DEFAULT_COLORS.subtleBackground),
    '--tfg-text': colors.text,
    '--tfg-text-muted': colors.mutedText,
    '--tfg-text-soft': blendOver(colors.mutedText, background, SOFT_TEXT_ALPHA, DEFAULT_COLORS.mutedText),
    '--tfg-hover': opaque(colors.hover, DEFAULT_COLORS.hover),
    '--tfg-border': opaque(colors.border, DEFAULT_COLORS.border),
    '--tfg-border-strong': darken(colors.border, BORDER_STRONG_DARKEN, DEFAULT_COLORS.border),
    '--tfg-danger': colors.danger,
    '--tfg-danger-soft': blendOver(colors.danger, background, DANGER_SOFT_ALPHA, DEFAULT_COLORS.danger),
    '--tfg-warn-bg': opaque(colors.overCapacity, DEFAULT_COLORS.overCapacity),
    '--tfg-warn-strong': darken(colors.overCapacity, OVER_CAPACITY_ACTIVE_DARKEN, DEFAULT_COLORS.overCapacity),
    '--tfg-warn-text': colors.overCapacityText,
  };
}
