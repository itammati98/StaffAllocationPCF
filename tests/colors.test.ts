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
      borderColor: '#e0d7ea',
      mutedTextColor: '#4b4453',
      hoverColor: '#f6f1fb',
      subtleBackgroundColor: '#f9f6fd',
      dangerColor: '#8e1f2b',
    };
    const colors = readColors((name) => supplied[name]);
    expect(colors.accent).toBe('#7a1fa2');
    expect(colors.background).toBe('#fffdf7');
    expect(colors.header).toBe('#efe7f7');
    expect(colors.text).toBe('#231f20');
    expect(colors.overCapacity).toBe('#ffe9b8');
    expect(colors.overCapacityText).toBe('#6b4c00');
    expect(colors.border).toBe('#e0d7ea');
    expect(colors.mutedText).toBe('#4b4453');
    expect(colors.hover).toBe('#f6f1fb');
    expect(colors.subtleBackground).toBe('#f9f6fd');
    expect(colors.danger).toBe('#8e1f2b');
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
    expect(vars['--tfg-bg-head']).toBe(DEFAULT_COLORS.header);
    expect(vars['--tfg-bg-foot']).toBe(DEFAULT_COLORS.header);
    expect(vars['--tfg-warn-bg']).toBe('#ffe9b8');
    expect(vars['--tfg-warn-strong']).toMatch(/^rgb\(/);
  });

  it('keeps every fill that can land on a pinned column opaque', () => {
    // The timeline scrolls under the person and rate columns, so a translucent fill would show it
    // through them: the active row and cell are composited over the background instead.
    const vars = colorVars({ ...DEFAULT_COLORS, accent: '#102030' });
    // An already opaque colour is handed over as typed; a derived tint is composited to rgb(...).
    // None of them may carry an alpha.
    for (const name of ['--tfg-active-row', '--tfg-active-cell', '--tfg-bg', '--tfg-bg-head', '--tfg-bg-foot', '--tfg-bg-subtle', '--tfg-hover', '--tfg-warn-bg', '--tfg-warn-strong']) {
      expect(vars[name], name).not.toMatch(/rgba\(/);
    }
    expect(vars['--tfg-bg']).toBe(DEFAULT_COLORS.background);
    expect(vars['--tfg-active-row']).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(vars['--tfg-active-cell']).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    // The tint sits between the background and the accent, not on either end.
    expect(vars['--tfg-active-row']).not.toBe('rgb(255, 255, 255)');
    expect(vars['--tfg-active-row']).not.toBe('rgb(16, 32, 48)');
  });

  it('flattens a translucent colour a maker pasted, so nothing scrolls through a pinned cell', () => {
    const vars = colorVars({ ...DEFAULT_COLORS, background: 'rgba(255, 255, 255, 0.5)', hover: 'rgba(0, 0, 0, 0.2)' });
    expect(vars['--tfg-bg']).toBe('rgb(255, 255, 255)');
    expect(vars['--tfg-hover']).toBe('rgb(204, 204, 204)');
    expect(vars['--tfg-active-cell']).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it('compares palettes by value', () => {
    expect(colorsEqual(DEFAULT_COLORS, { ...DEFAULT_COLORS })).toBe(true);
    expect(colorsEqual(DEFAULT_COLORS, { ...DEFAULT_COLORS, accent: '#000000' })).toBe(false);
  });
});
