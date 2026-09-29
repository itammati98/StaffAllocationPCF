import {
  addDays,
  allocationKey,
  buildColumns,
  buildOutput,
  buildTimeline,
  clearPerson,
  computeModel,
  createStore,
  distributeHours,
  fillRight,
  isWorkingDay,
  realisationFromRph,
  rphFromRealisation,
  round6,
  setColumnHours,
  storeHours,
  toDateKey,
  weekdayOf,
} from '../TimeFeesGrid/src/engine';
import type { PersonRow, TimelineDay } from '../TimeFeesGrid/src/types';
import { describe, expect, it } from 'vitest';

function person(overrides: Partial<PersonRow> & { key: string }): PersonRow {
  return {
    name: overrides.key,
    jobLevel: 'Consultant',
    team: 'Consulting',
    costRate: 45,
    feeRate: 150,
    rph: 150,
    realisation: 1,
    jobLevelOrder: 1,
    isToBeAdded: false,
    currencyId: 'GBP',
    ...overrides,
  };
}

// 2026-01-05 is a Monday, so every generated working day lines up with the examples in the spec.
const MONDAY = new Date(2026, 0, 5);

function saturday(dateKey = '2026-01-10'): TimelineDay {
  return {
    dateKey,
    date: new Date(2026, 0, 10),
    value: 0,
    weekday: 6,
    weekNum: 0,
    monthNum: 1,
    yearNum: 2026,
    isWorkingDay: false,
  };
}

describe('1. local dates and timeline', () => {
  it('formats and shifts dates in local time without day drift', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
    expect(toDateKey(new Date(2026, 8, 9))).toBe('2026-09-09');
    expect(weekdayOf(new Date(2026, 0, 5))).toBe(1);
    expect(weekdayOf(new Date(2026, 0, 11))).toBe(7);
    expect(toDateKey(addDays(new Date(2026, 0, 5), 7))).toBe('2026-01-12');
    expect(toDateKey(addDays(new Date(2026, 0, 31), 1))).toBe('2026-02-01');
    expect(toDateKey(addDays(new Date(2026, 2, 1), -1))).toBe('2026-02-28');
    expect(isWorkingDay(new Date(2026, 0, 5))).toBe(true);
    expect(isWorkingDay(new Date(2026, 0, 10))).toBe(false);
  });

  it('builds five-working-day blocks from a mid-week start', () => {
    const timeline = buildTimeline(new Date(2026, 0, 7), 2);
    expect(timeline).toHaveLength(10);
    expect(timeline.map((day) => day.dateKey)).toEqual([
      '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-12', '2026-01-13',
      '2026-01-14', '2026-01-15', '2026-01-16', '2026-01-19', '2026-01-20',
    ]);
    expect(timeline.map((day) => day.weekNum)).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
    expect(timeline.map((day) => day.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(timeline.every((day) => day.isWorkingDay)).toBe(true);
    expect(buildTimeline(new Date(2026, 0, 7), 0)).toEqual([]);
  });
});

describe('2. buildColumns phasings', () => {
  const timeline = buildTimeline(MONDAY, 2);

  it('builds daily columns', () => {
    const daily = buildColumns(timeline, 'daily', 8);
    expect(daily).toHaveLength(10);
    expect(daily[0].id).toBe('d:2026-01-05');
    expect(daily[0].label).toBe('Day 1');
    expect(daily[0].subLabel).toBe('05 Jan');
    expect(daily[0].title).toBe('Monday 05 Jan 2026, week 1');
    expect(daily[0].capacity).toBe(8);
    expect(daily[0].dateKeys).toEqual(['2026-01-05']);
    expect(daily[0].phasing).toBe('daily');
  });

  it('builds weekly columns', () => {
    const weekly = buildColumns(timeline, 'weekly', 8);
    expect(weekly).toHaveLength(2);
    expect(weekly[0].id).toBe('w:2026-1');
    expect(weekly[0].label).toBe('W1');
    expect(weekly[0].subLabel).toBe('05 Jan');
    expect(weekly[0].title).toBe('Week 1, 05 Jan - 09 Jan 2026');
    expect(weekly[0].capacity).toBe(40);
    expect(weekly[1].id).toBe('w:2026-2');
    expect(weekly[1].subLabel).toBe('12 Jan');
  });

  it('builds monthly columns and excludes weekend days from workingDays', () => {
    const monthly = buildColumns(timeline, 'monthly', 8);
    expect(monthly).toHaveLength(1);
    expect(monthly[0].id).toBe('m:2026-1');
    expect(monthly[0].label).toBe('Jan 26');
    expect(monthly[0].subLabel).toBe('10 days');
    expect(monthly[0].title).toBe('January 2026, 10 working days');
    expect(monthly[0].capacity).toBe(80);

    const withWeekend = buildColumns([...timeline, saturday()], 'monthly', 8);
    expect(withWeekend[0].days).toHaveLength(11);
    expect(withWeekend[0].workingDays).toHaveLength(10);
    expect(withWeekend[0].dateKeys).not.toContain('2026-01-10');
    expect(withWeekend[0].capacity).toBe(80);
  });

  it('returns no columns for an empty timeline', () => {
    expect(buildColumns([], 'weekly', 8)).toEqual([]);
  });
});

describe('3. distributeHours', () => {
  it('front loads below capacity', () => {
    expect(distributeHours(20, 5, 8)).toEqual([8, 8, 4, 0, 0]);
    expect(distributeHours(40, 5, 8)).toEqual([8, 8, 8, 8, 8]);
    expect(distributeHours(7.5, 5, 8)).toEqual([7.5, 0, 0, 0, 0]);
  });

  it('spreads evenly as integers above capacity, with the spare hours at the end', () => {
    expect(distributeHours(41, 5, 8)).toEqual([8, 8, 8, 8, 9]);
    expect(distributeHours(180, 22, 8)).toEqual([
      8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
      9, 9, 9, 9,
    ]);
  });

  it('handles empty and zero inputs', () => {
    expect(distributeHours(0, 5, 8)).toEqual([0, 0, 0, 0, 0]);
    expect(distributeHours(5, 0, 8)).toEqual([]);
    expect(distributeHours(5, -2, 8)).toEqual([]);
  });

  it('always sums back to the requested hours', () => {
    const cases: ReadonlyArray<readonly [number, number]> = [
      [20, 5], [40, 5], [7.5, 5], [41, 5], [180, 22], [12.25, 3], [100, 20],
    ];
    for (const [hours, days] of cases) {
      const result = distributeHours(hours, days, 8);
      expect(result.reduce((total, value) => total + value, 0)).toBeCloseTo(hours, 6);
    }
  });
});

describe('4. setColumnHours', () => {
  const timeline = buildTimeline(MONDAY, 4);
  const weekly = buildColumns(timeline, 'weekly', 8);
  const empty = createStore([]);

  it('front loads 20h onto the first three working days of a week', () => {
    const store = setColumnHours(empty, weekly[0], 'p1', 20, 8);
    expect(storeHours(store, 'p1', '2026-01-05')).toBe(8);
    expect(storeHours(store, 'p1', '2026-01-06')).toBe(8);
    expect(storeHours(store, 'p1', '2026-01-07')).toBe(4);
    expect(storeHours(store, 'p1', '2026-01-08')).toBe(0);
    expect(storeHours(store, 'p1', '2026-01-09')).toBe(0);
  });

  it('replaces instead of accumulating on re-entry', () => {
    const first = setColumnHours(empty, weekly[0], 'p1', 20, 8);
    const second = setColumnHours(first, weekly[0], 'p1', 16, 8);
    expect(storeHours(second, 'p1', '2026-01-05')).toBe(8);
    expect(storeHours(second, 'p1', '2026-01-06')).toBe(8);
    expect(storeHours(second, 'p1', '2026-01-07')).toBe(0);
    expect([...second.keys()].filter((key) => key.startsWith('p1|'))).toHaveLength(2);
  });

  it('clears only the target column when set to zero', () => {
    const withTwoWeeks = setColumnHours(setColumnHours(empty, weekly[0], 'p1', 20, 8), weekly[1], 'p1', 24, 8);
    const cleared = setColumnHours(withTwoWeeks, weekly[0], 'p1', 0, 8);
    expect(storeHours(cleared, 'p1', '2026-01-05')).toBe(0);
    expect(storeHours(cleared, 'p1', '2026-01-12')).toBe(8);
    expect(storeHours(cleared, 'p1', '2026-01-13')).toBe(8);
    expect(storeHours(cleared, 'p1', '2026-01-14')).toBe(8);
  });

  it('leaves other people untouched', () => {
    const withP1 = setColumnHours(empty, weekly[0], 'p1', 20, 8);
    const withBoth = setColumnHours(withP1, weekly[0], 'p2', 12, 8);
    expect(storeHours(withBoth, 'p1', '2026-01-05')).toBe(8);
    expect(storeHours(withBoth, 'p1', '2026-01-06')).toBe(8);
    expect(storeHours(withBoth, 'p1', '2026-01-07')).toBe(4);
    expect(storeHours(withBoth, 'p2', '2026-01-05')).toBe(8);
    expect(storeHours(withBoth, 'p2', '2026-01-06')).toBe(4);
  });

  it('writes nothing for a weekend-only bucket', () => {
    const weekendColumns = buildColumns([saturday()], 'daily', 8);
    const store = setColumnHours(empty, weekendColumns[0], 'p1', 20, 8);
    expect(store.size).toBe(0);
  });
});

describe('5. createStore', () => {
  it('sums duplicate rows and drops zeros and negatives', () => {
    const store = createStore([
      { personKey: 'a', dateKey: '2026-01-05', hours: 4 },
      { personKey: 'a', dateKey: '2026-01-05', hours: 3 },
      { personKey: 'b', dateKey: '2026-01-06', hours: 0 },
      { personKey: 'c', dateKey: '2026-01-07', hours: -5 },
      { personKey: 'd', dateKey: '2026-01-08', hours: Number.NaN },
    ]);
    expect(store.size).toBe(1);
    expect(storeHours(store, 'a', '2026-01-05')).toBe(7);
    expect(store.has(allocationKey('b', '2026-01-06'))).toBe(false);
    expect(store.has(allocationKey('c', '2026-01-07'))).toBe(false);
  });

  it('never holds a zero or negative value after operations', () => {
    const timeline = buildTimeline(MONDAY, 4);
    const weekly = buildColumns(timeline, 'weekly', 8);
    let store = createStore([{ personKey: 'a', dateKey: '2026-01-05', hours: 30 }]);
    store = setColumnHours(store, weekly[1], 'a', 12, 8);
    store = fillRight(store, weekly, 'a', 8);
    store = setColumnHours(store, weekly[2], 'a', 0, 8);
    expect([...store.values()].every((value) => value > 0)).toBe(true);
  });
});

describe('6. fillRight', () => {
  const weekly = buildColumns(buildTimeline(MONDAY, 4), 'weekly', 8);

  it('copies only the first non-empty column forward', () => {
    const store = createStore([{ personKey: 'p', dateKey: '2026-01-12', hours: 16 }]);
    const filled = fillRight(store, weekly, 'p', 8);
    expect(storeHours(filled, 'p', '2026-01-05')).toBe(0);
    expect(storeHours(filled, 'p', '2026-01-12')).toBe(16);
    expect(storeHours(filled, 'p', '2026-01-19')).toBe(8);
    expect(storeHours(filled, 'p', '2026-01-20')).toBe(8);
    expect(storeHours(filled, 'p', '2026-01-21')).toBe(0);
    expect(storeHours(filled, 'p', '2026-01-26')).toBe(8);
    expect(storeHours(filled, 'p', '2026-01-27')).toBe(8);
  });

  it('is a no-op for an empty row', () => {
    const store = createStore([{ personKey: 'other', dateKey: '2026-01-05', hours: 8 }]);
    expect(fillRight(store, weekly, 'p', 8)).toBe(store);
  });
});

describe('7. computeModel', () => {
  const timeline = buildTimeline(MONDAY, 2);
  const weekly = buildColumns(timeline, 'weekly', 8);
  const people = [
    person({ key: 'p1', name: 'Alice', rph: 190, feeRate: 190, costRate: 55 }),
    person({ key: 'p2', name: 'Bob', rph: 190, feeRate: 190, costRate: 55 }),
  ];

  function store() {
    let value = createStore([]);
    value = setColumnHours(value, weekly[0], 'p1', 45, 8);
    value = setColumnHours(value, weekly[1], 'p2', 40, 8);
    value = new Map(value).set(allocationKey('p1', '2026-06-01'), 8);
    return value;
  }

  it('derives row figures and outside-window hours', () => {
    const model = computeModel(people, store(), weekly);
    const [row1, row2] = model.rows;
    expect(row1.totalHours).toBe(45);
    expect(row1.fee).toBe(8550);
    expect(row1.cost).toBe(2475);
    expect(row1.gm).toBeCloseTo((8550 - 2475) / 2475, 6);
    expect(row1.realisation).toBe(1);
    expect(row1.outsideWindowHours).toBe(8);
    expect(row2.totalHours).toBe(40);
  });

  it('aggregates column and grid totals', () => {
    const model = computeModel(people, store(), weekly);
    expect(model.totals.hours[weekly[0].id]).toBe(45);
    expect(model.totals.hours[weekly[1].id]).toBe(40);
    expect(model.totals.hoursTotal).toBe(85);
    expect(model.totals.fee).toBe(16150);
    expect(model.outsideWindowHours).toBe(8);
  });
});

describe('8. weighted averages', () => {
  const weekly = buildColumns(buildTimeline(MONDAY, 2), 'weekly', 8);
  const people = [
    person({ key: 'p1', rph: 190, feeRate: 200 }),
    person({ key: 'p2', rph: 100, feeRate: 100 }),
  ];
  let store = createStore([]);
  store = setColumnHours(store, weekly[0], 'p1', 45, 8);
  store = setColumnHours(store, weekly[1], 'p2', 40, 8);

  it('weights the editable and standard rates by hours', () => {
    const totals = computeModel(people, store, weekly).totals;
    expect(totals.avgRph).toBeCloseTo(147.647059, 6);
    expect(totals.avgStd).toBeCloseTo(152.941176, 6);
    expect(totals.avgRealisation).toBeCloseTo(0.965385, 6);
  });

  it('returns zero averages for an empty grid', () => {
    const totals = computeModel(people, createStore([]), weekly).totals;
    expect(totals.hoursTotal).toBe(0);
    expect(totals.avgRph).toBe(0);
    expect(totals.avgStd).toBe(0);
    expect(totals.avgRealisation).toBe(0);
  });

  it('derives rph from realisation', () => {
    expect(rphFromRealisation(0.9, 200)).toBe(180);
    expect(realisationFromRph(180, 200)).toBe(0.9);
    expect(realisationFromRph(180, 0)).toBe(0);
  });
});

describe('9. buildOutput', () => {
  const timeline = buildTimeline(MONDAY, 2);
  const people = [
    person({
      key: 'p1',
      name: 'Alice',
      jobLevel: 'Snr Consultant',
      team: 'Consulting',
      costRate: 55,
      feeRate: 190,
      rph: 180,
      realisation: realisationFromRph(180, 190),
      jobLevelOrder: 0,
      isToBeAdded: true,
      currencyId: 'GBP',
    }),
  ];
  const store = createStore([
    { personKey: 'p1', dateKey: '2026-01-05', hours: 8 },
    { personKey: 'p1', dateKey: '2026-06-01', hours: 6 },
    { personKey: 'ghost', dateKey: '2026-01-06', hours: 4 },
    { personKey: 'p1', dateKey: '2026-01-07', hours: 0 },
  ]);

  it('copies every person field including drafts', () => {
    const output = buildOutput(store, people, timeline);
    expect(output.people).toEqual([
      {
        Name: 'Alice',
        JobLevel: 'Snr Consultant',
        Team: 'Consulting',
        CostRate: 55,
        FeeRate: 190,
        RPH: 180,
        Realisation: round6(realisationFromRph(180, 190)),
        JobLevelOrder: 0,
        IsToBeAdded: true,
        CurrencyID: 'GBP',
      },
    ]);
  });

  it('emits only non-zero allocations, ordered by person then date', () => {
    const output = buildOutput(store, people, timeline);
    expect(output.allocations).toHaveLength(3);
    expect(output.allocations.map((row) => row.Name)).toEqual(['Alice', 'Alice', 'ghost']);
    expect(output.allocations[0]).toEqual({
      Name: 'Alice',
      Date: '2026-01-05',
      Value: 1,
      Weekday: 1,
      WeekNum: 1,
      MonthNum: 1,
      YearNum: 2026,
      HoursWorked: 8,
    });
  });

  it('preserves out-of-window rows with zero ordinal and derived month/year', () => {
    const output = buildOutput(store, people, timeline);
    expect(output.allocations[1]).toEqual({
      Name: 'Alice',
      Date: '2026-06-01',
      Value: 0,
      Weekday: 0,
      WeekNum: 0,
      MonthNum: 6,
      YearNum: 2026,
      HoursWorked: 6,
    });
    expect(output.allocations[2]).toMatchObject({ Name: 'ghost', Date: '2026-01-06', Value: 2, Weekday: 2, WeekNum: 1 });
  });
});

describe('10. immutability', () => {
  const weekly = buildColumns(buildTimeline(MONDAY, 2), 'weekly', 8);
  const base = createStore([
    { personKey: 'p1', dateKey: '2026-01-05', hours: 8 },
    { personKey: 'p2', dateKey: '2026-01-12', hours: 8 },
  ]);
  const snapshot = new Map(base);

  it('never mutates the input store', () => {
    const afterSet = setColumnHours(base, weekly[0], 'p1', 40, 8);
    const afterFill = fillRight(afterSet, weekly, 'p1', 8);
    const afterClear = clearPerson(afterSet, 'p1');

    expect(afterSet).not.toBe(base);
    expect(afterFill).not.toBe(afterSet);
    expect(afterClear).not.toBe(afterSet);

    for (const [key, value] of snapshot) {
      expect(base.get(key)).toBe(value);
      expect(afterSet.get(key)).toBe(value);
    }
    expect(base.size).toBe(2);
    expect(afterSet.get(allocationKey('p1', '2026-01-12'))).toBeUndefined();
    expect(afterClear.has(allocationKey('p1', '2026-01-05'))).toBe(false);
    expect(base.has(allocationKey('p1', '2026-01-05'))).toBe(true);
  });
});
