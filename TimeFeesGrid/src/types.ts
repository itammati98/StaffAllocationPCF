/**
 * Shared contracts for the Time & Fees allocation grid code component.
 *
 * Terminology
 * -----------
 * person row      one allocation candidate: a person with cost/fee rates (colPeopleAllocated)
 * timeline day    one calendar day of the workstream window (colWorkstreamTimeline)
 * allocation      hours booked by one person on one day (colAllocatedHours)
 * period column   one editable column of the grid: a day, a week or a month
 *
 * Allocation identity is `${personKey}|${dateKey}`. `personKey` is the record id when the host
 * supplies one, otherwise the person name; rows added inside the component get a generated key.
 * Allocations coming from the host are resolved from the `Name` column to a person key.
 */

import type { GridColors } from './colors';

/** How the workstream timeline is bucketed into editable columns. */
export type Phasing = 'daily' | 'weekly' | 'monthly';

/** Which of the two rates the user edits directly; the other one is derived. */
export type PricingMethod = 'manualRate' | 'realisationAdjustment';

/**
 * Actions reported to the host so it knows why the data changed. The two request actions are
 * raised because the component defers adding and removing people to the app. Nothing is published
 * when the host merely re-delivers the datasets, so navigating to a screen never fires OnChange.
 */
export type GridAction =
  | 'hoursChanged'
  | 'hoursCleared'
  | 'ratesChanged'
  | 'hoursFilled'
  | 'addStaffRequested'
  | 'removePersonRequested';

/** One person row, normalised from the host dataset. */
export interface PersonRow {
  /** Stable identity inside the component: host record id, else name, else a generated key. */
  key: string;
  name: string;
  jobLevel: string;
  team: string;
  costRate: number;
  feeRate: number;
  /** Rate per hour the workstream is sold at (the editable rate). */
  rph: number;
  /** RPH / FeeRate, carried through from the host and recomputed whenever rates change. */
  realisation: number;
  jobLevelOrder: number;
  isToBeAdded: boolean;
  currencyId: string;
}

/** One calendar day of the workstream window. */
export interface TimelineDay {
  /** Local date only, `YYYY-MM-DD`. Never carries a time zone offset. */
  dateKey: string;
  date: Date;
  /** Working-day ordinal supplied by the host (1-based); 0 when the host does not supply one. */
  value: number;
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  weekNum: number;
  /** 1-12. */
  monthNum: number;
  yearNum: number;
  /** False for weekend days and for any day the host timeline marks as non-working. */
  isWorkingDay: boolean;
}

/** One allocation resolved from the host dataset to a person key. */
export interface AllocationEntry {
  personKey: string;
  dateKey: string;
  hours: number;
}

/** Immutable allocation store: `${personKey}|${dateKey}` -> hours. */
export type AllocationStore = ReadonlyMap<string, number>;

/** One editable column of the grid. */
export interface PeriodColumn {
  /** `d:2026-01-05` | `w:2026-3` | `m:2026-1`. */
  id: string;
  phasing: Phasing;
  /** `W3` | `Day 12` | `Jan 26`. */
  label: string;
  /** Secondary label: `05 Jan` for days and weeks, empty for months. */
  subLabel: string;
  /** Full description for tooltips and screen readers. */
  title: string;
  days: TimelineDay[];
  workingDays: TimelineDay[];
  /** Keys of `workingDays`, in order. */
  dateKeys: string[];
  /** `workingDays.length * hoursPerDay`; hours above this are over capacity. */
  capacity: number;
  weekNum: number;
  monthNum: number;
  yearNum: number;
}

/** One rendered grid row with its derived figures. */
export interface GridRow {
  key: string;
  person: PersonRow;
  /** column id -> hours booked in that period. */
  hours: Record<string, number>;
  totalHours: number;
  /** totalHours * rph. */
  fee: number;
  /** totalHours * costRate. */
  cost: number;
  /** (fee - cost) / cost, i.e. margin on cost. 0 when cost is 0. */
  gm: number;
  /** rph / feeRate. 0 when feeRate is 0. */
  realisation: number;
  /** Hours this person has outside the workstream window; still reported back to the host. */
  outsideWindowHours: number;
}

/** Aggregated figures for the totals row. */
export interface GridTotals {
  /** column id -> hours booked by everyone in that period. */
  hours: Record<string, number>;
  hoursTotal: number;
  fee: number;
  gm: number;
  /** Hours-weighted average of the editable rate. */
  avgRph: number;
  /** Hours-weighted average of the standard rate. */
  avgStd: number;
  /**
   * Blended realisation across everyone: `avgRph / avgStd`, i.e. the total hourly rate
   * over the total standard rate, both hours-weighted. This is not the mean of the
   * per-person realisations. 0 when `avgStd` is 0.
   */
  avgRealisation: number;
}

/** Everything the grid renders. */
export interface GridModel {
  rows: GridRow[];
  totals: GridTotals;
  /** Hours booked by everyone outside the workstream window. */
  outsideWindowHours: number;
}

/** Scalar properties read from the host. */
export interface GridHostInputs {
  workstreamStart: Date | null;
  numberOfWeeks: number;
  hoursPerDay: number;
  pricingMethod: PricingMethod;
  phasing: Phasing;
  readOnly: boolean;
  /** False hides the dataset warnings the grid would otherwise show above the timeline. */
  showNotifications: boolean;
  /** Studio-configured palette, applied to the grid root as CSS custom properties. */
  colors: GridColors;
}

/** One immutable snapshot of the host datasets. */
export interface GridSnapshot {
  people: PersonRow[];
  timeline: TimelineDay[];
  allocations: AllocationEntry[];
  /** False when the timeline was generated from `workstreamStart` / `numberOfWeeks`. */
  timelineFromHost: boolean;
  /** Human readable messages about ignored or missing input, surfaced in the UI. */
  warnings: string[];
  loading: boolean;
  error: string | null;
}

/** One allocation row written back to the host (colAllocatedHours schema). */
export interface AllocationOutput {
  Name: string;
  /** `YYYY-MM-DD`. */
  Date: string;
  /** 0 when the allocation falls outside the workstream window. */
  Value: number;
  /** 0 when the allocation falls outside the workstream window. */
  Weekday: number;
  /** 0 when the allocation falls outside the workstream window. */
  WeekNum: number;
  MonthNum: number;
  YearNum: number;
  HoursWorked: number;
}

/** One person row written back to the host (colPeopleAllocated schema). */
export interface PersonOutput {
  Name: string;
  JobLevel: string;
  Team: string;
  CostRate: number;
  FeeRate: number;
  RPH: number;
  Realisation: number;
  JobLevelOrder: number;
  IsToBeAdded: boolean;
  CurrencyID: string;
}

/** Payload pushed to the host whenever the component holds changed data. */
export interface GridOutput {
  /** Increments on every change so the host can tell new payloads apart. */
  revision: number;
  action: GridAction;
  /** Person the change applied to; empty for whole-grid actions. */
  personName: string;
  allocations: AllocationOutput[];
  people: PersonOutput[];
}

/** Props of the grid React app, shared by the component entry point and the dev harness. */
export interface TimeFeesGridAppProps {
  host: GridHostInputs;
  snapshot: GridSnapshot;
  /** Increments whenever the host pushes a new snapshot; rebases the editor state. */
  snapshotVersion: number;
  /** Called after every change with the payload the host should read back, requests included. */
  onChange: (output: GridOutput) => void;
}
