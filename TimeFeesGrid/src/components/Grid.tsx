import * as React from 'react';
import { ColumnLayout, DENSITY, Density, stickyLeftWidth, stickyRightWidth } from '../gridColumns';
import { avatarTone, formatEditableNumber, formatHours, formatPercent, formatRate, formatThousands, initials, parseEditableNumber } from '../format';
import { GridModel, GridRow, PeriodColumn, PricingMethod } from '../types';

export interface CellRef {
  row: number;
  col: number;
}

export interface GridNotice {
  text: string;
  tone: 'info' | 'warning';
}

interface GridProps {
  layout: ColumnLayout[];
  model: GridModel;
  density: Density;
  readOnly: boolean;
  pricingMethod: PricingMethod;
  onSetHours: (rowKey: string, column: PeriodColumn, hours: number) => void;
  onSetRate: (rowKey: string, field: 'rph' | 'realisation', value: number) => void;
  onFillRight: (rowKey: string) => void;
  /** Asks the host application to remove the person; the component does not remove rows itself. */
  onRequestRemove: (personName: string) => void;
  onNotice: (notice: GridNotice) => void;
}

/** `tabLeft`/`tabRight` wrap across rows the way Tab does; the arrow keys stay on their row. */
type Move = 'up' | 'down' | 'left' | 'right' | 'tabLeft' | 'tabRight' | 'none';

const GRID_LABEL = 'Time and fees allocation grid';

/**
 * The editable grid.
 *
 * Interaction model: the table itself is the single tab stop and keeps focus at all times; the
 * focused cell is tracked in React state and exposed to assistive technology through
 * `aria-activedescendant`. Arrow keys move the focused cell - and while a cell is being edited they
 * apply the value and move on, the way Excel behaves - Enter/Tab commit, Escape cancels. Because
 * focus never moves to another element, the browser never scrolls the page or fights the user's
 * own scrolling. Only numbers are editable: people, job levels, teams, standard rates and totals
 * are the app's data, not the grid's.
 */
export function Grid(props: GridProps): React.ReactElement {
  const { layout, model, density, readOnly, pricingMethod, onSetHours, onSetRate, onFillRight, onRequestRemove, onNotice } = props;

  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const tableRef = React.useRef<HTMLTableElement>(null);
  const editorRef = React.useRef<HTMLInputElement>(null);
  const idPrefix = React.useRef(`tfg-${Math.random().toString(36).slice(2, 9)}`);
  const caretAtEnd = React.useRef(false);
  const hadFocus = React.useRef(false);
  /** True once the open edit has been committed or cancelled, so a late blur cannot commit twice. */
  const editClosed = React.useRef(true);

  const [active, setActive] = React.useState<CellRef>({ row: 0, col: 0 });
  const [editing, setEditing] = React.useState<{ text: string } | null>(null);

  const spec = DENSITY[density];
  const rows = model.rows;

  /** Layout indexes that the keyboard can reach; the flexible gap between timeline and totals is skipped. */
  const navigable = React.useMemo(
    () => layout.map((column, index) => ({ column, index })).filter((entry) => entry.column.kind !== 'spacer').map((entry) => entry.index),
    [layout],
  );
  const navPosition = navigable.indexOf(active.col);
  const activeCell: CellRef = {
    row: Math.min(active.row, Math.max(0, rows.length - 1)),
    col: navPosition >= 0 ? active.col : navigable[0],
  };
  const activeRow = rows[activeCell.row];
  const activeColumn = layout[activeCell.col];

  const cellId = (row: number, col: number): string => `${idPrefix.current}-c${row}-${col}`;

  /** Only numeric cells the user may type into: period hours and the rate the pricing mode owns. */
  const isNumberCell = (row: GridRow | undefined, column: ColumnLayout | undefined): boolean => {
    if (readOnly || !row || !column) return false;
    switch (column.kind) {
      case 'period':
        return !!column.period && column.period.workingDays.length > 0;
      case 'rph':
        return pricingMethod === 'manualRate';
      case 'real':
        return pricingMethod === 'realisationAdjustment';
      default:
        return false;
    }
  };

  const cellNumberText = (row: GridRow, column: ColumnLayout): string => {
    switch (column.kind) {
      case 'period':
        return column.period ? formatEditableNumber(row.hours[column.period.id] || 0) : '';
      case 'rph':
        return formatEditableNumber(row.person.rph);
      case 'real':
        return formatEditableNumber(row.realisation * 100);
      default:
        return '';
    }
  };

  const startEditing = (seed?: string): void => {
    const row = rows[activeCell.row];
    const column = layout[activeCell.col];
    if (!isNumberCell(row, column) || !row) return;
    // Typing straight into a cell keeps the caret after the typed character; Enter or F2 selects
    // the whole value so the first keystroke replaces it.
    caretAtEnd.current = seed !== undefined;
    editClosed.current = false;
    setEditing({ text: seed ?? cellNumberText(row, column) });
  };

  /** Next reachable column in the given direction, staying inside the row. */
  const neighbourColumn = (delta: 1 | -1): number => {
    const position = navPosition < 0 ? 0 : navPosition;
    return navigable[Math.min(navigable.length - 1, Math.max(0, position + delta))];
  };

  const stepCursor = (rowDelta: number, colDelta: number): void => {
    setActive({
      row: Math.min(rows.length - 1, Math.max(0, activeCell.row + rowDelta)),
      col: colDelta === 0 ? activeCell.col : neighbourColumn(colDelta > 0 ? 1 : -1),
    });
  };

  /** Tab order inside the grid: right, and from the last column on to the first cell of the next row. */
  const tabStep = (direction: 1 | -1): void => {
    const total = rows.length * navigable.length;
    if (total <= 0) return;
    const position = navPosition < 0 ? 0 : navPosition;
    const flat = activeCell.row * navigable.length + position + direction;
    const wrapped = ((flat % total) + total) % total;
    setActive({ row: Math.floor(wrapped / navigable.length), col: navigable[wrapped % navigable.length] });
  };

  const applyMove = (move: Move): void => {
    switch (move) {
      case 'up':
        stepCursor(-1, 0);
        break;
      case 'down':
        stepCursor(1, 0);
        break;
      case 'left':
        stepCursor(0, -1);
        break;
      case 'right':
        stepCursor(0, 1);
        break;
      default:
        break;
    }
  };

  const commitEdit = (move: Move): void => {
    if (!editing) {
      if (move === 'tabLeft') tabStep(-1);
      else if (move === 'tabRight') tabStep(1);
      else applyMove(move);
      return;
    }
    // Clicking another cell commits from the pointer handler and then blurs the editor; the second
    // call must not publish the same change again.
    if (editClosed.current) return;
    editClosed.current = true;

    const row = rows[activeCell.row];
    const column = layout[activeCell.col];
    const text = editing.text;
    setEditing(null);

    if (row && column) {
      const parsed = parseEditableNumber(text);
      if (parsed === null) {
        onNotice({ text: `"${text.trim()}" is not a number between 0 and 100000`, tone: 'warning' });
      } else if (column.kind === 'period' && column.period) {
        if (Math.abs((row.hours[column.period.id] || 0) - parsed) > 1e-9) onSetHours(row.key, column.period, parsed);
      } else if (column.kind === 'rph') {
        if (Math.abs(row.person.rph - parsed) > 1e-9) onSetRate(row.key, 'rph', parsed);
      } else if (column.kind === 'real') {
        const fraction = parsed / 100;
        if (Math.abs(row.realisation - fraction) > 1e-9) onSetRate(row.key, 'realisation', fraction);
      }
    }

    if (move === 'tabRight') tabStep(1);
    else if (move === 'tabLeft') tabStep(-1);
    else applyMove(move);
  };

  const clearActiveCell = (): void => {
    const row = rows[activeCell.row];
    const column = layout[activeCell.col];
    if (!row || !column || !isNumberCell(row, column)) return;
    if (column.kind === 'period' && column.period) {
      if ((row.hours[column.period.id] || 0) !== 0) onSetHours(row.key, column.period, 0);
    } else if (column.kind === 'rph') {
      if (row.person.rph !== 0) onSetRate(row.key, 'rph', 0);
    } else if (column.kind === 'real') {
      if (row.realisation !== 0) onSetRate(row.key, 'realisation', 0);
    }
  };

  /** Rows visible in the viewport, used by PageUp / PageDown. */
  const pageRows = (): number => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return 10;
    const usable = wrapper.clientHeight - spec.headerHeight - spec.footerHeight;
    return Math.max(1, Math.floor(usable / spec.rowHeight) - 1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTableElement>): void => {
    const key = event.key;

    if (event.ctrlKey || event.metaKey) {
      if (key === 'Home') {
        event.preventDefault();
        setActive({ row: 0, col: navigable[0] });
      } else if (key === 'End') {
        event.preventDefault();
        setActive({ row: rows.length - 1, col: navigable[navigable.length - 1] });
      }
      return;
    }

    if (editing) {
      if (key === 'Escape') {
        event.preventDefault();
        editClosed.current = true;
        setEditing(null);
        return;
      }
      if (key === 'Enter') {
        event.preventDefault();
        commitEdit(event.shiftKey ? 'up' : 'down');
        return;
      }
      if (key === 'Tab') {
        event.preventDefault();
        commitEdit(event.shiftKey ? 'tabLeft' : 'tabRight');
        return;
      }
      // Excel behaviour: an arrow key applies the value and moves on, no Enter needed.
      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault();
        commitEdit(key === 'ArrowUp' ? 'up' : key === 'ArrowDown' ? 'down' : key === 'ArrowLeft' ? 'left' : 'right');
        return;
      }
      // A fast typist can deliver the next character before the editor has focus; take it here so
      // no keystroke is lost.
      if (event.target !== editorRef.current && key.length === 1 && !event.altKey) {
        event.preventDefault();
        setEditing({ text: `${editing.text}${key}` });
      }
      return;
    }

    switch (key) {
      case 'ArrowUp':
        event.preventDefault();
        applyMove('up');
        return;
      case 'ArrowDown':
        event.preventDefault();
        applyMove('down');
        return;
      case 'ArrowLeft':
        event.preventDefault();
        applyMove('left');
        return;
      case 'ArrowRight':
        event.preventDefault();
        applyMove('right');
        return;
      case 'Home':
        event.preventDefault();
        setActive({ row: activeCell.row, col: navigable[0] });
        return;
      case 'End':
        event.preventDefault();
        setActive({ row: activeCell.row, col: navigable[navigable.length - 1] });
        return;
      case 'PageUp':
        event.preventDefault();
        stepCursor(-pageRows(), 0);
        return;
      case 'PageDown':
        event.preventDefault();
        stepCursor(pageRows(), 0);
        return;
      case 'Enter':
        event.preventDefault();
        if (isNumberCell(activeRow, activeColumn)) startEditing();
        else applyMove('down');
        return;
      case 'F2':
        event.preventDefault();
        startEditing();
        return;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        clearActiveCell();
        return;
      default:
        break;
    }

    if (key.length === 1 && !event.altKey && isNumberCell(activeRow, activeColumn)) {
      event.preventDefault();
      startEditing(key);
    }
  };

  const handleCellPointerDown = (event: React.MouseEvent<HTMLTableCellElement>, row: number, col: number): void => {
    if ((event.target as HTMLElement).closest('button')) return;
    if (editing && activeCell.row === row && activeCell.col === col) return;
    if (editing) commitEdit('none');
    setActive({ row, col });
    const table = tableRef.current;
    if (table && document.activeElement !== table) table.focus();
  };

  const handleCellDoubleClick = (row: number, col: number): void => {
    setActive({ row, col });
    startEditing();
  };

  // Keep the focused cell on screen, clear of the sticky header, footer and person column.
  React.useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || rows.length === 0 || layout.length === 0) return;
    const cell = document.getElementById(cellId(activeCell.row, activeCell.col));
    if (!cell) return;

    const view = wrapper.getBoundingClientRect();
    const rect = cell.getBoundingClientRect();
    const column = layout[activeCell.col];
    const headHeight = spec.headerHeight;
    const footHeight = spec.footerHeight;

    if (column.stickyLeft === undefined && column.stickyRight === undefined) {
      const leftBound = view.left + stickyLeftWidth(layout);
      const rightBound = view.right - stickyRightWidth(layout);
      if (rect.left < leftBound) wrapper.scrollLeft -= leftBound - rect.left;
      else if (rect.right > rightBound) wrapper.scrollLeft += rect.right - rightBound;
    }

    const topBound = view.top + headHeight;
    const bottomBound = view.bottom - footHeight;
    if (rect.top < topBound) wrapper.scrollTop -= topBound - rect.top;
    else if (rect.bottom > bottomBound) wrapper.scrollTop += rect.bottom - bottomBound;
  }, [activeCell.row, activeCell.col, layout, spec.headerHeight, spec.footerHeight, rows.length]);

  // Runs only when an edit starts or ends: re-running on every keystroke would reset the caret.
  // A layout effect so the editor owns the keyboard before the next keystroke arrives.
  React.useLayoutEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      editor.focus();
      if (caretAtEnd.current) editor.setSelectionRange(editor.value.length, editor.value.length);
      else editor.select();
      return;
    }
    // Committing or cancelling unmounts the editor, which leaves focus on the page body. Put it
    // back on the grid so arrow keys and typing keep working.
    const table = tableRef.current;
    if (table && hadFocus.current && (document.activeElement === null || document.activeElement === document.body)) {
      table.focus();
    }
  }, [editing !== null]);

  const cellStyle = (column: ColumnLayout): React.CSSProperties => ({
    left: column.stickyLeft,
    right: column.stickyRight,
  });

  /** Sticky cells need `position: sticky` from a class; the offsets stay inline. */
  const stickyClass = (column: ColumnLayout): string =>
    column.stickyLeft !== undefined ? ' tfg-sticky-left' : column.stickyRight !== undefined ? ' tfg-sticky-right' : '';

  const headerFor = (column: ColumnLayout): React.ReactNode => {
    if (column.kind === 'period') {
      return (
        <span className="tfg-th__stack">
          <span className="tfg-th__label">{column.label}</span>
          {column.subLabel ? <span className="tfg-th__sub">{column.subLabel}</span> : null}
        </span>
      );
    }
    return <span className="tfg-th__label">{column.label}</span>;
  };

  const headerCell = (column: ColumnLayout, index: number): React.ReactNode => {
    if (column.kind === 'spacer') {
      return <th key={`spacer-head-${index}`} className="tfg-th tfg-th--spacer" aria-hidden="true" />;
    }
    return (
      <th
        key={`${column.kind}-${column.period ? column.period.id : index}`}
        id={cellId(-1, index)}
        role="columnheader"
        scope="col"
        className={`tfg-th tfg-th--${column.kind} tfg-align--${column.align}${stickyClass(column)}`}
        style={cellStyle(column)}
        title={column.title || undefined}
      >
        {headerFor(column)}
      </th>
    );
  };

  const identityCell = (row: GridRow, isActive: boolean): React.ReactNode => (
    <span className="tfg-identity">
      <span className="tfg-avatar" data-tone={avatarTone(row.person.name || row.key)} aria-hidden="true">
        {initials(row.person.name)}
      </span>
      <span className="tfg-identity__text">
        <span className="tfg-identity__name">{row.person.name || 'Unnamed person'}</span>
        <span className="tfg-identity__meta">
          {jobLevelLine(row)}
          {row.person.isToBeAdded ? <em className="tfg-tag">new</em> : null}
        </span>
      </span>
      {readOnly ? null : (
        <span className="tfg-rowactions">
          <button
            type="button"
            className="tfg-iconbtn tfg-iconbtn--small"
            tabIndex={isActive ? 0 : -1}
            disabled={row.totalHours === 0}
            title="Fill the row: repeat the first period that has hours across every following period"
            aria-label={`Fill ${row.person.name} across the workstream`}
            onClick={() => onFillRight(row.key)}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
              <path d="M1 7.2h6.2V5L11.6 8l-4.4 3V8.8H1z" fill="currentColor" />
              <path d="M12.4 4.6h2v6.8h-2z" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="tfg-iconbtn tfg-iconbtn--small tfg-iconbtn--danger"
            tabIndex={isActive ? 0 : -1}
            title="Ask the app to remove this person and their hours"
            aria-label={`Ask the app to remove ${row.person.name}`}
            onClick={() => onRequestRemove(row.person.name)}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
              <path d="M6.5 1.5a1 1 0 0 0-1 1V3H2.5v1.5h1V14a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.5h1V3h-3v-.5a1 1 0 0 0-1-1h-2zm-1 2V3h4v.5h-4zM5 5.5h1.5V13H5V5.5zm4 0h1.5V13H9V5.5z" fill="currentColor" />
            </svg>
          </button>
        </span>
      )}
    </span>
  );

  const bodyCell = (row: GridRow, rowIndex: number, column: ColumnLayout, colIndex: number): React.ReactNode => {
    if (column.kind === 'spacer') {
      return <td key={`spacer-${colIndex}`} className="tfg-td tfg-td--spacer" aria-hidden="true" />;
    }

    const isActive = rowIndex === activeCell.row && colIndex === activeCell.col;
    const isEditing = isActive && editing !== null;
    const base = {
      key: `c-${colIndex}`,
      role: 'gridcell' as const,
      id: cellId(rowIndex, colIndex),
      className: `tfg-td tfg-td--${column.kind} tfg-align--${column.align}${stickyClass(column)}`,
      style: { ...cellStyle(column) } as React.CSSProperties,
      'data-active': isActive || undefined,
    };

    if (column.kind === 'identity') {
      return <td {...base}>{identityCell(row, isActive)}</td>;
    }

    if (column.kind === 'period' && column.period) {
      const hours = row.hours[column.period.id] || 0;
      const over = hours > column.period.capacity + 1e-6;
      const editable = isNumberCell(row, column);
      const label = `${column.period.title}: ${row.person.name || 'unnamed person'}, ${formatHours(hours)} hours`;
      return (
        <td
          {...base}
          data-over={over || undefined}
          data-empty={hours === 0 || undefined}
          data-locked={!editable || undefined}
          title={over ? `${column.period.title}: ${formatHours(hours)}h booked, capacity ${formatHours(column.period.capacity)}h` : undefined}
          aria-label={label}
          onMouseDown={(event) => handleCellPointerDown(event, rowIndex, colIndex)}
          onDoubleClick={() => handleCellDoubleClick(rowIndex, colIndex)}
        >
          {isEditing && editing && editable ? (
            <input
              ref={editorRef}
              className="tfg-editor"
              type="text"
              inputMode="decimal"
              aria-label={label}
              value={editing.text}
              onChange={(event) => setEditing({ text: event.target.value })}
              onBlur={() => commitEdit('none')}
            />
          ) : (
            <span className="tfg-value">{formatHours(hours)}</span>
          )}
        </td>
      );
    }

    const numeric = periodValueFor(row, column);
    const editable = isNumberCell(row, column);
    const outside = row.outsideWindowHours;
    return (
      <td
        {...base}
        data-locked={!editable || undefined}
        title={
          column.kind === 'totalHours' && outside > 0
            ? `${formatHours(outside)}h booked outside the workstream window is left untouched`
            : undefined
        }
        onMouseDown={(event) => handleCellPointerDown(event, rowIndex, colIndex)}
        onDoubleClick={() => handleCellDoubleClick(rowIndex, colIndex)}
      >
        {isEditing && editing ? (
          <input
            ref={editorRef}
            className="tfg-editor"
            type="text"
            inputMode="decimal"
            aria-label={`${column.title} for ${row.person.name}`}
            value={editing.text}
            onChange={(event) => setEditing({ text: event.target.value })}
            onBlur={() => commitEdit('none')}
          />
        ) : (
          <span className="tfg-value">{numeric}</span>
        )}
      </td>
    );
  };

  const footerCell = (column: ColumnLayout, index: number): React.ReactNode => {
    if (column.kind === 'spacer') {
      return <td key={`spacer-foot-${index}`} className="tfg-tf tfg-tf--spacer" aria-hidden="true" />;
    }

    const totals = model.totals;
    let content: React.ReactNode = null;
    switch (column.kind) {
      case 'identity':
        content = (
          <span className="tfg-identity">
            <span className="tfg-identity__text">
              <span className="tfg-identity__name tfg-identity__name--totals">Totals</span>
              <span className="tfg-identity__meta">
                {rows.length} {rows.length === 1 ? 'person' : 'people'}
              </span>
            </span>
          </span>
        );
        break;
      case 'rph':
        content = formatRate(totals.avgRph);
        break;
      case 'std':
        content = formatRate(totals.avgStd);
        break;
      case 'real':
        content = formatPercent(totals.avgRealisation);
        break;
      case 'period': {
        const hours = column.period ? totals.hours[column.period.id] || 0 : 0;
        const over = column.period ? hours > column.period.capacity + 1e-6 : false;
        return (
          <td
            key={`f-${index}`}
            role="gridcell"
            className={`tfg-tf tfg-tf--period tfg-align--end${stickyClass(column)}`}
            style={cellStyle(column)}
            data-over={over || undefined}
            data-empty={hours === 0 || undefined}
          >
            {formatHours(hours)}
          </td>
        );
      }
      case 'totalHours':
        content = formatHours(totals.hoursTotal);
        break;
      case 'fee':
        content = formatThousands(totals.fee);
        break;
      case 'gm':
        content = formatPercent(totals.gm);
        break;
      default:
        content = null;
    }
    return (
      <td key={`f-${index}`} role="gridcell" className={`tfg-tf tfg-tf--${column.kind} tfg-align--${column.align}${stickyClass(column)}`} style={cellStyle(column)}>
        {content}
      </td>
    );
  };

  const densityVars = {
    '--tfg-row-h': `${spec.rowHeight}px`,
    '--tfg-head-h': `${spec.headerHeight}px`,
    '--tfg-foot-h': `${spec.footerHeight}px`,
  } as React.CSSProperties;

  // An empty grid keeps the header and totals out of the table model, so assistive technology never
  // sees a row count that disagrees with the rows on screen.
  if (rows.length === 0) {
    return <div className="tfg-placeholder">No people to allocate. Bind the people table or use Add staff.</div>;
  }

  // Fixed column widths give the row its minimum size; the flexible spacer column takes whatever is
  // left over, so the timeline fills the width and the totals stay against the right edge.
  const minimumWidth = layout.reduce((total, column) => total + column.width, 0);

  return (
    <div className="tfg-gridwrap" ref={wrapperRef} style={densityVars}>
      <table
        ref={tableRef}
        className="tfg-table"
        role="grid"
        aria-label={GRID_LABEL}
        aria-rowcount={rows.length + 2}
        aria-colcount={navigable.length}
        aria-activedescendant={cellId(activeCell.row, activeCell.col)}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => {
          hadFocus.current = true;
        }}
        style={{ width: '100%', minWidth: minimumWidth }}
      >
        <colgroup>
          {layout.map((column, index) => (
            <col key={`col-${index}`} style={column.flexible ? undefined : { width: column.width }} />
          ))}
        </colgroup>
        <thead>
          <tr role="row" aria-rowindex={1}>
            {layout.map(headerCell)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.key} role="row" aria-rowindex={rowIndex + 2} data-active={rowIndex === activeCell.row || undefined}>
              {layout.map((column, colIndex) => bodyCell(row, rowIndex, column, colIndex))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr role="row" aria-rowindex={rows.length + 2}>
            {layout.map(footerCell)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Job level and team, plus the rates that the narrow density hides as columns. */
function jobLevelLine(row: GridRow): string {
  const parts = [row.person.jobLevel, row.person.team].filter((part) => !!part);
  return parts.length > 0 ? parts.join(' \u00b7 ') : 'No job level';
}

function periodValueFor(row: GridRow, column: ColumnLayout): string {
  switch (column.kind) {
    case 'rph':
      return formatRate(row.person.rph);
    case 'std':
      return formatRate(row.person.feeRate);
    case 'real':
      return formatPercent(row.realisation);
    case 'totalHours':
      return formatHours(row.totalHours);
    case 'fee':
      return formatThousands(row.fee);
    case 'gm':
      return formatPercent(row.gm);
    default:
      return '';
  }
}
