/**
 * Column layout for the grid: fixed widths per density, plus the sticky offsets that keep the
 * person column and the row totals in view while the timeline scrolls horizontally.
 *
 * Only the person column is pinned to the left edge. Pinning the rate columns as well would eat
 * most of a laptop-width viewport; they are the first columns to scroll out instead.
 */
import { PeriodColumn } from './types';

export type Density = 'comfortable' | 'compact' | 'narrow';

export type CellKind = 'identity' | 'rph' | 'std' | 'real' | 'period' | 'spacer' | 'totalHours' | 'fee' | 'gm';

export interface ColumnLayout {
  kind: CellKind;
  /** Fixed width in pixels; 0 for a flexible column. */
  width: number;
  /** True for the single column that absorbs the container's spare width. */
  flexible?: boolean;
  /** Header text; period columns carry their own label. */
  label: string;
  subLabel: string;
  /** Tooltip and accessible description. */
  title: string;
  align: 'start' | 'end';
  /** Period columns only. */
  period?: PeriodColumn;
  /** Distance from the left edge of the row; set only for sticky-left columns. */
  stickyLeft?: number;
  /** Distance from the right edge of the row; set only for sticky-right columns. */
  stickyRight?: number;
}

interface DensitySpec {
  rowHeight: number;
  headerHeight: number;
  footerHeight: number;
  /** Fixed widths; the flexible spacer column is always 0 and not listed. */
  widths: Record<Exclude<CellKind, 'spacer'>, number>;
  /** Trailing run of columns pinned to the right edge; empty for the narrow density. */
  stickyRight: readonly CellKind[];
}

export const DENSITY: Record<Density, DensitySpec> = {
  comfortable: {
    rowHeight: 40,
    headerHeight: 34,
    footerHeight: 34,
    widths: { identity: 264, rph: 76, std: 76, real: 76, period: 72, totalHours: 84, fee: 84, gm: 76 },
    stickyRight: ['totalHours', 'fee', 'gm'],
  },
  compact: {
    rowHeight: 36,
    headerHeight: 32,
    footerHeight: 32,
    widths: { identity: 216, rph: 64, std: 64, real: 64, period: 60, totalHours: 72, fee: 72, gm: 72 },
    stickyRight: ['totalHours', 'fee'],
  },
  narrow: {
    rowHeight: 34,
    headerHeight: 30,
    footerHeight: 30,
    widths: { identity: 148, rph: 56, std: 56, real: 56, period: 56, totalHours: 64, fee: 64, gm: 64 },
    stickyRight: [],
  },
};

export function densityForWidth(width: number): Density {
  if (width >= 1024) return 'comfortable';
  if (width >= 720) return 'compact';
  return 'narrow';
}

/**
 * Builds the visible column list for one density.
 * A period that holds no working day at all (weekend days arriving from a bound timeline) is
 * dropped: it can never hold hours. A single flexible column sits between the timeline and the
 * totals, so the row totals stay at the right edge of the grid however few periods there are.
 */
export function buildColumnLayout(periods: readonly PeriodColumn[], density: Density): ColumnLayout[] {
  const spec = DENSITY[density];
  const columns: ColumnLayout[] = [];

  const addFixed = (kind: Exclude<CellKind, 'period' | 'spacer'>): void => {
    columns.push({
      kind,
      width: spec.widths[kind],
      label: FIXED_COLUMNS[kind].label,
      subLabel: '',
      title: FIXED_COLUMNS[kind].title,
      align: kind === 'identity' ? 'start' : 'end',
    });
  };

  addFixed('identity');
  addFixed('rph');
  if (density !== 'narrow') {
    addFixed('std');
    addFixed('real');
  }

  periods.forEach((period) => {
    // A period that holds no working day (weekends arriving from a bound timeline) can never take hours.
    if (period.workingDays.length === 0) return;
    columns.push({
      kind: 'period',
      width: spec.widths.period,
      label: period.label,
      subLabel: period.subLabel,
      title: period.title,
      align: 'end',
      period,
    });
  });

  columns.push({ kind: 'spacer', width: 0, flexible: true, label: '', subLabel: '', title: '', align: 'start' });

  addFixed('totalHours');
  addFixed('fee');
  if (density === 'comfortable') addFixed('gm');

  let left = 0;
  columns.forEach((column) => {
    if (column.kind === 'identity') column.stickyLeft = left;
    left += column.width;
  });

  let right = 0;
  for (let index = columns.length - 1; index >= 0; index -= 1) {
    const column = columns[index];
    if (!spec.stickyRight.includes(column.kind)) break;
    column.stickyRight = right;
    right += column.width;
  }

  return columns;
}

/** Sum of the widths of every sticky-left column; the visible area starts after it. */
export function stickyLeftWidth(layout: readonly ColumnLayout[]): number {
  return layout.reduce((total, column) => total + (column.stickyLeft !== undefined ? column.width : 0), 0);
}

/** Sum of the widths of every sticky-right column; the visible area ends before it. */
export function stickyRightWidth(layout: readonly ColumnLayout[]): number {
  return layout.reduce((total, column) => total + (column.stickyRight !== undefined ? column.width : 0), 0);
}

const FIXED_COLUMNS: Record<Exclude<CellKind, 'period' | 'spacer'>, { label: string; title: string }> = {
  identity: { label: 'Person', title: 'Person, job level and team' },
  rph: { label: 'RPH', title: 'Rate per hour charged for this person, used for the time fees' },
  std: { label: 'STD', title: 'Standard rate (fee rate) for this person' },
  real: { label: 'REAL%', title: 'Realisation: RPH as a percentage of the standard rate' },
  totalHours: { label: 'Hours', title: 'Hours booked in this workstream window' },
  fee: { label: 'Fee (k)', title: 'Time fees in thousands: booked hours times RPH' },
  gm: { label: 'GM%', title: 'Gross margin on cost: (time fees - cost) / cost' },
};
