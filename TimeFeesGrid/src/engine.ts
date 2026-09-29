/**
 * Pure allocation / calculation engine for the Time & Fees grid.
 *
 * No React, no DOM, no host APIs. Every function that receives an `AllocationStore`
 * treats it as immutable and returns a new map when something changes.
 */

import type {
  AllocationEntry,
  AllocationOutput,
  AllocationStore,
  GridModel,
  GridRow,
  GridTotals,
  PeriodColumn,
  PersonOutput,
  PersonRow,
  Phasing,
  TimelineDay,
} from './types';

/** Monday–Friday, ISO weekday numbers. Generated timelines never contain weekends. */
export const WORKING_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

/** Number of fraction digits kept by `round6`. */
export const MAX_FRACTION_DIGITS = 6;

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const FULL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** Timeline guard: never emit more than this many days for a bad `weeks` value. */
const MAX_TIMELINE_DAYS = 2600;

/** Rounds a finite number to six fraction digits; non-finite values pass through. */
export function round6(value: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** MAX_FRACTION_DIGITS;
  return Math.round(value * factor) / factor;
}

/** Local `YYYY-MM-DD`. Never uses UTC getters, so no time-zone day drift. */
export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function weekdayOf(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

/** True for Monday–Friday. */
export function isWorkingDay(date: Date): boolean {
  return WORKING_WEEKDAYS.includes(weekdayOf(date));
}

/**
 * Coerces a `Date`, an ISO date / date-time string or epoch millis to a `Date`.
 * Strings that begin `YYYY-MM-DD` are read as local date-only values, so an ISO
 * timestamp never shifts the calendar day. Anything else yields `null`.
 */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (match) {
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** Finite number for numbers / numeric strings; 0 for everything else. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Monday 00:00 local of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - (weekdayOf(result) - 1));
  return result;
}

/** Date-only copy of `date` shifted by `days` calendar days, at local midnight. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * Builds the workstream timeline from `start`: `weeks * 5` working days appended
 * day by day, weekends skipped. `weekNum` blocks are five working days counted
 * from the start, matching the canvas app's `RoundUp(Value/5)` phasing.
 */
export function buildTimeline(start: Date, weeks: number): TimelineDay[] {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return [];
  if (!Number.isFinite(weeks) || weeks < 1) return [];

  const target = Math.floor(weeks) * 5;
  const days: TimelineDay[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let value = 0;

  while (value < target && days.length < MAX_TIMELINE_DAYS) {
    if (isWorkingDay(cursor)) {
      value += 1;
      days.push({
        dateKey: toDateKey(cursor),
        date: new Date(cursor.getTime()),
        value,
        weekday: weekdayOf(cursor),
        weekNum: Math.ceil(value / 5),
        monthNum: cursor.getMonth() + 1,
        yearNum: cursor.getFullYear(),
        isWorkingDay: true,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function dayMonth(day: TimelineDay): string {
  return `${pad2(day.date.getDate())} ${SHORT_MONTHS[day.date.getMonth()]}`;
}

function bucketKey(day: TimelineDay, phasing: Phasing): string {
  switch (phasing) {
    case 'daily':
      return `d:${day.dateKey}`;
    case 'weekly':
      return `w:${day.yearNum}-${day.weekNum}`;
    case 'monthly':
      return `m:${day.yearNum}-${day.monthNum}`;
  }
}

function buildColumn(id: string, phasing: Phasing, days: TimelineDay[], hoursPerDay: number): PeriodColumn {
  const workingDays = days.filter((day) => day.isWorkingDay);
  const first = days[0];
  const firstWorking = workingDays[0] ?? first;
  const lastWorking = workingDays[workingDays.length - 1] ?? days[days.length - 1];

  let label = '';
  let subLabel = '';
  let title = '';

  if (phasing === 'daily') {
    subLabel = dayMonth(first);
    label = first.value > 0 ? `Day ${first.value}` : subLabel;
    title = `${WEEKDAY_NAMES[first.weekday - 1]} ${dayMonth(first)} ${first.yearNum}, week ${first.weekNum}`;
  } else if (phasing === 'weekly') {
    label = first.weekNum > 0 ? `W${first.weekNum}` : 'Week ?';
    subLabel = dayMonth(firstWorking);
    title = `Week ${first.weekNum}, ${dayMonth(firstWorking)} - ${dayMonth(lastWorking)} ${lastWorking.yearNum}`;
  } else {
    label = `${SHORT_MONTHS[first.monthNum - 1]} ${String(first.yearNum).slice(2)}`;
    subLabel = `${workingDays.length} days`;
    title = `${FULL_MONTHS[first.monthNum - 1]} ${first.yearNum}, ${workingDays.length} working days`;
  }

  return {
    id,
    phasing,
    label,
    subLabel,
    title,
    days,
    workingDays,
    dateKeys: workingDays.map((day) => day.dateKey),
    capacity: workingDays.length * hoursPerDay,
    weekNum: first.weekNum,
    monthNum: first.monthNum,
    yearNum: first.yearNum,
  };
}

/**
 * Groups timeline days into editable columns. Potentially-unsorted input is
 * sorted defensively by `dateKey`; empty input yields no columns.
 */
export function buildColumns(
  timeline: readonly TimelineDay[],
  phasing: Phasing,
  hoursPerDay: number,
): PeriodColumn[] {
  if (!timeline || timeline.length === 0) return [];

  const sorted = [...timeline].sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));

  const buckets = new Map<string, TimelineDay[]>();
  for (const day of sorted) {
    const key = bucketKey(day, phasing);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(day);
    else buckets.set(key, [day]);
  }

  const columns: PeriodColumn[] = [];
  for (const [id, days] of buckets) {
    columns.push(buildColumn(id, phasing, days, hoursPerDay));
  }
  return columns;
}

/**
 * Spreads `hours` across `workingDayCount` days.
 *
 * - `workingDayCount <= 0` -> `[]`
 * - non-positive / non-finite hours -> all zeros
 * - at or below capacity -> front-loaded in `hoursPerDay` chunks: `(20,5,8) -> [8,8,4,0,0]`
 * - above capacity -> as even as possible, with the spare whole hours on the trailing
 *   days and the fractional leftover on the last day: `(41,5,8) -> [8,8,8,8,9]`
 */
export function distributeHours(hours: number, workingDayCount: number, hoursPerDay: number): number[] {
  if (workingDayCount <= 0) return [];
  const count = workingDayCount;
  if (!Number.isFinite(hours) || hours <= 0) return new Array<number>(count).fill(0);

  const perDay = Number.isFinite(hoursPerDay) && hoursPerDay > 0 ? hoursPerDay : 0;
  const capacity = count * perDay;

  if (perDay > 0 && hours <= capacity) {
    const result = new Array<number>(count).fill(0);
    let remaining = hours;
    let lastFilled = -1;
    for (let i = 0; i < count && remaining > 1e-9; i += 1) {
      const take = Math.min(perDay, remaining);
      result[i] = round6(take);
      remaining -= take;
      lastFilled = i;
    }
    if (lastFilled >= 0) {
      const sum = result.reduce((total, value) => total + value, 0);
      result[lastFilled] = round6(result[lastFilled] + (hours - sum));
    }
    return result;
  }

  const base = Math.floor(hours / count);
  const extra = Math.min(count, Math.floor(hours - base * count));
  const result = new Array<number>(count);
  let sum = 0;
  for (let i = 0; i < count; i += 1) {
    const value = base + (i >= count - extra ? 1 : 0);
    result[i] = value;
    sum += value;
  }
  result[count - 1] = round6(result[count - 1] + (hours - sum));
  return result.map((value) => round6(value));
}

/** Store key for one person / one day. */
export function allocationKey(personKey: string, dateKey: string): string {
  return `${personKey}|${dateKey}`;
}

function personKeyOf(key: string): string {
  const index = key.lastIndexOf('|');
  return index < 0 ? key : key.slice(0, index);
}

function dateKeyOf(key: string): string {
  const index = key.lastIndexOf('|');
  return index < 0 ? '' : key.slice(index + 1);
}

/**
 * Builds an immutable store from host entries. Duplicate keys are summed;
 * non-finite or non-positive hours are dropped. Never returns an input reference.
 */
export function createStore(entries: readonly AllocationEntry[]): AllocationStore {
  const store = new Map<string, number>();
  if (!entries) return store;
  for (const entry of entries) {
    if (!entry) continue;
    const hours = toNumber(entry.hours);
    if (!Number.isFinite(hours) || hours <= 0) continue;
    const key = allocationKey(entry.personKey, entry.dateKey);
    store.set(key, round6((store.get(key) ?? 0) + hours));
  }
  return store;
}

/** Hours booked by one person on one day; 0 when absent. */
export function storeHours(store: AllocationStore, personKey: string, dateKey: string): number {
  return store.get(allocationKey(personKey, dateKey)) ?? 0;
}

function columnHours(store: AllocationStore, column: PeriodColumn, personKey: string): number {
  let total = 0;
  for (const dateKey of column.dateKeys) total += store.get(allocationKey(personKey, dateKey)) ?? 0;
  return total;
}

/**
 * Returns a new store where the person's hours in `column` are replaced by
 * `hours` spread over its working days. Entries for other days, people and
 * columns are untouched; re-entering a value never accumulates.
 */
export function setColumnHours(
  store: AllocationStore,
  column: PeriodColumn,
  personKey: string,
  hours: number,
  hoursPerDay: number,
): AllocationStore {
  const next = new Map<string, number>(store);
  for (const dateKey of column.dateKeys) next.delete(allocationKey(personKey, dateKey));

  const value = toNumber(hours);
  if (value > 0 && column.workingDays.length > 0) {
    const spread = distributeHours(value, column.workingDays.length, hoursPerDay);
    for (let i = 0; i < column.workingDays.length; i += 1) {
      const dayHours = spread[i];
      if (dayHours > 0) next.set(allocationKey(personKey, column.workingDays[i].dateKey), dayHours);
    }
  }
  return next;
}

/**
 * Copies the first non-empty column of the row into every following column,
 * using the same spreading rule. Rows with no hours are returned unchanged.
 */
export function fillRight(
  store: AllocationStore,
  columns: readonly PeriodColumn[],
  personKey: string,
  hoursPerDay: number,
): AllocationStore {
  let sourceIndex = -1;
  for (let i = 0; i < columns.length; i += 1) {
    if (columnHours(store, columns[i], personKey) > 0) {
      sourceIndex = i;
      break;
    }
  }
  if (sourceIndex < 0) return store;

  const sourceHours = columnHours(store, columns[sourceIndex], personKey);
  let result: AllocationStore = store;
  for (let i = sourceIndex + 1; i < columns.length; i += 1) {
    result = setColumnHours(result, columns[i], personKey, sourceHours, hoursPerDay);
  }
  return result;
}

/** Returns a new store with every entry of `personKey` removed. */
export function clearPerson(store: AllocationStore, personKey: string): AllocationStore {
  const next = new Map<string, number>();
  for (const [key, hours] of store) {
    if (personKeyOf(key) !== personKey) next.set(key, hours);
  }
  return next;
}

/** `rph / feeRate`, rounded; 0 when `feeRate` is not positive. */
export function realisationFromRph(rph: number, feeRate: number): number {
  return feeRate > 0 ? round6(rph / feeRate) : 0;
}

/** `feeRate * realisation`, rounded. */
export function rphFromRealisation(realisation: number, feeRate: number): number {
  return round6(feeRate * realisation);
}

/** Builds the rendered model: one row per person plus the totals row. */
export function computeModel(
  people: readonly PersonRow[],
  store: AllocationStore,
  columns: readonly PeriodColumn[],
): GridModel {
  const dateToColumn = new Map<string, string>();
  for (const column of columns) {
    for (const dateKey of column.dateKeys) dateToColumn.set(dateKey, column.id);
  }

  const byPerson = new Map<string, Map<string, number>>();
  for (const [key, hours] of store) {
    const personKey = personKeyOf(key);
    let entries = byPerson.get(personKey);
    if (!entries) {
      entries = new Map<string, number>();
      byPerson.set(personKey, entries);
    }
    const dateKey = dateKeyOf(key);
    entries.set(dateKey, (entries.get(dateKey) ?? 0) + hours);
  }

  const rows: GridRow[] = [];
  for (const person of people) {
    const hours: Record<string, number> = {};
    for (const column of columns) hours[column.id] = 0;

    let totalHours = 0;
    let outsideWindowHours = 0;
    const entries = byPerson.get(person.key);
    if (entries) {
      for (const [dateKey, dayHours] of entries) {
        const columnId = dateToColumn.get(dateKey);
        if (columnId !== undefined) {
          hours[columnId] = round6(hours[columnId] + dayHours);
          totalHours += dayHours;
        } else {
          outsideWindowHours += dayHours;
        }
      }
    }

    totalHours = round6(totalHours);
    const fee = round6(totalHours * person.rph);
    const cost = round6(totalHours * person.costRate);
    const gm = cost > 0 ? (fee - cost) / cost : 0;
    const realisation = realisationFromRph(person.rph, person.feeRate);

    rows.push({
      key: person.key,
      person,
      hours,
      totalHours,
      fee,
      cost,
      gm,
      realisation,
      outsideWindowHours: round6(outsideWindowHours),
    });
  }

  const totalsHours: Record<string, number> = {};
  for (const column of columns) totalsHours[column.id] = 0;

  let hoursTotal = 0;
  let feeTotal = 0;
  let costTotal = 0;
  let weightedRph = 0;
  let weightedStd = 0;
  let outsideWindowHours = 0;

  for (const row of rows) {
    for (const column of columns) {
      totalsHours[column.id] = round6(totalsHours[column.id] + (row.hours[column.id] ?? 0));
    }
    hoursTotal += row.totalHours;
    feeTotal += row.fee;
    costTotal += row.cost;
    weightedRph += row.totalHours * row.person.rph;
    weightedStd += row.totalHours * row.person.feeRate;
    outsideWindowHours += row.outsideWindowHours;
  }

  hoursTotal = round6(hoursTotal);
  const totals: GridTotals = {
    hours: totalsHours,
    hoursTotal,
    fee: round6(feeTotal),
    gm: costTotal > 0 ? (feeTotal - costTotal) / costTotal : 0,
    avgRph: hoursTotal > 0 ? round6(weightedRph / hoursTotal) : 0,
    avgStd: hoursTotal > 0 ? round6(weightedStd / hoursTotal) : 0,
    avgRealisation: 0,
  };
  totals.avgRealisation = totals.avgStd > 0 ? round6(totals.avgRph / totals.avgStd) : 0;

  return { rows, totals, outsideWindowHours: round6(outsideWindowHours) };
}

/**
 * Serialises the store back to the host collections. Out-of-window hours survive
 * with `Value`/`Weekday`/`WeekNum` = 0 and month/year derived from the date key.
 */
export function buildOutput(
  store: AllocationStore,
  people: readonly PersonRow[],
  timeline: readonly TimelineDay[],
): { allocations: AllocationOutput[]; people: PersonOutput[] } {
  const peopleOutput: PersonOutput[] = people.map((person) => ({
    Name: person.name,
    JobLevel: person.jobLevel,
    Team: person.team,
    CostRate: person.costRate,
    FeeRate: person.feeRate,
    RPH: person.rph,
    Realisation: round6(person.realisation),
    JobLevelOrder: person.jobLevelOrder,
    IsToBeAdded: person.isToBeAdded,
    CurrencyID: person.currencyId,
  }));

  const timelineByKey = new Map<string, TimelineDay>();
  for (const day of timeline) timelineByKey.set(day.dateKey, day);

  const personByKey = new Map<string, PersonRow>();
  const orderIndex = new Map<string, number>();
  people.forEach((person, index) => {
    personByKey.set(person.key, person);
    orderIndex.set(person.key, index);
  });

  const grouped = new Map<string, { dateKey: string; hours: number }[]>();
  for (const [key, hours] of store) {
    if (!(hours > 0)) continue;
    const personKey = personKeyOf(key);
    const bucket = grouped.get(personKey);
    const entry = { dateKey: dateKeyOf(key), hours };
    if (bucket) bucket.push(entry);
    else grouped.set(personKey, [entry]);
  }

  const personKeys = [...grouped.keys()].sort((a, b) => {
    const indexA = orderIndex.has(a) ? (orderIndex.get(a)!) : Number.POSITIVE_INFINITY;
    const indexB = orderIndex.has(b) ? (orderIndex.get(b)!) : Number.POSITIVE_INFINITY;
    if (indexA !== indexB) return indexA - indexB;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const allocations: AllocationOutput[] = [];
  for (const personKey of personKeys) {
    const person = personByKey.get(personKey);
    const name = person ? person.name : personKey;
    const entries = grouped.get(personKey) as { dateKey: string; hours: number }[];
    entries.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
    for (const entry of entries) {
      const day = timelineByKey.get(entry.dateKey);
      allocations.push(
        day
          ? {
              Name: name,
              Date: entry.dateKey,
              Value: day.value,
              Weekday: day.weekday,
              WeekNum: day.weekNum,
              MonthNum: day.monthNum,
              YearNum: day.yearNum,
              HoursWorked: round6(entry.hours),
            }
          : {
              Name: name,
              Date: entry.dateKey,
              Value: 0,
              Weekday: 0,
              WeekNum: 0,
              MonthNum: Number(entry.dateKey.slice(5, 7)),
              YearNum: Number(entry.dateKey.slice(0, 4)),
              HoursWorked: round6(entry.hours),
            },
      );
    }
  }

  return { allocations, people: peopleOutput };
}
