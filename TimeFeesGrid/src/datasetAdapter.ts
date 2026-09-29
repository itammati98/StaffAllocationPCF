/**
 * Host dataset adapter.
 *
 * The only module that touches the `ComponentFramework.PropertyTypes.DataSet` API: it turns the
 * three bound datasets (people, allocations, timeline) plus the host scalars into the immutable
 * `GridSnapshot` the engine and the React app work from.
 *
 * Everything here is defensive: canvas apps deliver column names with or without `[]`/quotes,
 * hand back dates as `Date`, ISO strings or epoch millis, numbers as numeric strings, and may
 * throw from a single cell. A broken cell degrades to its default; it never breaks the grid.
 */

import {
  allocationKey,
  buildTimeline,
  isWorkingDay,
  realisationFromRph,
  toDate,
  toDateKey,
  toNumber,
  weekdayOf,
} from './engine';
import type { AllocationEntry, GridHostInputs, GridSnapshot, PersonRow, TimelineDay } from './types';

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type Column = ComponentFramework.PropertyHelper.DataSetApi.Column;
type EntityRecord = ComponentFramework.PropertyHelper.DataSetApi.EntityRecord;

/** The three dataset properties the control binds to. */
export interface AdapterDatasets {
  people?: DataSet;
  allocations?: DataSet;
  timeline?: DataSet;
}

/** Accepted column names per host column, most specific first. Brackets/quotes are normalised away. */
const NAME_COLUMNS = ['Name', 'Person', 'PersonName'];
const JOB_LEVEL_COLUMNS = ['JobLevel', 'Job Level'];
const TEAM_COLUMNS = ['Team', 'TeamName', 'Team Name'];
const COST_RATE_COLUMNS = ['CostRate', 'Cost Rate'];
const FEE_RATE_COLUMNS = ['FeeRate', 'Fee Rate'];
const RPH_COLUMNS = ['RPH', 'RatePerHour', 'Rate Per Hour'];
const REALISATION_COLUMNS = ['Realisation', 'Realization'];
const JOB_LEVEL_ORDER_COLUMNS = ['JobLevelOrder', 'Job Level Order'];
const IS_TO_BE_ADDED_COLUMNS = ['IsToBeAdded', 'Is To Be Added'];
const CURRENCY_COLUMNS = ['CurrencyID', 'Currency Id', 'Currency'];

const DATE_COLUMNS = ['Date', 'TimelineDate', 'AllocationDate', 'DateValue'];
const VALUE_COLUMNS = ['Value', 'TimelineValue', 'DayNumber', 'Day No'];
const WEEKDAY_COLUMNS = ['Weekday', 'TimelineWeekday', 'DayOfWeek', 'Day Of Week'];
const WEEK_NUM_COLUMNS = ['WeekNum', 'TimelineWeekNum', 'WeekNumber', 'Week Number', 'WeekNo'];
const MONTH_NUM_COLUMNS = ['MonthNum', 'TimelineMonthNum', 'MonthNumber', 'Month Number', 'MonthNo', 'Month'];
const YEAR_NUM_COLUMNS = ['YearNum', 'TimelineYearNum', 'YearNumber', 'Year Number', 'Year'];
const HOURS_COLUMNS = ['HoursWorked', 'Hours', 'Hours Worked'];

/** Bounds applied to the host scalars that drive the generated timeline. */
const MIN_WEEKS = 1;
const MAX_WEEKS = 52;
const MIN_HOURS_PER_DAY = 0.5;
const MAX_HOURS_PER_DAY = 24;
const DEFAULT_HOURS_PER_DAY = 8;

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;
const FIELD_TERMINATOR = 0x1f;

// ---------------------------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------------------------

/**
 * Parses the bound datasets into a snapshot. Never throws: unreadable rows are skipped and
 * reported through `warnings`, and an empty timeline falls back to a generated one.
 */
export function readSnapshot(datasets: AdapterDatasets, host: GridHostInputs): GridSnapshot {
  const warnings = new WarningBag();

  const people = readPeople(datasets.people, warnings);
  const allocations = readAllocations(datasets.allocations, people, warnings);
  const hostTimeline = readTimeline(datasets.timeline, warnings);

  let timeline = hostTimeline;
  let timelineFromHost = hostTimeline.length > 0;
  if (!timelineFromHost) {
    const weeks = clampWeeks(host.numberOfWeeks);
    const start = generatedTimelineStart(host, allocations);
    timeline = buildTimeline(start, weeks);
    timelineFromHost = false;
    warnings.add(
      `The timeline dataset is empty, so the grid generated a ${weeks}-week timeline starting ${toDateKey(start)}.`
    );
  }

  const error =
    datasetError(datasets.people, 'people list') ??
    datasetError(datasets.allocations, 'allocations') ??
    datasetError(datasets.timeline, 'timeline');

  return {
    people,
    timeline,
    allocations,
    timelineFromHost,
    warnings: warnings.all(),
    loading: datasetLoading(datasets.people),
    error,
  };
}

/**
 * A cheap rolling (FNV-1a, 32-bit) hash over the parsed data. Two snapshots share a signature
 * exactly when their people, timeline and allocations are identical, so the component can skip
 * rebasing the editor state when the host re-pushes the same data.
 */
export function snapshotSignature(snapshot: GridSnapshot): string {
  let hash = FNV_OFFSET_BASIS;

  hash = hashText(hash, `people:${snapshot.people.length}`);
  for (const person of snapshot.people) {
    hash = hashText(hash, person.key);
    hash = hashText(hash, person.name);
    hash = hashText(hash, person.jobLevel);
    hash = hashText(hash, person.team);
    hash = hashText(hash, person.currencyId);
    hash = hashNumber(hash, person.costRate);
    hash = hashNumber(hash, person.feeRate);
    hash = hashNumber(hash, person.rph);
    hash = hashNumber(hash, person.realisation);
    hash = hashNumber(hash, person.jobLevelOrder);
    hash = hashText(hash, person.isToBeAdded ? '1' : '0');
  }

  hash = hashText(hash, `timeline:${snapshot.timeline.length}`);
  for (const day of snapshot.timeline) {
    hash = hashText(hash, day.dateKey);
    hash = hashNumber(hash, day.value);
    hash = hashNumber(hash, day.weekday);
    hash = hashNumber(hash, day.weekNum);
    hash = hashNumber(hash, day.monthNum);
    hash = hashNumber(hash, day.yearNum);
    hash = hashText(hash, day.isWorkingDay ? '1' : '0');
  }

  hash = hashText(hash, `allocations:${snapshot.allocations.length}`);
  for (const entry of snapshot.allocations) {
    hash = hashText(hash, allocationKey(entry.personKey, entry.dateKey));
    hash = hashNumber(hash, entry.hours);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------
// Host scalars
// ---------------------------------------------------------------------------------------------

/** Clamps `numberOfWeeks` to 1..52; anything unreadable becomes 1. */
export function clampWeeks(weeks: number): number {
  const value = Number(weeks);
  if (!Number.isFinite(value)) {
    return MIN_WEEKS;
  }
  return Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, Math.floor(value)));
}

/** Clamps `hoursPerDay` to 0.5..24; anything unreadable becomes 8. */
export function clampHoursPerDay(hoursPerDay: number): number {
  const value = Number(hoursPerDay);
  if (!Number.isFinite(value)) {
    return DEFAULT_HOURS_PER_DAY;
  }
  return Math.min(MAX_HOURS_PER_DAY, Math.max(MIN_HOURS_PER_DAY, value));
}

// ---------------------------------------------------------------------------------------------
// Dataset plumbing
// ---------------------------------------------------------------------------------------------

/** Trims, strips one surrounding `[]`/`'`/`"` pair and lower-cases a column name for matching. */
function normalizeColumnName(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  let name = value.trim();
  if (name.length >= 2) {
    const first = name.charAt(0);
    const last = name.charAt(name.length - 1);
    const bracketed = first === '[' && last === ']';
    const singleQuoted = first === "'" && last === "'";
    const doubleQuoted = first === '"' && last === '"';
    if (bracketed || singleQuoted || doubleQuoted) {
      name = name.slice(1, -1).trim();
    }
  }
  return name.toLowerCase();
}

/** First column matching any of `names` (normalised), or null. */
function findColumn(dataset: DataSet | undefined, names: readonly string[]): Column | null {
  if (!dataset) {
    return null;
  }
  let columns: Column[];
  try {
    columns = dataset.columns;
  } catch {
    return null;
  }
  if (!Array.isArray(columns)) {
    return null;
  }
  for (const candidate of names) {
    const wanted = normalizeColumnName(candidate);
    if (!wanted) {
      continue;
    }
    for (const column of columns) {
      if (column && normalizeColumnName(column.name) === wanted) {
        return column;
      }
    }
  }
  return null;
}

/** All records of a dataset, in `sortedRecordIds` order, followed by any unlisted records. */
function readRecords(dataset: DataSet | undefined): EntityRecord[] {
  const records: EntityRecord[] = [];
  if (!dataset) {
    return records;
  }
  try {
    const byId = dataset.records;
    if (!byId) {
      return records;
    }
    const seen = new Set<string>();
    const ids = Array.isArray(dataset.sortedRecordIds) ? dataset.sortedRecordIds : [];
    for (const id of ids) {
      const record = byId[id];
      if (record && !seen.has(id)) {
        seen.add(id);
        records.push(record);
      }
    }
    for (const id of Object.keys(byId)) {
      const record = byId[id];
      if (record && !seen.has(id)) {
        seen.add(id);
        records.push(record);
      }
    }
  } catch {
    // A dataset that cannot be enumerated contributes no rows.
  }
  return records;
}

/** Text-ish manifest data types, used to decide whether a formatted fallback is meaningful. */
function isTextColumn(column: Column | null): boolean {
  if (!column) {
    return false;
  }
  const dataType = typeof column.dataType === 'string' ? column.dataType.toLowerCase() : '';
  return dataType.startsWith('singleline') || dataType.startsWith('multiple') || dataType === 'text';
}

/**
 * Raw cell value. `getValue` is guarded; a throwing cell degrades to `undefined`. When it yields
 * null/undefined and the column is text, the formatted value is used instead.
 */
function readCell(record: EntityRecord, column: Column | null): unknown {
  if (!column) {
    return undefined;
  }
  let value: unknown;
  try {
    value = record.getValue(column.name);
  } catch {
    return undefined;
  }
  if (value !== null && value !== undefined) {
    return value;
  }
  if (isTextColumn(column)) {
    try {
      const formatted = record.getFormattedValue(column.name);
      if (formatted !== null && formatted !== undefined) {
        return formatted;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Cell as a finite number; anything unreadable is 0. */
function readNumber(record: EntityRecord, column: Column | null): number {
  const value = toNumber(readCell(record, column));
  return Number.isFinite(value) ? value : 0;
}

/** Cell as trimmed text; anything unreadable is ''. */
function readText(record: EntityRecord, column: Column | null): string {
  const raw = readCell(record, column);
  if (typeof raw === 'string') {
    return raw.trim();
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw).trim();
  }
  if (column && !isTextColumn(column)) {
    try {
      const formatted = record.getFormattedValue(column.name);
      if (typeof formatted === 'string') {
        return formatted.trim();
      }
    } catch {
      return '';
    }
  }
  return '';
}

/** Cell as a boolean: `boolean`, `0|1` or `'true'|'yes'`. Anything else is false. */
function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value !== 0 : false;
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    return text === 'true' || text === '1' || text === 'yes';
  }
  return false;
}

/** Record id when the host supplies one, else the supplied fallback (the person name). */
function readRecordKey(record: EntityRecord, fallback: string): string {
  try {
    const id = record.getRecordId();
    if (typeof id === 'string') {
      const trimmed = id.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  } catch {
    // Fall through to the name.
  }
  return fallback;
}

function datasetLoading(dataset: DataSet | undefined): boolean {
  if (!dataset) {
    return false;
  }
  try {
    return dataset.loading === true;
  } catch {
    return false;
  }
}

function datasetError(dataset: DataSet | undefined, label: string): string | null {
  if (!dataset) {
    return null;
  }
  try {
    if (dataset.error !== true) {
      return null;
    }
    const message = typeof dataset.errorMessage === 'string' ? dataset.errorMessage.trim() : '';
    return message.length > 0 ? message : `The host reported an error while loading the ${label}.`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------

function readPeople(dataset: DataSet | undefined, warnings: WarningBag): PersonRow[] {
  const records = readRecords(dataset);
  if (records.length === 0) {
    return [];
  }

  const nameColumn = findColumn(dataset, NAME_COLUMNS);
  const jobLevelColumn = findColumn(dataset, JOB_LEVEL_COLUMNS);
  const teamColumn = findColumn(dataset, TEAM_COLUMNS);
  const costRateColumn = findColumn(dataset, COST_RATE_COLUMNS);
  const feeRateColumn = findColumn(dataset, FEE_RATE_COLUMNS);
  const rphColumn = findColumn(dataset, RPH_COLUMNS);
  const realisationColumn = findColumn(dataset, REALISATION_COLUMNS);
  const jobLevelOrderColumn = findColumn(dataset, JOB_LEVEL_ORDER_COLUMNS);
  const isToBeAddedColumn = findColumn(dataset, IS_TO_BE_ADDED_COLUMNS);
  const currencyColumn = findColumn(dataset, CURRENCY_COLUMNS);

  const people: PersonRow[] = [];
  let nameless = 0;

  for (const record of records) {
    const name = readText(record, nameColumn);
    if (name.length === 0) {
      nameless++;
      continue;
    }
    const feeRate = readNumber(record, feeRateColumn);
    const rph = readNumber(record, rphColumn);
    const suppliedRealisation = readNumber(record, realisationColumn);
    people.push({
      key: readRecordKey(record, name),
      name,
      jobLevel: readText(record, jobLevelColumn),
      team: readText(record, teamColumn),
      costRate: readNumber(record, costRateColumn),
      feeRate,
      rph,
      realisation:
        suppliedRealisation > 0 && Number.isFinite(suppliedRealisation)
          ? suppliedRealisation
          : realisationFromRph(rph, feeRate),
      jobLevelOrder: readNumber(record, jobLevelOrderColumn),
      isToBeAdded: toBoolean(readCell(record, isToBeAddedColumn)),
      currencyId: readText(record, currencyColumn),
    });
  }

  if (nameless > 0) {
    warnings.add(
      `Skipped ${count(nameless, 'people row')} with an empty Name; the grid cannot show them.`
    );
  }
  return people;
}

// ---------------------------------------------------------------------------------------------
// Allocations
// ---------------------------------------------------------------------------------------------

function readAllocations(
  dataset: DataSet | undefined,
  people: readonly PersonRow[],
  warnings: WarningBag
): AllocationEntry[] {
  const records = readRecords(dataset);
  if (records.length === 0) {
    return [];
  }

  const dateColumn = findColumn(dataset, DATE_COLUMNS);
  const nameColumn = findColumn(dataset, NAME_COLUMNS);
  const hoursColumn = findColumn(dataset, HOURS_COLUMNS);

  const keyByName = new Map<string, string>();
  for (const person of people) {
    if (!keyByName.has(person.name)) {
      keyByName.set(person.name, person.key);
    }
  }

  const entries: AllocationEntry[] = [];
  let unreadableDates = 0;
  let unknownNames = 0;

  for (const record of records) {
    const date = toDate(readCell(record, dateColumn));
    if (!date) {
      unreadableDates++;
      continue;
    }
    const hours = readNumber(record, hoursColumn);
    if (!Number.isFinite(hours)) {
      continue;
    }
    const name = readText(record, nameColumn);
    const knownKey = keyByName.get(name);
    if (knownKey === undefined) {
      // Hours for a name that has no person row are preserved under the name itself.
      unknownNames++;
    }
    entries.push({
      personKey: knownKey ?? name,
      dateKey: toDateKey(date),
      hours,
    });
  }

  if (unreadableDates > 0) {
    warnings.add(`Skipped ${count(unreadableDates, 'allocation row')} with an unreadable Date.`);
  }
  if (unknownNames > 0) {
    warnings.add(
      `Kept ${count(unknownNames, 'allocation row')} whose Name is not in the people list; ` +
        'their hours are preserved but they have no person row.'
    );
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------------------------

interface RawTimelineRow {
  dateKey: string;
  date: Date;
  value: number;
  weekday: number;
  weekNum: number;
  monthNum: number;
  yearNum: number;
}

function readTimeline(dataset: DataSet | undefined, warnings: WarningBag): TimelineDay[] {
  const records = readRecords(dataset);
  if (records.length === 0) {
    return [];
  }

  const dateColumn = findColumn(dataset, DATE_COLUMNS);
  const valueColumn = findColumn(dataset, VALUE_COLUMNS);
  const weekdayColumn = findColumn(dataset, WEEKDAY_COLUMNS);
  const weekColumn = findColumn(dataset, WEEK_NUM_COLUMNS);
  const monthColumn = findColumn(dataset, MONTH_NUM_COLUMNS);
  const yearColumn = findColumn(dataset, YEAR_NUM_COLUMNS);

  const rows: RawTimelineRow[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let unreadableDates = 0;
  let usableWeekday = false;

  for (const record of records) {
    const date = toDate(readCell(record, dateColumn));
    if (!date) {
      unreadableDates++;
      continue;
    }
    const dateKey = toDateKey(date);
    if (seen.has(dateKey)) {
      duplicates++;
      continue;
    }
    seen.add(dateKey);
    const weekday = Math.trunc(readNumber(record, weekdayColumn));
    if (weekday >= 1 && weekday <= 7) {
      usableWeekday = true;
    }
    rows.push({
      dateKey,
      date,
      value: readNumber(record, valueColumn),
      weekday,
      weekNum: Math.trunc(readNumber(record, weekColumn)),
      monthNum: Math.trunc(readNumber(record, monthColumn)),
      yearNum: Math.trunc(readNumber(record, yearColumn)),
    });
  }

  if (unreadableDates > 0) {
    warnings.add(`Skipped ${count(unreadableDates, 'timeline row')} with an unreadable Date.`);
  }
  if (duplicates > 0) {
    warnings.add(
      `Ignored ${count(duplicates, 'duplicate timeline row')}; the first row for each date is used.`
    );
  }
  if (rows.length > 0 && !usableWeekday) {
    warnings.add(
      'The timeline has no usable Weekday column, so every day in the timeline is treated as a working day.'
    );
  }

  const days: TimelineDay[] = [];
  for (const row of rows) {
    const suppliedWeekday = row.weekday >= 1 && row.weekday <= 7;
    const weekday = suppliedWeekday ? row.weekday : weekdayOf(row.date);
    let working = true;
    if (usableWeekday) {
      working = suppliedWeekday ? weekday <= 5 : isWorkingDay(row.date);
    }
    days.push({
      dateKey: row.dateKey,
      date: row.date,
      value: row.value,
      weekday,
      weekNum:
        row.weekNum > 0
          ? row.weekNum
          : row.value > 0
            ? Math.ceil(row.value / 5)
            : isoWeekNumber(row.date),
      monthNum: row.monthNum >= 1 && row.monthNum <= 12 ? row.monthNum : row.date.getMonth() + 1,
      yearNum: row.yearNum > 1900 ? row.yearNum : row.date.getFullYear(),
      isWorkingDay: working,
    });
  }

  days.sort((left, right) =>
    left.dateKey < right.dateKey ? -1 : left.dateKey > right.dateKey ? 1 : 0
  );
  return days;
}

/** ISO-8601 week number of a local date (weeks start on Monday, week 1 holds the first Thursday). */
function isoWeekNumber(date: Date): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = target.getUTCDay() === 0 ? 7 : target.getUTCDay();
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ---------------------------------------------------------------------------------------------
// Generated timeline
// ---------------------------------------------------------------------------------------------

/** `workstreamStart` when readable, else the Monday of the earliest allocation, else this Monday. */
function generatedTimelineStart(host: GridHostInputs, allocations: readonly AllocationEntry[]): Date {
  const configured = host.workstreamStart;
  if (configured instanceof Date && Number.isFinite(configured.getTime())) {
    return configured;
  }
  const earliest = earliestAllocationDate(allocations);
  return mondayOf(earliest ?? new Date());
}

function earliestAllocationDate(allocations: readonly AllocationEntry[]): Date | null {
  let earliestKey: string | null = null;
  for (const entry of allocations) {
    if (earliestKey === null || entry.dateKey < earliestKey) {
      earliestKey = entry.dateKey;
    }
  }
  return earliestKey === null ? null : toDate(earliestKey);
}

/** Local midnight of the Monday of the week containing `date`. */
function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - (weekdayOf(monday) - 1));
  return monday;
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/** `1 person row` / `3 people rows`. */
function count(amount: number, noun: string): string {
  return `${amount} ${noun}${amount === 1 ? '' : 's'}`;
}

/** Ordered, de-duplicated warning messages. */
class WarningBag {
  private readonly seen = new Set<string>();
  private readonly messages: string[] = [];

  add(message: string): void {
    if (!this.seen.has(message)) {
      this.seen.add(message);
      this.messages.push(message);
    }
  }

  all(): string[] {
    return this.messages.slice();
  }
}

/** Folds one field into the signature hash, terminating it so field boundaries stay distinct. */
function hashText(hash: number, text: string): number {
  let value = hash;
  for (let index = 0; index < text.length; index++) {
    value = Math.imul(value ^ text.charCodeAt(index), FNV_PRIME);
  }
  return Math.imul(value ^ FIELD_TERMINATOR, FNV_PRIME);
}

function hashNumber(hash: number, value: number): number {
  return hashText(hash, Number.isFinite(value) ? String(value) : '0');
}
