/**
 * The test-script scenarios that live in the engine: a workstream starting mid-week, switching
 * weekly to daily, a month that splits a week, Fill, a shifted start date, ISO week labels across
 * New Year, public holidays and the en-GB number formats. The steps that need Power Apps (save and
 * reopen, a read-only user) are in docs/TEST-SCRIPT.md.
 */
import { describe, expect, it } from 'vitest';
import {
  buildColumns,
  buildOutput,
  buildTimeline,
  computeModel,
  createStore,
  fillRight,
  isoWeek,
  setColumnHours,
  storeHours,
} from '../TimeFeesGrid/src/engine';
import { parseHolidays, readSnapshot } from '../TimeFeesGrid/src/datasetAdapter';
import {
  formatHours,
  formatOneDecimal,
  formatRate,
  formatThousands,
  formatTotalHours,
  formatTotalPercent,
  formatTotalThousands,
} from '../TimeFeesGrid/src/format';
import { DEFAULT_COLORS } from '../TimeFeesGrid/src/colors';
import type { GridHostInputs, PersonRow } from '../TimeFeesGrid/src/types';

const person = (key: string): PersonRow => ({
  key,
  name: key,
  jobLevel: '',
  team: '',
  costRate: 50,
  feeRate: 150,
  rph: 150,
  realisation: 1,
  jobLevelOrder: 0,
  isToBeAdded: false,
  currencyId: 'GBP',
});

const HOST: GridHostInputs = {
  workstreamStart: new Date(2026, 0, 7),
  numberOfWeeks: 2,
  hoursPerDay: 8,
  pricingMethod: 'manualRate',
  phasing: 'weekly',
  readOnly: false,
  showNotifications: true,
  showPricingBadge: true,
  holidays: [],
  colors: DEFAULT_COLORS,
};

describe('a workstream that starts on a Wednesday', () => {
  // 10 working days from Wednesday 7 Jan 2026: Wed-Fri, a full week, then Mon-Tue.
  const timeline = buildTimeline(new Date(2026, 0, 7), 2);
  const weekly = buildColumns(timeline, 'weekly', 8);

  it('groups the days into Monday-to-Friday weeks keyed by their Monday', () => {
    expect(weekly.map((column) => column.id)).toEqual(['w:2026-01-05', 'w:2026-01-12', 'w:2026-01-19']);
    expect(weekly.map((column) => column.label)).toEqual(['W2', 'W3', 'W4']);
    expect(weekly.map((column) => column.workingDays.length)).toEqual([3, 5, 2]);
    expect(weekly.map((column) => column.capacity)).toEqual([24, 40, 16]);
  });

  it('fills a part week forward as the same hours, spread over each week it lands in', () => {
    const booked = setColumnHours(createStore([]), weekly[0], 'p', 24, 8);
    const filled = fillRight(booked, weekly, 'p', 8);
    const model = computeModel([person('p')], filled, weekly);
    expect(model.rows[0].hours).toEqual({ 'w:2026-01-05': 24, 'w:2026-01-12': 24, 'w:2026-01-19': 24 });
    expect(storeHours(filled, 'p', '2026-01-12')).toBe(4.8);
    // Two working days cannot hold 24h at 8h a day: 12h each, and the week is over capacity.
    expect(storeHours(filled, 'p', '2026-01-19')).toBe(12);
    expect(model.rows[0].hours['w:2026-01-19']).toBeGreaterThan(weekly[2].capacity);
  });
});

describe('weekly to daily', () => {
  it('shows a booked week evenly across its working days', () => {
    const timeline = buildTimeline(new Date(2026, 0, 5), 1);
    const weekly = buildColumns(timeline, 'weekly', 8);
    const daily = buildColumns(timeline, 'daily', 8);
    const store = setColumnHours(createStore([]), weekly[0], 'p', 20, 8);
    const days = computeModel([person('p')], store, daily).rows[0].hours;
    expect(Object.values(days)).toEqual([4, 4, 4, 4, 4]);
  });
});

describe('a month that splits a week, across New Year', () => {
  // Monday 28 Dec 2026 for two weeks.
  const timeline = buildTimeline(new Date(2026, 11, 28), 2);

  it('labels the weeks with their ISO week: 28 Dec 2026 is W53, 4 Jan 2027 is W1', () => {
    const weekly = buildColumns(timeline, 'weekly', 8);
    expect(weekly.map((column) => [column.id, column.label, column.yearNum])).toEqual([
      ['w:2026-12-28', 'W53', 2026],
      ['w:2027-01-04', 'W1', 2027],
    ]);
    expect(isoWeek(new Date(2027, 0, 1))).toEqual({ week: 53, year: 2026 });
    expect(isoWeek(new Date(2027, 0, 4))).toEqual({ week: 1, year: 2027 });
  });

  it('splits a booked week between the two months it spans', () => {
    const weekly = buildColumns(timeline, 'weekly', 8);
    const monthly = buildColumns(timeline, 'monthly', 8);
    const store = setColumnHours(createStore([]), weekly[0], 'p', 40, 8);
    const hours = computeModel([person('p')], store, monthly).rows[0].hours;
    // 28-31 Dec take four days of the week, 1 Jan the fifth.
    expect(hours).toEqual({ 'm:2026-12': 32, 'm:2027-1': 8 });
  });
});

describe('moving the start date', () => {
  it('keeps hours that fall outside the new window, lists their dates and still writes them back', () => {
    const before = buildColumns(buildTimeline(new Date(2026, 0, 5), 2), 'weekly', 8);
    const store = setColumnHours(createStore([]), before[0], 'p', 10, 8);

    // The workstream now starts a week later: the first week's bookings leave the window.
    const afterTimeline = buildTimeline(new Date(2026, 0, 12), 2);
    const model = computeModel([person('p')], store, buildColumns(afterTimeline, 'weekly', 8));
    expect(model.rows[0].totalHours).toBe(0);
    expect(model.outsideWindowHours).toBe(10);
    expect(model.rows[0].outsideWindow.map((day) => day.dateKey)).toEqual([
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
      '2026-01-08',
      '2026-01-09',
    ]);

    const output = buildOutput(store, [person('p')], afterTimeline);
    expect(output.allocations).toHaveLength(5);
    expect(output.allocations.every((row) => row.Value === 0 && row.WeekNum === 0)).toBe(true);
  });
});

describe('public holidays', () => {
  it('reads a JSON list of dates, JSON(collection) records and plain text', () => {
    expect(parseHolidays('["2026-12-25","2026-12-28"]')).toEqual(['2026-12-25', '2026-12-28']);
    expect(parseHolidays('[{"Date":"2026-12-28T00:00:00.000Z"},{"Date":"2026-12-25"}]')).toEqual(['2026-12-25', '2026-12-28']);
    expect(parseHolidays('2026-12-25; 2026-12-28')).toEqual(['2026-12-25', '2026-12-28']);
    expect(parseHolidays('')).toEqual([]);
    expect(parseHolidays('not a date')).toEqual([]);
  });

  it('takes the holidays out of the working days, so no hours land on them', () => {
    const snapshot = readSnapshot({}, { ...HOST, workstreamStart: new Date(2026, 11, 21), holidays: ['2026-12-25', '2026-12-28'] });
    const weekly = buildColumns(snapshot.timeline, 'weekly', 8);
    expect(weekly[0].workingDays.map((day) => day.dateKey)).not.toContain('2026-12-25');
    expect(weekly[0].capacity).toBe(32);

    const store = setColumnHours(createStore([]), weekly[0], 'p', 32, 8);
    expect(storeHours(store, 'p', '2026-12-25')).toBe(0);
    expect(storeHours(store, 'p', '2026-12-24')).toBe(8);
  });
});

describe('number formats', () => {
  it('groups thousands the en-GB way', () => {
    expect(formatRate(1039)).toBe('1,039');
    expect(formatRate(1039.456)).toBe('1,039.46');
    expect(formatHours(1039)).toBe('1,039');
    expect(formatHours(7.5)).toBe('7.5');
    expect(formatThousands(1_039_000)).toBe('1,039');
  });

  it('shows every totals figure with one decimal place, like the app', () => {
    expect(formatTotalHours(40)).toBe('40.0');
    expect(formatTotalHours(1039.44)).toBe('1,039.4');
    expect(formatOneDecimal(149.62)).toBe('149.6');
    expect(formatTotalPercent(0.9534)).toBe('95.3%');
    expect(formatTotalPercent(1)).toBe('100.0%');
    expect(formatTotalThousands(12_000)).toBe('12.0');
    expect(formatTotalThousands(1_039_460)).toBe('1,039.5');
    expect(formatTotalThousands(0)).toBe('–');
  });
});
