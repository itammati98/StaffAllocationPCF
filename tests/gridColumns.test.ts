/**
 * Layout tests: which columns exist per density, which days a period can book hours on, and the
 * sticky offsets that keep the person column and the row totals in view while scrolling.
 */
import { describe, expect, it } from 'vitest';
import { buildColumns } from '../TimeFeesGrid/src/engine';
import { buildColumnLayout, CellKind, ColumnLayout, DENSITY, stickyLeftWidth, stickyRightWidth } from '../TimeFeesGrid/src/gridColumns';
import type { TimelineDay } from '../TimeFeesGrid/src/types';

const HOURS_PER_DAY = 8;

/** Monday 5 January 2026 plus the following weekend and week. */
function timeline(): TimelineDay[] {
  const days: TimelineDay[] = [];
  let workingDay = 0;
  for (let offset = 0; offset < 9; offset += 1) {
    const date = new Date(2026, 0, 5 + offset);
    const weekday = ((date.getDay() + 6) % 7) + 1;
    const isWorkingDay = weekday <= 5;
    if (isWorkingDay) workingDay += 1;
    days.push({
      dateKey: `2026-01-${String(5 + offset).padStart(2, '0')}`,
      date,
      value: isWorkingDay ? workingDay : 0,
      weekday,
      // Weekends belong to the week they fall in, as in the host timeline.
      weekNum: Math.floor(offset / 7) + 1,
      monthNum: 1,
      yearNum: 2026,
      isWorkingDay,
    });
  }
  return days;
}

describe('period columns', () => {
  it('books hours on working days only and keeps the weekend inside its week', () => {
    const weekly = buildColumns(timeline(), 'weekly', HOURS_PER_DAY);
    expect(weekly.map((column) => column.id)).toEqual(['w:2026-01-05', 'w:2026-01-12']);
    expect(weekly[0].dateKeys).toEqual(['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09']);
    expect(weekly[0].days).toHaveLength(7);
    expect(weekly[0].capacity).toBe(5 * HOURS_PER_DAY);
  });

  it('drops period columns that hold no working day', () => {
    const daily = buildColumns(timeline(), 'daily', HOURS_PER_DAY);
    expect(daily.filter((column) => column.workingDays.length === 0)).toHaveLength(2);

    const layout = buildColumnLayout(daily, 'comfortable');
    const periods = layout.filter((column) => column.kind === 'period');
    expect(periods.map((column) => column.period?.dateKeys[0])).toEqual([
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
      '2026-01-08',
      '2026-01-09',
      '2026-01-12',
      '2026-01-13',
    ]);
  });
});

describe('density layouts', () => {
  const weekly = buildColumns(timeline(), 'weekly', HOURS_PER_DAY);

  it('drops the derived rate and margin columns as the container narrows', () => {
    const kinds = (density: 'comfortable' | 'compact' | 'narrow'): string[] =>
      buildColumnLayout(weekly, density)
        .filter((column) => column.kind !== 'period')
        .map((column) => column.kind);

    expect(kinds('comfortable')).toEqual(['identity', 'rph', 'std', 'real', 'spacer', 'totalHours', 'fee', 'gm']);
    expect(kinds('compact')).toEqual(['identity', 'rph', 'std', 'real', 'spacer', 'totalHours', 'fee']);
    expect(kinds('narrow')).toEqual(['identity', 'rph', 'spacer', 'totalHours', 'fee']);
  });

  it('puts a single flexible gap between the timeline and the totals', () => {
    const layout = buildColumnLayout(weekly, 'comfortable');
    const spacerIndex = layout.findIndex((column) => column.kind === 'spacer');

    expect(layout.find((column) => column.kind === 'spacer')).toMatchObject({ flexible: true, width: 0 });
    expect(layout.filter((column) => column.flexible)).toHaveLength(1);
    expect(spacerIndex).toBeGreaterThan(0);
    expect(layout.slice(spacerIndex + 1).every((column) => ['totalHours', 'fee', 'gm'].indexOf(column.kind) >= 0)).toBe(true);
    expect(layout.slice(0, spacerIndex).some((column) => column.kind === 'period')).toBe(true);
  });

  it('pins the person and rate columns left and the row totals right, with cumulative offsets', () => {
    const layout = buildColumnLayout(weekly, 'comfortable');
    const widths = DENSITY.comfortable.widths;
    const byKind = (kind: CellKind): ColumnLayout | undefined => layout.find((column) => column.kind === kind);

    // Only the timeline scrolls: the person column and the rates stay against the left edge.
    expect(layout.filter((column) => column.stickyLeft !== undefined).map((column) => column.kind)).toEqual([
      'identity',
      'rph',
      'std',
      'real',
    ]);
    expect(layout[0]).toMatchObject({ kind: 'identity', stickyLeft: 0 });
    expect(byKind('rph')?.stickyLeft).toBe(widths.identity);
    expect(byKind('std')?.stickyLeft).toBe(widths.identity + widths.rph);
    expect(byKind('real')?.stickyLeft).toBe(widths.identity + widths.rph + widths.std);
    expect(stickyLeftWidth(layout)).toBe(widths.identity + widths.rph + widths.std + widths.real);

    const hours = byKind('totalHours');
    const fee = byKind('fee');
    const gm = byKind('gm');
    expect(gm?.stickyRight).toBe(0);
    expect(fee?.stickyRight).toBe(widths.gm);
    expect(hours?.stickyRight).toBe(widths.gm + widths.fee);
    expect(stickyRightWidth(layout)).toBe(widths.gm + widths.fee + widths.totalHours);
    expect(layout.filter((column) => column.kind === 'period').every((column) => column.stickyLeft === undefined)).toBe(true);
  });

  it('marks the pinned columns that face the scrolling timeline', () => {
    const comfortable = buildColumnLayout(weekly, 'comfortable');
    expect(comfortable.filter((column) => column.stickyEdge).map((column) => column.kind)).toEqual(['real', 'totalHours']);

    const narrow = buildColumnLayout(weekly, 'narrow');
    expect(narrow.filter((column) => column.stickyEdge).map((column) => column.kind)).toEqual(['rph']);
  });

  it('leaves the totals scrolling with the timeline on a narrow container', () => {
    const layout = buildColumnLayout(weekly, 'narrow');
    expect(stickyRightWidth(layout)).toBe(0);
    // The narrow density drops the STD and REAL% columns, so only the rates it keeps are pinned.
    expect(stickyLeftWidth(layout)).toBe(DENSITY.narrow.widths.identity + DENSITY.narrow.widths.rph);
  });
});
