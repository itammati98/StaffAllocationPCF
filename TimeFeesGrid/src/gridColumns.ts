/**
 * Column layout for the grid: fixed widths per density, plus the sticky offsets that keep the
 * person and rate columns on the left edge and the row totals on the right edge.
 *
 * The timeline (days, weeks or months) is the only thing that scrolls: the person, RPH, STD and
 * REAL% columns stay pinned to the left so the rate a cell is booked against is always in view,
 * and the totals stay pinned to the right.
 */
import { PeriodColumn } from './types';

export type Density = 'comfortable' | 'compact' | 'narrow';

export type CellKind = 'identity' | 'rph' | 'std' | 'real' | 'fill' | 'period' | 'spacer' | 'totalHours' | 'fee' | 'gm';

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
  align: 'start' | 'center' | 'end';
  /** Period columns only. */
  period?: PeriodColumn;
  /** Distance from the left edge of the row; set only for sticky-left columns. */
  stickyLeft?: number;
  /** Distance from the right edge of the row; set only for sticky-right columns. */
  stickyRight?: number;
  /** The last pinned-left or the first pinned-right column: the edge of the scrolling timeline. */
  stickyEdge?: boolean;
}

interface DensitySpec {
  rowHeight: number;
  headerHeight: number;
  footerHeight: number;
  /** Fixed widths; the flexible spacer column is always 0 and not listed. */
  widths: Record<Exclude<CellKind, 'spacer'>, number>;
  /** Leading run of columns pinned to the left edge, in order; the timeline scrolls after them. */
  stickyLeft: readonly CellKind[];
  /** Trailing run of columns pinned to the right edge; empty for the narrow density. */
  stickyRight: readonly CellKind[];
}

export const DENSITY: Record<Density, DensitySpec> = {
  comfortable: {
    rowHeight: 40,
    headerHeight: 34,
    footerHeight: 30,
    widths: { identity: 264, rph: 76, std: 76, real: 76, fill: 40, period: 72, totalHours: 84, fee: 84, gm: 76 },
    stickyLeft: ['identity', 'rph', 'std', 'real', 'fill'],
    stickyRight: ['totalHours', 'fee', 'gm'],
  },
  compact: {
    rowHeight: 36,
    headerHeight: 32,
    footerHeight: 30,
    widths: { identity: 216, rph: 64, std: 64, real: 64, fill: 36, period: 60, totalHours: 72, fee: 72, gm: 72 },
    stickyLeft: ['identity', 'rph', 'std', 'real', 'fill'],
    stickyRight: ['totalHours', 'fee'],
  },
  narrow: {
    rowHeight: 34,
    headerHeight: 30,
    footerHeight: 30,
    widths: { identity: 148, rph: 56, std: 56, real: 56, fill: 32, period: 56, totalHours: 64, fee: 64, gm: 64 },
    stickyLeft: ['identity', 'rph', 'fill'],
    stickyRight: [],
  },
};

export function densityForWidth(width: number): Density {
  if (width >= 1024) return 'comfortable';
  if (width >= 720) return 'compact';
  return 'narrow';
}

/**
 * Builds the visible column list for one density. `fill: false` leaves out the Fill column.
 * A period that holds no working day at all (weekend days arriving from a bound timeline) is
 * dropped: it can never hold hours. A single flexible column sits between the timeline and the
 * totals, so the row totals stay at the right edge of the grid however few periods there are.
 */
export function buildColumnLayout(
  periods: readonly PeriodColumn[],
  density: Density,
  options: { fill?: boolean } = {},
): ColumnLayout[] {
  const spec = DENSITY[density];
  const columns: ColumnLayout[] = [];

  const addFixed = (kind: Exclude<CellKind, 'period' | 'spacer'>): void => {
    columns.push({
      kind,
      width: spec.widths[kind],
      label: FIXED_COLUMNS[kind].label,
      subLabel: '',
      title: FIXED_COLUMNS[kind].title,
      align: kind === 'identity' ? 'start' : kind === 'fill' ? 'center' : 'end',
    });
  };

  addFixed('identity');
  addFixed('rph');
  if (density !== 'narrow') {
    addFixed('std');
    addFixed('real');
  }
  // The Fill arrows sit between the rates and the timeline they populate; a read-only grid has none.
  if (options.fill !== false) addFixed('fill');

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
  for (const column of columns) {
    if (!spec.stickyLeft.includes(column.kind)) break;
    column.stickyLeft = left;
    left += column.width;
  }

  let right = 0;
  for (let index = columns.length - 1; index >= 0; index -= 1) {
    const column = columns[index];
    if (!spec.stickyRight.includes(column.kind)) break;
    column.stickyRight = right;
    right += column.width;
  }

  // The two columns that face the scrolling timeline carry the heavier border.
  columns.forEach((column, index) => {
    const next = columns[index + 1];
    const previous = columns[index - 1];
    const endsLeftRun = column.stickyLeft !== undefined && next?.stickyLeft === undefined;
    const startsRightRun = column.stickyRight !== undefined && previous?.stickyRight === undefined;
    if (endsLeftRun || startsRightRun) column.stickyEdge = true;
  });

  return columns;
}

/**
 * Whether a column's cells can be focused, selected and copied. The gap between timeline and totals
 * and the Fill column are not cells, and the Hours, Fee and GM% columns are display-only.
 */
export function isSelectableColumn(kind: CellKind): boolean {
  return kind !== 'spacer' && kind !== 'fill' && kind !== 'totalHours' && kind !== 'fee' && kind !== 'gm';
}

/**
 * Where Ctrl+Left / Ctrl+Right lands, as a position in `kinds` (the selectable columns in order).
 * The first stop is the edge of the timeline, so one press reaches the first or last period from
 * anywhere inside it; pressing again from that edge goes on to the end of the row.
 */
export function jumpPosition(kinds: readonly CellKind[], position: number, direction: 1 | -1): number {
  const first = kinds.indexOf('period');
  const last = kinds.lastIndexOf('period');
  if (direction > 0) return first >= 0 && position < last ? last : kinds.length - 1;
  return first >= 0 && position > first ? first : 0;
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
  fill: { label: 'Fill', title: 'Fill the row: copy the first period that has hours into every following period' },
  totalHours: { label: 'Hours', title: 'Hours booked in this workstream window' },
  fee: { label: 'Fee (k)', title: 'Time fees in thousands: booked hours times RPH' },
  gm: { label: 'GM%', title: 'Gross margin on cost: (time fees - cost) / cost' },
};
