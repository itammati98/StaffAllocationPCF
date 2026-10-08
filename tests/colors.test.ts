/**
 * The studio colour properties: what a maker may paste, what happens when it cannot be read, and
 * the CSS custom properties the stylesheet receives.
 */
import { describe, expect, it } from 'vitest';
import { colorsEqual, colorVars, DEFAULT_COLORS, normalizeColor, readColors } from '../TimeFeesGrid/src/colors';

describe('normalizeColor', () => {
  it('keeps the shapes a maker can paste', () => {
    expect(normalizeColor('#0f6cbd', '#000000')).toBe('#0f6cbd');
    expect(normalizeColor('#ABC', '#000000')).toBe('#ABC');
    expect(normalizeColor('  rgb(15, 108, 189) ', '#000000')).toBe('rgb(15, 108, 189)');
    expect(normalizeColor('rgba(15, 108, 189, 0.4)', '#000000')).toBe('rgba(15, 108, 189, 0.4)');
  });

  it('falls back for anything it cannot read, instead of rendering an unusable grid', () => {
    expect(normalizeColor('rebeccapurple', '#000000')).toBe('#000000');
    expect(normalizeColor('rgb(300, 0, 0)', '#000000')).toBe('#000000');
    expect(normalizeColor('var(--brand)', '#000000')).toBe('#000000');
    expect(normalizeColor('', '#000000')).toBe('#000000');
    expect(normalizeColor(undefined, '#000000')).toBe('#000000');
    expect(normalizeColor(42, '#000000')).toBe('#000000');
  });
});

describe('readColors', () => {
  it('defaults every colour the host does not supply', () => {
    expect(readColors(() => undefined)).toEqual(DEFAULT_COLORS);
  });

  it('reads the values the property pane holds', () => {
    const supplied: Record<string, string> = {
      accentColor: '#7a1fa2',
      backgroundColor: '#fffdf7',
      headerColor: '#efe7f7',
      textColor: '#231f20',
      overCapacityColor: '#ffe9b8',
      overCapacityTextColor: '#6b4c00',
    };
    const colors = readColors((name) => supplied[name]);
    expect(colors.accent).toBe('#7a1fa2');
    expect(colors.background).toBe('#fffdf7');
    expect(colors.header).toBe('#efe7f7');
    expect(colors.text).toBe('#231f20');
    expect(colors.overCapacity).toBe('#ffe9b8');
    expect(colors.overCapacityText).toBe('#6b4c00');
  });

  it('keeps a readable colour when a neighbouring one is not', () => {
    const colors = readColors((name) => (name === 'accentColor' ? 'nonsense' : 'rgb(1, 2, 3)'));
    expect(colors.accent).toBe(DEFAULT_COLORS.accent);
    expect(colors.background).toBe('rgb(1, 2, 3)');
  });
});

describe('colorVars', () => {
  it('hands the stylesheet the palette plus its derived tints', () => {
    const vars = colorVars({ ...DEFAULT_COLORS, accent: '#102030', overCapacity: '#ffe9b8' });
    expect(vars['--tfg-accent']).toBe('#102030');
    expect(vars['--tfg-accent-soft']).toBe('rgba(16, 32, 48, 0.1)');
    expect(vars['--tfg-active-row']).toBe('rgba(16, 32, 48, 0.06)');
    expect(vars['--tfg-bg-head']).toBe(DEFAULT_COLORS.header);
    expect(vars['--tfg-bg-foot']).toBe(DEFAULT_COLORS.header);
    expect(vars['--tfg-warn-bg']).toBe('#ffe9b8');
    expect(vars['--tfg-warn-strong']).toMatch(/^rgb\(/);
  });

  it('compares palettes by value', () => {
    expect(colorsEqual(DEFAULT_COLORS, { ...DEFAULT_COLORS })).toBe(true);
    expect(colorsEqual(DEFAULT_COLORS, { ...DEFAULT_COLORS, accent: '#000000' })).toBe(false);
  });
});
