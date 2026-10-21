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
  buildTimeline,
  isWorkingDay,
  isoWeek,
  realisationFromRph,
  round6,
  toDate,
  toDateKey,
  toNumber,
  weekdayOf,
} from './engine';
import type { AllocationEntry, GridHostInputs, GridOutput, GridSnapshot, PersonRow, TimelineDay } from './types';

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
  const timelineRead = readTimeline(datasets.timeline, warnings);

  let timeline = timelineRead.days;
  const timelineFromHost = timeline.length > 0;
  if (!timelineFromHost) {
    const weeks = clampWeeks(host.numberOfWeeks);
    const start = generatedTimelineStart(host, allocations);
    timeline = buildTimeline(start, weeks);
    warnings.add(
      timelineRead.rows > 0
        ? `The timeline table's ${count(timelineRead.rows, 'row')} could not be read, so the grid generated a ${weeks}-week timeline starting ${toDateKey(start)}.`
        : `The timeline dataset is empty, so the grid generated a ${weeks}-week timeline starting ${toDateKey(start)}.`
    );
  }

  // Public holidays the app lists are not working days: no column books hours on them.
  if (host.holidays.length > 0) {
    const holidays = new Set(host.holidays);
    timeline = timeline.map((day) => (day.isWorkingDay && holidays.has(day.dateKey) ? { ...day, isWorkingDay: false } : day));
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
 * A cheap rolling (FNV-1a, 32-bit) hash over the parsed data, used for two things:
 *
 * 1. skipping work when the host re-pushes the same data (canvas re-delivers a dataset whenever any
 *    collection changes, even when this one did not), and
 * 2. recognising the host echoing back what the component just published, so writing a change into
 *    the collections does not rebase the editor state and make the grid flicker.
 *
 * It is order independent: the same people, timeline and booked hours hash the same however the host
 * orders its rows, because a canvas `Collect`/`ClearCollect` is free to reorder them. Booked hours are
 * keyed by person name and date rather than by record id, because the published payload carries names
 * and the host resolves them back to ids.
 */
export function snapshotSignature(snapshot: GridSnapshot): string {
  const names = new Map<string, string>();
  for (const person of snapshot.people) names.set(person.key, person.name);
  return contentSignature(snapshot.people, snapshot.timeline, snapshot.allocations, names);
}

/**
 * Signature of what the component last published, in the same canonical form as
 * `snapshotSignature`. When the host writes the payload into its collections, the snapshot it
 * delivers back hashes to exactly this value.
 */
export function outputSignature(output: GridOutput, snapshot: GridSnapshot): string {
  const names = new Map<string, string>();
  const keyByName = new Map<string, string>();
  for (const person of snapshot.people) {
    names.set(person.key, person.name);
    if (!keyByName.has(person.name)) keyByName.set(person.name, person.key);
  }

  const people: SignaturePerson[] = output.people.map((person) => ({
    key: keyByName.get(person.Name) ?? person.Name,
    name: person.Name,
    jobLevel: person.JobLevel,
    team: person.Team,
    costRate: person.CostRate,
    feeRate: person.FeeRate,
    rph: person.RPH,
    realisation: person.Realisation,
    jobLevelOrder: person.JobLevelOrder,
    isToBeAdded: person.IsToBeAdded,
    currencyId: person.CurrencyID,
  }));

  const allocations = output.allocations.map((row) => ({
    personKey: keyByName.get(row.Name) ?? row.Name,
    dateKey: row.Date,
    hours: row.HoursWorked,
  }));

  return contentSignature(people, snapshot.timeline, allocations, names);
}

/** The fields of one person row that both a parsed snapshot and a published payload carry. */
interface SignaturePerson {
  key: string;
  name: string;
  jobLevel: string;
  team: string;
  costRate: number;
  feeRate: number;
  rph: number;
  realisation: number;
  jobLevelOrder: number;
  isToBeAdded: boolean;
  currencyId: string;
}

function byText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Hashes people, timeline and summed day hours in an order-independent form. */
function contentSignature(
  rows: readonly SignaturePerson[],
  timeline: readonly TimelineDay[],
  entries: readonly AllocationEntry[],
  names: ReadonlyMap<string, string>,
): string {
  let hash = FNV_OFFSET_BASIS;

  const people = [...rows].sort((left, right) => byText(left.key, right.key));
  hash = hashText(hash, `people:${people.length}`);
  for (const person of people) {
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

  const days = [...timeline].sort((left, right) => byText(left.dateKey, right.dateKey));
  hash = hashText(hash, `timeline:${days.length}`);
  for (const day of days) {
    hash = hashText(hash, day.dateKey);
    hash = hashNumber(hash, day.value);
    hash = hashNumber(hash, day.weekday);
    hash = hashNumber(hash, day.weekNum);
    hash = hashNumber(hash, day.monthNum);
    hash = hashNumber(hash, day.yearNum);
    hash = hashText(hash, day.isWorkingDay ? '1' : '0');
  }

  // Summed per person and day, the way `createStore` does, so duplicate or split rows read alike.
  const hours = new Map<string, number>();
  for (const entry of entries) {
    const value = Number(entry.hours);
    if (!Number.isFinite(value) || value <= 0) continue;
    const key = `${names.get(entry.personKey) ?? entry.personKey}|${entry.dateKey}`;
    hours.set(key, round6((hours.get(key) ?? 0) + value));
  }

  hash = hashText(hash, `allocations:${hours.size}`);
  for (const key of [...hours.keys()].sort(byText)) {
    hash = hashText(hash, key);
    hash = hashNumber(hash, hours.get(key)!);
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

/**
 * Reads the holidays property: a JSON list of dates (`["2026-12-25","2026-12-28"]`), a JSON list
 * of records whose first readable value is a date (what `JSON(colHolidays)` produces), or plain
 * text with the dates separated by commas, semicolons or whitespace. Returns sorted, de-duplicated
 * `YYYY-MM-DD` keys; anything unreadable is ignored.
 */
export function parseHolidays(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [];
  let items: unknown[];
  try {
    const parsed: unknown = JSON.parse(value);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    items = value.split(/[\s,;]+/);
  }
  const keys = new Set<string>();
  for (const item of items) {
    const candidates = item !== null && typeof item === 'object' ? Object.values(item as Record<string, unknown>) : [item];
    for (const candidate of candidates) {
      const date = typeof candidate === 'string' ? toDate(candidate) : null;
      if (date) {
        keys.add(toDateKey(date));
        break;
      }
    }
  }
  return [...keys].sort();
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
      // Column names arrive with optional `[]`/quote delimiters and, from some canvas hosts,
      // with the table qualifier still attached (`colAllocatedHours.Name`); match the whole
      // normalised name and the part after the last dot.
      const name = column ? normalizeColumnName(column.name) : '';
      const dot = name.lastIndexOf('.');
      if (name === wanted || (dot >= 0 && name.slice(dot + 1) === wanted)) {
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
 * One logical field of a dataset row: the column the host reported for it, when a name matched,
 * plus every name worth trying directly against a record.
 *
 * Canvas hosts do not describe the columns of nonprimary datasets consistently - some report none
 * at all - so a read tries the reported column first and then the declared aliases, and only
 * degrades to `undefined` when every name comes back empty.
 */
interface Field {
  /** The column the host reported, when its name matched a declared alias. */
  column: Column | null;
  /** Names to try against a record, most specific first. */
  names: string[];
  /** True when a formatted-value fallback is meaningful for this field. */
  text: boolean;
}

/** Resolves a field from the host columns plus the names declared in the manifest. */
function resolveField(dataset: DataSet | undefined, aliases: readonly string[], text: boolean): Field {
  const column = findColumn(dataset, aliases);
  const names: string[] = [];
  const add = (name: string | undefined): void => {
    const candidate = typeof name === 'string' ? name.trim() : '';
    if (candidate.length > 0 && !names.includes(candidate)) {
      names.push(candidate);
    }
  };
  if (column) {
    add(column.name);
  }
  for (const alias of aliases) {
    add(alias);
  }
  return { column, names, text: text || isTextColumn(column) };
}

/** Raw cell value: the first candidate name that yields something. Never throws. */
function readCell(record: EntityRecord, field: Field): unknown {
  for (const name of field.names) {
    try {
      const value = record.getValue(name);
      if (value !== null && value !== undefined) {
        return value;
      }
    } catch {
      // The host does not know this name; try the next one.
    }
  }
  if (field.text) {
    for (const name of field.names) {
      try {
        const formatted = record.getFormattedValue(name);
        if (formatted !== null && formatted !== undefined) {
          return formatted;
        }
      } catch {
        // Same again.
      }
    }
  }
  return undefined;
}

/** Cell as a finite number; anything unreadable is 0. */
function readNumber(record: EntityRecord, field: Field): number {
  const value = toNumber(readCell(record, field));
  return Number.isFinite(value) ? value : 0;
}

/** Cell as trimmed text; anything unreadable is ''. */
function readText(record: EntityRecord, field: Field): string {
  const raw = readCell(record, field);
  if (typeof raw === 'string') {
    return raw.trim();
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw).trim();
  }
  for (const name of field.names) {
    try {
      const formatted = record.getFormattedValue(name);
      if (typeof formatted === 'string') {
        return formatted.trim();
      }
    } catch {
      // Ignore and try the next name.
    }
  }
  return '';
}

/** Column names the host reported, for the diagnostics below. */
function columnNames(dataset: DataSet | undefined): string[] {
  if (!dataset) {
    return [];
  }
  try {
    const columns = dataset.columns;
    if (!Array.isArray(columns)) {
      return [];
    }
    return columns.map((column) => (column && typeof column.name === 'string' ? column.name : '?'));
  } catch {
    return [];
  }
}

/** One probe read against the first record, for the diagnostics below. */
function probeRead(record: EntityRecord, name: string): string {
  try {
    const value = record.getValue(name);
    return value === null || value === undefined ? 'empty' : typeof value;
  } catch {
    return 'unreadable';
  }
}

/**
 * What the host actually delivered, appended to the warnings about data the grid could not read.
 * A canvas host can hand over records without usable column descriptions, and this line is what
 * makes that visible instead of leaving an empty grid with no explanation.
 */
function describeDataset(dataset: DataSet | undefined, probes: readonly string[]): string {
  const names = columnNames(dataset);
  const parts = [`Host columns: ${names.length > 0 ? names.join(', ') : 'none'}.`];
  const record = readRecords(dataset)[0];
  if (record) {
    parts.push(`First record: ${probes.map((name) => `${name}=${probeRead(record, name)}`).join(', ')}.`);
  }
  return parts.join(' ');
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

  const nameField = resolveField(dataset, NAME_COLUMNS, true);
  const jobLevelField = resolveField(dataset, JOB_LEVEL_COLUMNS, true);
  const teamField = resolveField(dataset, TEAM_COLUMNS, true);
  const costRateField = resolveField(dataset, COST_RATE_COLUMNS, false);
  const feeRateField = resolveField(dataset, FEE_RATE_COLUMNS, false);
  const rphField = resolveField(dataset, RPH_COLUMNS, false);
  const realisationField = resolveField(dataset, REALISATION_COLUMNS, false);
  const jobLevelOrderField = resolveField(dataset, JOB_LEVEL_ORDER_COLUMNS, false);
  const isToBeAddedField = resolveField(dataset, IS_TO_BE_ADDED_COLUMNS, false);
  const currencyField = resolveField(dataset, CURRENCY_COLUMNS, true);

  const people: PersonRow[] = [];
  const seenNames = new Map<string, number>();
  let nameless = 0;

  for (const record of records) {
    const name = readText(record, nameField);
    if (name.length === 0) {
      nameless++;
      continue;
    }
    const feeRate = readNumber(record, feeRateField);
    const rph = readNumber(record, rphField);
    const suppliedRealisation = readNumber(record, realisationField);
    // People are keyed by name, the identity the app's formulas and the published payload use.
    // Canvas record ids are regenerated whenever a collection is rewritten, so they cannot tie a
    // row to its bookings across deliveries. A repeated name gets a numbered key of its own.
    const occurrence = (seenNames.get(name) ?? 0) + 1;
    seenNames.set(name, occurrence);
    people.push({
      key: occurrence === 1 ? name : `${name}#${occurrence}`,
      name,
      jobLevel: readText(record, jobLevelField),
      team: readText(record, teamField),
      costRate: readNumber(record, costRateField),
      feeRate,
      rph,
      realisation:
        suppliedRealisation > 0 && Number.isFinite(suppliedRealisation)
          ? suppliedRealisation
          : realisationFromRph(rph, feeRate),
      jobLevelOrder: readNumber(record, jobLevelOrderField),
      isToBeAdded: toBoolean(readCell(record, isToBeAddedField)),
      currencyId: readText(record, currencyField),
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

  const dateField = resolveField(dataset, DATE_COLUMNS, false);
  const nameField = resolveField(dataset, NAME_COLUMNS, true);
  const hoursField = resolveField(dataset, HOURS_COLUMNS, false);

  const keyByName = new Map<string, string>();
  for (const person of people) {
    if (!keyByName.has(person.name)) {
      keyByName.set(person.name, person.key);
    }
  }

  const entries: AllocationEntry[] = [];
  let unreadableDates = 0;
  let emptyHours = 0;
  let emptyNames = 0;
  let unknownNames = 0;

  for (const record of records) {
    const rawHours = readCell(record, hoursField);
    if (rawHours === null || rawHours === undefined) {
      emptyHours++;
    }
    const name = readText(record, nameField);
    if (name.length === 0) {
      emptyNames++;
    }
    const date = toDate(readCell(record, dateField));
    if (!date) {
      unreadableDates++;
      continue;
    }
    const knownKey = keyByName.get(name);
    if (knownKey === undefined) {
      // Hours for a name that has no person row are preserved under the name itself.
      unknownNames++;
    }
    entries.push({
      personKey: knownKey ?? name,
      dateKey: toDateKey(date),
      hours: toNumber(rawHours),
    });
  }

  // A dataset whose property-sets do not line up with the bound table delivers records with empty
  // cells, and a canvas host does not always describe the columns of a nonprimary dataset at all.
  // Say what is missing and what the host delivered, rather than silently showing no hours.
  if (unreadableDates === records.length) {
    warnings.add(
      `The bookings table delivered ${count(records.length, 'row')} but no Date the grid can read, so its recorded hours cannot be placed on the timeline. Bind colAllocatedHours (Name, Date, HoursWorked). ${describeDataset(dataset, DATE_COLUMNS)}`
    );
  } else if (unreadableDates > 0) {
    warnings.add(`Skipped ${count(unreadableDates, 'allocation row')} with an unreadable Date.`);
  }
  if (emptyHours === records.length) {
    warnings.add(
      `The bookings table delivered ${count(records.length, 'row')} but no HoursWorked the grid can read, so no booked hours are shown. Bind colAllocatedHours (Name, Date, HoursWorked). ${describeDataset(dataset, HOURS_COLUMNS)}`
    );
  }
  if (emptyNames === records.length) {
    warnings.add(
      `The bookings table delivered ${count(records.length, 'row')} but no Name the grid can read, so its hours cannot be matched to the people list. ${describeDataset(dataset, NAME_COLUMNS)}`
    );
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

function readTimeline(dataset: DataSet | undefined, warnings: WarningBag): { days: TimelineDay[]; rows: number } {
  const records = readRecords(dataset);
  if (records.length === 0) {
    return { days: [], rows: 0 };
  }

  const dateField = resolveField(dataset, DATE_COLUMNS, false);
  const valueField = resolveField(dataset, VALUE_COLUMNS, false);
  const weekdayField = resolveField(dataset, WEEKDAY_COLUMNS, false);
  const weekField = resolveField(dataset, WEEK_NUM_COLUMNS, false);
  const monthField = resolveField(dataset, MONTH_NUM_COLUMNS, false);
  const yearField = resolveField(dataset, YEAR_NUM_COLUMNS, false);

  const rows: RawTimelineRow[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let unreadableDates = 0;
  let usableWeekday = false;

  for (const record of records) {
    const date = toDate(readCell(record, dateField));
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
    const weekday = Math.trunc(readNumber(record, weekdayField));
    if (weekday >= 1 && weekday <= 7) {
      usableWeekday = true;
    }
    rows.push({
      dateKey,
      date,
      value: readNumber(record, valueField),
      weekday,
      weekNum: Math.trunc(readNumber(record, weekField)),
      monthNum: Math.trunc(readNumber(record, monthField)),
      yearNum: Math.trunc(readNumber(record, yearField)),
    });
  }

  if (unreadableDates === records.length) {
    warnings.add(
      `The timeline table delivered ${count(records.length, 'row')} but no Date the grid can read, so no timeline is taken from it. Bind colWorkstreamTimeline as it is, or leave the property unbound. ${describeDataset(dataset, DATE_COLUMNS)}`
    );
  } else if (unreadableDates > 0) {
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
            : isoWeek(row.date).week,
      monthNum: row.monthNum >= 1 && row.monthNum <= 12 ? row.monthNum : row.date.getMonth() + 1,
      yearNum: row.yearNum > 1900 ? row.yearNum : row.date.getFullYear(),
      isWorkingDay: working,
    });
  }

  days.sort((left, right) =>
    left.dateKey < right.dateKey ? -1 : left.dateKey > right.dateKey ? 1 : 0
  );
  return { days, rows: records.length };
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
