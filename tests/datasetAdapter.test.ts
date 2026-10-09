/**
 * Boundary tests for the host dataset adapter: the shapes canvas apps hand over (aliased column
 * names, dates as objects or ISO strings, numbers as strings, missing columns) and the guarantees
 * the grid depends on (nothing is thrown away silently, out-of-window hours survive).
 */
import { describe, expect, it } from 'vitest';
import {
  clampHoursPerDay,
  clampWeeks,
  outputSignature,
  readSnapshot,
  snapshotSignature,
} from '../TimeFeesGrid/src/datasetAdapter';
import { buildOutput, createStore } from '../TimeFeesGrid/src/engine';
import { DEFAULT_COLORS } from '../TimeFeesGrid/src/colors';
import type { GridHostInputs, GridOutput } from '../TimeFeesGrid/src/types';

type DataSet = ComponentFramework.PropertyTypes.DataSet;

interface FakeColumn {
  name: string;
  dataType?: string;
}

interface FakeRow {
  /** `null` models a host that supplies no record id for the row. */
  id?: string | null;
  values: Record<string, unknown>;
}

function dataset(columns: FakeColumn[], rows: FakeRow[], overrides: Record<string, unknown> = {}): DataSet {
  const records: Record<string, unknown> = {};
  const ids: string[] = [];
  rows.forEach((row, index) => {
    const id = row.id ?? `rec-${index}`;
    ids.push(id);
    records[id] = {
      getValue: (name: string) => row.values[name],
      getFormattedValue: (name: string) => String(row.values[name] ?? ''),
      getRecordId: () => (row.id === null ? '' : id),
    };
  });
  return {
    columns: columns.map((column) => ({
      name: column.name,
      displayName: column.name,
      dataType: column.dataType ?? 'SingleLine.Text',
      isHidden: false,
    })),
    sortedRecordIds: ids,
    records,
    loading: false,
    error: false,
    errorMessage: '',
    ...overrides,
  } as unknown as DataSet;
}

const HOST: GridHostInputs = {
  workstreamStart: new Date(2026, 0, 5),
  numberOfWeeks: 2,
  hoursPerDay: 8,
  pricingMethod: 'manualRate',
  phasing: 'weekly',
  readOnly: false,
  showNotifications: true,
  showPricingBadge: true,
  colors: DEFAULT_COLORS,
};

const PEOPLE_COLUMNS: FakeColumn[] = [
  { name: '[Name]' },
  { name: "'JobLevel'" },
  { name: 'Team' },
  { name: 'CostRate', dataType: 'Decimal' },
  { name: 'FeeRate', dataType: 'Decimal' },
  { name: 'RPH', dataType: 'Decimal' },
  { name: 'Realisation', dataType: 'Decimal' },
  { name: 'JobLevelOrder', dataType: 'Whole.None' },
  { name: 'IsToBeAdded', dataType: 'TwoOptions' },
  { name: 'CurrencyID' },
];

const TIMELINE_COLUMNS: FakeColumn[] = [
  { name: 'Date', dataType: 'DateAndTime.DateOnly' },
  { name: 'Value', dataType: 'Whole.None' },
  { name: 'Weekday', dataType: 'Whole.None' },
  { name: 'WeekNum', dataType: 'Whole.None' },
  { name: 'MonthNum', dataType: 'Whole.None' },
  { name: 'YearNum', dataType: 'Whole.None' },
];

const ALLOCATION_COLUMNS: FakeColumn[] = [
  { name: 'Name' },
  { name: 'Date', dataType: 'DateAndTime.DateOnly' },
  { name: 'HoursWorked', dataType: 'Decimal' },
];

function alice(extra: Record<string, unknown> = {}): FakeRow {
  return {
    id: 'alice-record',
    values: {
      '[Name]': 'Alice Adams',
      "'JobLevel'": 'Snr Consultant',
      Team: 'Consulting',
      CostRate: '55',
      FeeRate: 190,
      RPH: '180',
      Realisation: 0,
      JobLevelOrder: 0,
      IsToBeAdded: 'yes',
      CurrencyID: 'GBP',
      ...extra,
    },
  };
}

function bob(extra: Record<string, unknown> = {}): FakeRow {
  return {
    id: 'bob-record',
    values: {
      Name: 'Bob Brown',
      JobLevel: 'Consultant',
      Team: 'Delivery',
      CostRate: 45,
      FeeRate: 150,
      RPH: 140,
      Realisation: 140 / 150,
      JobLevelOrder: 1,
      IsToBeAdded: false,
      CurrencyID: 'GBP',
      ...extra,
    },
  };
}

describe('people', () => {
  it('reads aliased column names and coerces host values', () => {
    const snapshot = readSnapshot({ people: dataset(PEOPLE_COLUMNS, [alice()]) }, HOST);
    expect(snapshot.people).toHaveLength(1);
    expect(snapshot.people[0]).toMatchObject({
      name: 'Alice Adams',
      jobLevel: 'Snr Consultant',
      team: 'Consulting',
      costRate: 55,
      feeRate: 190,
      rph: 180,
      isToBeAdded: true,
      currencyId: 'GBP',
    });
    // Realisation was supplied as 0, so it is derived from the rates.
    expect(snapshot.people[0].realisation).toBeCloseTo(180 / 190, 6);
  });

  it('keys rows by record id and falls back to the name', () => {
    const rows: FakeRow[] = [alice(), { id: null, values: { '[Name]': 'Bob Brown', RPH: 1, FeeRate: 2 } }];
    const snapshot = readSnapshot({ people: dataset(PEOPLE_COLUMNS, rows) }, HOST);
    expect(snapshot.people.map((person) => person.key)).toEqual(['alice-record', 'Bob Brown']);
  });

  it('drops rows without a name and reports them', () => {
    const rows: FakeRow[] = [alice(), { values: { '[Name]': '   ' } }];
    const snapshot = readSnapshot({ people: dataset(PEOPLE_COLUMNS, rows) }, HOST);
    expect(snapshot.people).toHaveLength(1);
    expect(snapshot.warnings.some((warning) => /people row/i.test(warning))).toBe(true);
  });
});

describe('timeline', () => {
  it('never shifts a calendar day, whatever shape the host date arrives in', () => {
    const rows: FakeRow[] = [
      { values: { Date: new Date(2026, 0, 6), Value: 2, Weekday: 2 } },
      { values: { Date: '2026-01-05T00:00:00Z', Value: 1, Weekday: 1 } },
    ];
    const snapshot = readSnapshot({ timeline: dataset(TIMELINE_COLUMNS, rows) }, HOST);
    expect(snapshot.timeline.map((day) => day.dateKey)).toEqual(['2026-01-05', '2026-01-06']);
    expect(snapshot.timelineFromHost).toBe(true);
  });

  it('derives week, month and year when the columns are absent', () => {
    const rows: FakeRow[] = [{ values: { Date: '2026-02-04', Value: 7, Weekday: 3 } }];
    const snapshot = readSnapshot({ timeline: dataset(TIMELINE_COLUMNS, rows) }, HOST);
    expect(snapshot.timeline[0]).toMatchObject({ weekNum: 2, monthNum: 2, yearNum: 2026, isWorkingDay: true });
  });

  it('treats the last two weekdays as non-working and dedupes dates', () => {
    const rows: FakeRow[] = [
      { values: { Date: '2026-01-05', Value: 1, Weekday: 1 } },
      { values: { Date: '2026-01-05', Value: 1, Weekday: 1 } },
      { values: { Date: '2026-01-10', Value: 6, Weekday: 6 } },
    ];
    const snapshot = readSnapshot({ timeline: dataset(TIMELINE_COLUMNS, rows) }, HOST);
    expect(snapshot.timeline.map((day) => day.dateKey)).toEqual(['2026-01-05', '2026-01-10']);
    expect(snapshot.timeline[1].isWorkingDay).toBe(false);
    expect(snapshot.warnings.some((warning) => /duplicate timeline row/i.test(warning))).toBe(true);
  });

  it('assumes every day is a working day when the host sends no Weekday column', () => {
    const rows: FakeRow[] = [{ values: { Date: '2026-01-10', Value: 5 } }];
    const snapshot = readSnapshot({ timeline: dataset([{ name: 'Date', dataType: 'DateAndTime.DateOnly' }], rows) }, HOST);
    expect(snapshot.timeline[0].isWorkingDay).toBe(true);
    expect(snapshot.warnings.some((warning) => /weekday/i.test(warning))).toBe(true);
  });

  it('generates a Monday to Friday timeline when none is bound', () => {
    const snapshot = readSnapshot({}, HOST);
    expect(snapshot.timelineFromHost).toBe(false);
    expect(snapshot.timeline).toHaveLength(10);
    expect(snapshot.timeline[0].dateKey).toBe('2026-01-05');
    expect(snapshot.timeline.every((day) => day.isWorkingDay)).toBe(true);
    expect(snapshot.warnings.some((warning) => /generated/i.test(warning))).toBe(true);
  });
});

describe('allocations', () => {
  it('reads the aliased PersonName and AllocationDate columns the manifest declares', () => {
    const allocations = dataset(
      [
        { name: 'PersonName' },
        { name: 'AllocationDate', dataType: 'DateAndTime.DateOnly' },
        { name: 'HoursWorked', dataType: 'Decimal' },
      ],
      [{ values: { PersonName: 'Alice Adams', AllocationDate: '2026-01-05', HoursWorked: '8' } }],
    );
    const snapshot = readSnapshot({ people: dataset(PEOPLE_COLUMNS, [alice()]), allocations }, HOST);

    expect(snapshot.allocations).toEqual([{ personKey: 'alice-record', dateKey: '2026-01-05', hours: 8 }]);
  });

  it('resolves names to people and keeps hours of unknown people', () => {
    const people = dataset(PEOPLE_COLUMNS, [alice()]);
    const allocations = dataset(ALLOCATION_COLUMNS, [
      { values: { Name: 'Alice Adams', Date: '2026-01-05', HoursWorked: '7.5' } },
      { values: { Name: 'Ghost Writer', Date: '2026-01-06', HoursWorked: 6 } },
      { values: { Name: 'Alice Adams', Date: 'not a date', HoursWorked: 3 } },
    ]);
    const snapshot = readSnapshot({ people, allocations }, HOST);
    expect(snapshot.allocations).toEqual([
      { personKey: 'alice-record', dateKey: '2026-01-05', hours: 7.5 },
      { personKey: 'Ghost Writer', dateKey: '2026-01-06', hours: 6 },
    ]);
    expect(snapshot.warnings.some((warning) => /not in the people list/i.test(warning))).toBe(true);
    expect(snapshot.warnings.some((warning) => /unreadable Date/i.test(warning))).toBe(true);
  });
});

describe('meta and signature', () => {
  it('surfaces loading and error state from the host', () => {
    const people = dataset(PEOPLE_COLUMNS, [alice()], { loading: true, error: true, errorMessage: 'Network down' });
    const snapshot = readSnapshot({ people }, HOST);
    expect(snapshot.loading).toBe(true);
    expect(snapshot.error).toBe('Network down');
  });

  it('changes the signature only when the parsed data changes', () => {
    const people = dataset(PEOPLE_COLUMNS, [alice()]);
    const first = readSnapshot({ people, allocations: dataset(ALLOCATION_COLUMNS, [{ values: { Name: 'Alice Adams', Date: '2026-01-05', HoursWorked: 8 } }]) }, HOST);
    const same = readSnapshot({ people, allocations: dataset(ALLOCATION_COLUMNS, [{ values: { Name: 'Alice Adams', Date: '2026-01-05', HoursWorked: 8 } }]) }, HOST);
    const changed = readSnapshot({ people, allocations: dataset(ALLOCATION_COLUMNS, [{ values: { Name: 'Alice Adams', Date: '2026-01-05', HoursWorked: 16 } }]) }, HOST);
    expect(snapshotSignature(same)).toBe(snapshotSignature(first));
    expect(snapshotSignature(changed)).not.toBe(snapshotSignature(first));
  });

  it('ignores the order the host happens to list rows in', () => {
    const people = dataset(PEOPLE_COLUMNS, [alice(), bob()]);
    const reversedPeople = dataset(PEOPLE_COLUMNS, [bob(), alice()]);
    const allocations = dataset(ALLOCATION_COLUMNS, [
      { values: { Name: 'Alice Adams', Date: '2026-01-05', HoursWorked: 8 } },
      { values: { Name: 'Bob Brown', Date: '2026-01-06', HoursWorked: 4 } },
    ]);
    const shuffled = dataset(ALLOCATION_COLUMNS, [
      { values: { Name: 'Bob Brown', Date: '2026-01-06', HoursWorked: 4 } },
      { values: { Name: 'Alice Adams', Date: '2026-01-05', HoursWorked: 8 } },
    ]);

    expect(snapshotSignature(readSnapshot({ people: reversedPeople, allocations: shuffled }, HOST))).toBe(
      snapshotSignature(readSnapshot({ people, allocations }, HOST)),
    );
  });

  it('hashes a published payload the same as the snapshot it comes back as', () => {
    const snapshot = readSnapshot(
      {
        people: dataset(PEOPLE_COLUMNS, [alice()]),
        allocations: dataset(ALLOCATION_COLUMNS, [
          { values: { Name: 'Alice Adams', Date: '2026-01-05', HoursWorked: 8 } },
          { values: { Name: 'Alice Adams', Date: '2026-01-06', HoursWorked: 7.5 } },
        ]),
      },
      HOST,
    );
    const payload = buildOutput(createStore(snapshot.allocations), snapshot.people, snapshot.timeline);
    const output: GridOutput = { revision: 1, action: 'hoursChanged', personName: 'Alice Adams', ...payload };

    // This is what lets the component recognise the app writing its own change back.
    expect(outputSignature(output, snapshot)).toBe(snapshotSignature(snapshot));
  });

  it('clamps the host scalars that drive the generated timeline', () => {
    expect(clampWeeks(0)).toBe(1);
    expect(clampWeeks(999)).toBe(52);
    expect(clampWeeks(Number.NaN)).toBe(1);
    expect(clampHoursPerDay(1)).toBe(1);
    expect(clampHoursPerDay(100)).toBe(24);
  });
});

// A canvas host delivers the records of a nonprimary dataset but not always a usable description of
// its columns. The recorded hours must still be read, and when they genuinely cannot be, the
// warning has to say what the host did deliver.
describe('hosts that do not describe their columns', () => {
  it('reads bookings by property-set name when the host reports no columns', () => {
    const allocations = dataset([], [
      { values: { PersonName: 'Alice Adams', AllocationDate: '2026-01-05', HoursWorked: '8' } },
      { values: { PersonName: 'Alice Adams', AllocationDate: '2026-01-06', HoursWorked: 7.5 } },
    ]);
    const snapshot = readSnapshot({ allocations }, HOST);
    expect(snapshot.allocations).toEqual([
      { personKey: 'Alice Adams', dateKey: '2026-01-05', hours: 8 },
      { personKey: 'Alice Adams', dateKey: '2026-01-06', hours: 7.5 },
    ]);
    expect(snapshot.warnings.some((warning) => /no Date the grid can read/i.test(warning))).toBe(false);
  });

  it('reads the timeline by name when the host reports no columns', () => {
    const timeline = dataset([], [
      { values: { Date: '2026-01-05', Value: 1, Weekday: 1, WeekNum: 1, MonthNum: 1, YearNum: 2026 } },
      { values: { Date: '2026-01-06', Value: 2, Weekday: 2, WeekNum: 1, MonthNum: 1, YearNum: 2026 } },
    ]);
    const snapshot = readSnapshot({ timeline }, HOST);
    expect(snapshot.timelineFromHost).toBe(true);
    expect(snapshot.timeline.map((day) => day.dateKey)).toEqual(['2026-01-05', '2026-01-06']);
    expect(snapshot.warnings).toEqual([]);
  });

  it('matches columns that still carry their table qualifier', () => {
    const allocations = dataset(
      [
        { name: 'colAllocatedHours.PersonName' },
        { name: 'colAllocatedHours.AllocationDate', dataType: 'DateAndTime.DateOnly' },
        { name: 'colAllocatedHours.HoursWorked', dataType: 'Decimal' },
      ],
      [
        {
          values: {
            'colAllocatedHours.PersonName': 'Alice Adams',
            'colAllocatedHours.AllocationDate': '2026-01-05',
            'colAllocatedHours.HoursWorked': 8,
          },
        },
      ],
    );
    const snapshot = readSnapshot({ allocations }, HOST);
    expect(snapshot.allocations).toEqual([{ personKey: 'Alice Adams', dateKey: '2026-01-05', hours: 8 }]);
    expect(snapshot.warnings.some((warning) => /no Date the grid can read/i.test(warning))).toBe(false);
  });

  it('names the delivered columns when nothing can be read', () => {
    const allocations = dataset([{ name: 'SomeOtherColumn' }], [{ values: { SomeOtherColumn: 'x' } }]);
    const snapshot = readSnapshot({ allocations }, HOST);
    const warning = snapshot.warnings.find((entry) => /no Date the grid can read/i.test(entry)) ?? '';
    expect(warning).toContain('delivered 1 row');
    expect(warning).toContain('Host columns: SomeOtherColumn.');
    expect(warning).toContain('AllocationDate=empty');
  });
});
