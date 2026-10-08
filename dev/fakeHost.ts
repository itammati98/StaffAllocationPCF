/**
 * A miniature canvas host.
 *
 * The real host hands the control one dataset per bound collection plus the scalar properties, and
 * redelivers them whenever any collection changes. This module builds exactly that input from plain
 * collections, so the dev page (`dev/main.tsx`) and the component tests can drive
 * `TimeFeesGrid.updateView` / `getOutputs` the way a canvas app does, including the write-back that
 * a canvas `OnChange` formula would perform.
 *
 * Datasets carry the collection's own column names and deliver dates as `Date` objects, which is
 * what a canvas collection hands a code component.
 */
import type { AllocationEntry, GridHostInputs, GridOutput, PersonRow, TimelineDay } from '../TimeFeesGrid/src/types';
import type { IInputs } from '../TimeFeesGrid/generated/ManifestTypes';

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type EntityRecord = ComponentFramework.PropertyHelper.DataSetApi.EntityRecord;

/** One row of a fake dataset: the values the component reads, plus the record id it would report. */
export interface FakeRow {
  /** Record id; a positional one is used when the row does not name one. */
  id?: string;
  values: Record<string, unknown>;
}

export interface FakeColumn {
  name: string;
  dataType?: string;
}

/** A dataset whose rows can be replaced, the way a changed collection is redelivered. */
export type FakeDataSet = DataSet & { setRows(rows: readonly FakeRow[]): void };

function formatValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toLocaleDateString();
  }
  return value === null || value === undefined ? '' : String(value);
}

/** Builds one canvas-shaped dataset. Columns and rows are read lazily, so `setRows` is enough. */
export function fakeDataSet(columns: readonly FakeColumn[], rows: readonly FakeRow[]): FakeDataSet {
  let current = rows;

  const dataset = {
    get columns() {
      return columns.map((column) => ({
        name: column.name,
        displayName: column.name,
        dataType: column.dataType ?? 'SingleLine.Text',
        isHidden: false,
        order: 0,
        visualSizeFactor: 1,
      }));
    },
    get sortedRecordIds() {
      return current.map((row, index) => row.id ?? `rec-${index}`);
    },
    get records() {
      const records: Record<string, EntityRecord> = {};
      current.forEach((row, index) => {
        const id = row.id ?? `rec-${index}`;
        records[id] = {
          getValue: (name: string) => row.values[name],
          getFormattedValue: (name: string) => formatValue(row.values[name]),
          getRecordId: () => id,
        } as EntityRecord;
      });
      return records;
    },
    loading: false,
    error: false,
    errorMessage: '',
    setRows(next: readonly FakeRow[]) {
      current = next;
    },
  };

  return dataset as unknown as FakeDataSet;
}

const PEOPLE_COLUMNS: FakeColumn[] = [
  { name: 'Name' },
  { name: 'JobLevel' },
  { name: 'Team' },
  { name: 'CostRate', dataType: 'Decimal' },
  { name: 'FeeRate', dataType: 'Decimal' },
  { name: 'RPH', dataType: 'Decimal' },
  { name: 'Realisation', dataType: 'Decimal' },
  { name: 'JobLevelOrder', dataType: 'Whole.None' },
  { name: 'IsToBeAdded', dataType: 'TwoOptions' },
  { name: 'CurrencyID' },
];

const ALLOCATION_COLUMNS: FakeColumn[] = [
  { name: 'Name' },
  { name: 'Date', dataType: 'DateAndTime.DateOnly' },
  { name: 'PersonName' },
  { name: 'AllocationDate', dataType: 'DateAndTime.DateOnly' },
  { name: 'Value', dataType: 'Whole.None' },
  { name: 'Weekday', dataType: 'Whole.None' },
  { name: 'WeekNum', dataType: 'Whole.None' },
  { name: 'MonthNum', dataType: 'Whole.None' },
  { name: 'YearNum', dataType: 'Whole.None' },
  { name: 'HoursWorked', dataType: 'Decimal' },
];

const TIMELINE_COLUMNS: FakeColumn[] = [
  { name: 'Date', dataType: 'DateAndTime.DateOnly' },
  { name: 'Value', dataType: 'Whole.None' },
  { name: 'Weekday', dataType: 'Whole.None' },
  { name: 'WeekNum', dataType: 'Whole.None' },
  { name: 'MonthNum', dataType: 'Whole.None' },
  { name: 'YearNum', dataType: 'Whole.None' },
];

/** `2026-01-05` as the local midnight a canvas collection delivers. */
export function dateFromKey(dateKey: string): Date {
  return new Date(Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)) - 1, Number(dateKey.slice(8, 10)));
}

export function peopleDataSet(people: readonly PersonRow[]): FakeDataSet {
  return fakeDataSet(
    PEOPLE_COLUMNS,
    people.map((person) => ({
      id: person.key,
      values: {
        Name: person.name,
        JobLevel: person.jobLevel,
        Team: person.team,
        CostRate: person.costRate,
        FeeRate: person.feeRate,
        RPH: person.rph,
        Realisation: person.realisation,
        JobLevelOrder: person.jobLevelOrder,
        IsToBeAdded: person.isToBeAdded,
        CurrencyID: person.currencyId,
      },
    })),
  );
}

/**
 * colAllocatedHours as the app binds it: the collection columns plus the PersonName / AllocationDate
 * aliases the documented `AddColumns(colAllocatedHours, PersonName, Name, AllocationDate, Date)`
 * binding adds.
 */
export function allocationDataSet(entries: readonly AllocationEntry[]): FakeDataSet {
  return fakeDataSet(
    ALLOCATION_COLUMNS,
    entries.map((entry) => {
      const date = dateFromKey(entry.dateKey);
      return {
        values: {
          Name: entry.personKey,
          Date: date,
          PersonName: entry.personKey,
          AllocationDate: date,
          Value: 0,
          Weekday: 0,
          WeekNum: 0,
          MonthNum: Number(entry.dateKey.slice(5, 7)),
          YearNum: Number(entry.dateKey.slice(0, 4)),
          HoursWorked: entry.hours,
        },
      };
    }),
  );
}

export function timelineDataSet(days: readonly TimelineDay[]): FakeDataSet {
  return fakeDataSet(
    TIMELINE_COLUMNS,
    days.map((day) => ({
      values: {
        Date: day.date,
        Value: day.value,
        Weekday: day.weekday,
        WeekNum: day.weekNum,
        MonthNum: day.monthNum,
        YearNum: day.yearNum,
      },
    })),
  );
}

/** The people collection an app holds after writing a published payload back. */
export function peopleFromOutput(output: GridOutput, current: readonly PersonRow[]): PersonRow[] {
  const keyByName = new Map(current.map((person) => [person.name, person.key]));
  return output.people.map((row) => ({
    key: keyByName.get(row.Name) ?? row.Name,
    name: row.Name,
    jobLevel: row.JobLevel,
    team: row.Team,
    costRate: row.CostRate,
    feeRate: row.FeeRate,
    rph: row.RPH,
    realisation: row.Realisation,
    jobLevelOrder: row.JobLevelOrder,
    isToBeAdded: row.IsToBeAdded,
    currencyId: row.CurrencyID,
  }));
}

/** The allocation rows an app holds after writing a published payload back. */
export function allocationsFromOutput(output: GridOutput): AllocationEntry[] {
  return output.allocations.map((row) => ({ personKey: row.Name, dateKey: row.Date, hours: row.HoursWorked }));
}

export interface FakeHostOptions {
  people: readonly PersonRow[];
  allocations: readonly AllocationEntry[];
  timeline: readonly TimelineDay[];
  host: GridHostInputs;
}

/** The bound collections and scalar properties, and the parameter bag built from them. */
export interface FakeHost {
  /** A fresh parameter bag, the way the host builds one per `updateView`. */
  context(): ComponentFramework.Context<IInputs>;
  /** Replaces what the collections hold; the next `context()` reads the new rows. */
  setCollections(next: Partial<Omit<FakeHostOptions, 'host'>>): void;
}

export function createFakeHost(options: FakeHostOptions): FakeHost {
  let people = options.people;
  let allocations = options.allocations;
  let timeline = options.timeline;

  const host = options.host;

  return {
    context(): ComponentFramework.Context<IInputs> {
      const parameters = {
        gridPeople: peopleDataSet(people),
        gridAllocations: allocationDataSet(allocations),
        gridTimeline: timelineDataSet(timeline),
        workstreamStart: { raw: host.workstreamStart, formatted: '' },
        numberOfWeeks: { raw: host.numberOfWeeks, formatted: String(host.numberOfWeeks) },
        hoursPerDay: { raw: host.hoursPerDay, formatted: String(host.hoursPerDay) },
        phasing: { raw: host.phasing, formatted: host.phasing },
        pricingMethod: { raw: host.pricingMethod, formatted: host.pricingMethod },
        readOnly: { raw: host.readOnly, formatted: String(host.readOnly) },
        showNotifications: { raw: host.showNotifications, formatted: String(host.showNotifications) },
        accentColor: { raw: host.colors.accent },
        backgroundColor: { raw: host.colors.background },
        headerColor: { raw: host.colors.header },
        textColor: { raw: host.colors.text },
        overCapacityColor: { raw: host.colors.overCapacity },
        overCapacityTextColor: { raw: host.colors.overCapacityText },
      };
      return { parameters } as unknown as ComponentFramework.Context<IInputs>;
    },
    setCollections(next) {
      people = next.people ?? people;
      allocations = next.allocations ?? allocations;
      timeline = next.timeline ?? timeline;
    },
  };
}
