import * as React from 'react';
import { ColumnLayout, DENSITY, Density, isSelectableColumn, jumpPosition, stickyLeftWidth, stickyRightWidth } from '../gridColumns';
import {
  avatarTone,
  formatDateKey,
  formatEditableNumber,
  formatHours,
  formatOneDecimal,
  formatPercent,
  formatRate,
  formatThousands,
  formatTotalHours,
  formatTotalPercent,
  formatTotalThousands,
  initials,
  parseEditableNumber,
} from '../format';
import { parseClipboardTable, parsePastedNumber, toClipboardTable } from '../clipboard';
import { round6 } from '../engine';
import { GridModel, GridRow, PeriodColumn, PricingMethod } from '../types';

export interface CellRef {
  row: number;
  col: number;
}

export interface GridNotice {
  text: string;
  tone: 'info' | 'warning';
}

/**
 * Several cells changed at once (paste, cut, or Delete over a selection). The app applies them as
 * one change, so the host receives a single payload. A batch holds hours or rates, never both.
 */
export interface BulkEdit {
  hours: { rowKey: string; period: PeriodColumn; hours: number }[];
  rates: { rowKey: string; field: 'rph' | 'realisation'; value: number }[];
  /** What happened, for the status line: "Pasted", "Cut", "Cleared". */
  verb: string;
  /** Cells the batch could not use: text that is not a number, read-only cells, rates next to hours. */
  skipped: number;
}

interface GridProps {
  layout: ColumnLayout[];
  model: GridModel;
  density: Density;
  readOnly: boolean;
  pricingMethod: PricingMethod;
  /** True while the toolbar's outside-the-window chip filters the rows: their Hours cells are flagged. */
  highlightOutside: boolean;
  onSetHours: (rowKey: string, column: PeriodColumn, hours: number) => void;
  onSetRate: (rowKey: string, field: 'rph' | 'realisation', value: number) => void;
  onFillRight: (rowKey: string) => void;
  onBulkEdit: (edit: BulkEdit) => void;
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
  const {
    layout,
    model,
    density,
    readOnly,
    pricingMethod,
    highlightOutside,
    onSetHours,
    onSetRate,
    onFillRight,
    onBulkEdit,
    onRequestRemove,
    onNotice,
  } = props;

  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const tableRef = React.useRef<HTMLTableElement>(null);
  const editorRef = React.useRef<HTMLInputElement>(null);
  const idPrefix = React.useRef(`tfg-${Math.random().toString(36).slice(2, 9)}`);
  const caretAtEnd = React.useRef(false);
  const hadFocus = React.useRef(false);
  /** True once the open edit has been committed or cancelled, so a late blur cannot commit twice. */
  const editClosed = React.useRef(true);

  const [active, setActive] = React.useState<CellRef>({ row: 0, col: 0 });
  /** The other corner of a selected block; null when only the focused cell is selected. */
  const [anchor, setAnchor] = React.useState<CellRef | null>(null);
  const [editing, setEditing] = React.useState<{ text: string } | null>(null);
  /** Cell a mouse drag started on, while the button is held. */
  const dragFrom = React.useRef<CellRef | null>(null);

  const spec = DENSITY[density];
  const rows = model.rows;

  /**
   * Layout indexes of the cells that can be focused, selected and copied. The Fill column's buttons
   * are reached with Tab, and the Hours and Fee columns are display-only.
   */
  const navigable = React.useMemo(
    () =>
      layout
        .map((column, index) => ({ column, index }))
        .filter((entry) => isSelectableColumn(entry.column.kind))
        .map((entry) => entry.index),
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

  /** The selected block, in rows and navigable positions; a single cell when nothing is extended. */
  const lastRow = Math.max(0, rows.length - 1);
  const corner = anchor ?? activeCell;
  const cornerRow = Math.min(corner.row, lastRow);
  const cornerPosition = Math.max(0, navigable.indexOf(corner.col));
  const activePosition = Math.max(0, navPosition);
  const selection = {
    top: Math.min(activeCell.row, cornerRow),
    bottom: Math.max(activeCell.row, cornerRow),
    left: Math.min(activePosition, cornerPosition),
    right: Math.max(activePosition, cornerPosition),
  };
  const multiSelected = selection.top !== selection.bottom || selection.left !== selection.right;
  const isSelected = (row: number, col: number): boolean => {
    if (!multiSelected) return false;
    const position = navigable.indexOf(col);
    return row >= selection.top && row <= selection.bottom && position >= selection.left && position <= selection.right;
  };
  const clearSelection = (): void => setAnchor(null);
  /** Keeps the block's far corner where it is while the focused cell moves. */
  const extendSelection = (): void => {
    if (anchor === null) setAnchor(activeCell);
  };

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
        clearSelection();
        setActive({ row: 0, col: navigable[0] });
      } else if (key === 'End') {
        event.preventDefault();
        clearSelection();
        setActive({ row: rows.length - 1, col: navigable[navigable.length - 1] });
      } else if (!editing && (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight')) {
        // Ctrl+arrow jumps to the edge of the table; with Shift it selects everything on the way.
        // In the cell editor the browser's own word-by-word caret move applies instead.
        event.preventDefault();
        if (event.shiftKey) extendSelection();
        else clearSelection();
        const kinds = navigable.map((index) => layout[index].kind);
        if (key === 'ArrowUp' || key === 'ArrowDown') {
          setActive({ row: key === 'ArrowUp' ? 0 : rows.length - 1, col: activeCell.col });
        } else {
          setActive({ row: activeCell.row, col: navigable[jumpPosition(kinds, activePosition, key === 'ArrowRight' ? 1 : -1)] });
        }
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

    // Shift with an arrow key grows the selected block; any other key leaves a single cell.
    if (event.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault();
      extendSelection();
      applyMove(key === 'ArrowUp' ? 'up' : key === 'ArrowDown' ? 'down' : key === 'ArrowLeft' ? 'left' : 'right');
      return;
    }
    if (key !== 'Shift' && key !== 'Delete' && key !== 'Backspace') clearSelection();

    switch (key) {
      case 'Escape':
        return;
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
        if (multiSelected) clearCells('Cleared');
        else clearActiveCell();
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
    if (event.shiftKey) {
      // Shift+click selects the block from the focused cell to this one.
      event.preventDefault();
      extendSelection();
    } else {
      clearSelection();
      dragFrom.current = { row, col };
    }
    setActive({ row, col });
    const table = tableRef.current;
    if (table && document.activeElement !== table) table.focus();
  };

  /** Dragging across cells with the button held selects the block, the way a spreadsheet does. */
  const handleCellPointerEnter = (event: React.MouseEvent<HTMLTableCellElement>, row: number, col: number): void => {
    const from = dragFrom.current;
    if (!from || editing || (event.buttons & 1) === 0) return;
    if (anchor === null || anchor.row !== from.row || anchor.col !== from.col) setAnchor(from);
    setActive({ row, col });
  };

  React.useEffect(() => {
    const endDrag = (): void => {
      dragFrom.current = null;
    };
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, []);

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
    // clientHeight leaves out the horizontal scrollbar, so a row never stops behind the totals.
    const bottomBound = view.top + wrapper.clientHeight - footHeight;
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

  // ------------------------------------------------------------------------------- clipboard

  /** Plain, unformatted text a spreadsheet can read back: 7.5 not "7.5h", 95 for 95%. */
  const cellCopyText = (row: GridRow, column: ColumnLayout): string => {
    switch (column.kind) {
      case 'identity':
        return row.person.name;
      case 'rph':
        return String(round6(row.person.rph));
      case 'std':
        return String(round6(row.person.feeRate));
      case 'real':
        return String(round6(row.realisation * 100));
      case 'period':
        return column.period ? formatEditableNumber(row.hours[column.period.id] || 0) : '';
      case 'totalHours':
        return String(round6(row.totalHours));
      case 'fee':
        return String(round6(row.fee));
      case 'gm':
        return String(round6(row.gm * 100));
      default:
        return '';
    }
  };

  const selectedText = (): string => {
    const cells: string[][] = [];
    for (let rowIndex = selection.top; rowIndex <= selection.bottom; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!row) continue;
      const line: string[] = [];
      for (let position = selection.left; position <= selection.right; position += 1) {
        line.push(cellCopyText(row, layout[navigable[position]]));
      }
      cells.push(line);
    }
    return toClipboardTable(cells);
  };

  /** Turns cell values into one batch; hours win when a block covers both hours and rates. */
  const collectEdit = (targets: { rowIndex: number; position: number; text: string }[], verb: string): BulkEdit => {
    const edit: BulkEdit = { hours: [], rates: [], verb, skipped: 0 };
    for (const target of targets) {
      const row = rows[target.rowIndex];
      const column = layout[navigable[target.position]];
      if (!row || !column || !isNumberCell(row, column)) {
        edit.skipped += 1;
        continue;
      }
      const value = parsePastedNumber(target.text);
      if (value === null) {
        edit.skipped += 1;
      } else if (column.kind === 'period' && column.period) {
        edit.hours.push({ rowKey: row.key, period: column.period, hours: value });
      } else if (column.kind === 'rph') {
        edit.rates.push({ rowKey: row.key, field: 'rph', value });
      } else if (column.kind === 'real') {
        edit.rates.push({ rowKey: row.key, field: 'realisation', value: value / 100 });
      }
    }
    // One payload carries one action, so a block of hours and rates keeps the hours.
    if (edit.hours.length > 0 && edit.rates.length > 0) {
      edit.skipped += edit.rates.length;
      edit.rates = [];
    }
    return edit;
  };

  /** Sets every editable cell of the selection to 0 (Delete over a block, and Cut). */
  const clearCells = (verb: string): void => {
    if (readOnly) return;
    const targets: { rowIndex: number; position: number; text: string }[] = [];
    for (let rowIndex = selection.top; rowIndex <= selection.bottom; rowIndex += 1) {
      for (let position = selection.left; position <= selection.right; position += 1) {
        if (isNumberCell(rows[rowIndex], layout[navigable[position]])) targets.push({ rowIndex, position, text: '' });
      }
    }
    const edit = collectEdit(targets, verb);
    if (edit.hours.length > 0 || edit.rates.length > 0) onBulkEdit({ ...edit, skipped: 0 });
  };

  /**
   * Pastes spreadsheet text. One copied value pasted over a selected block fills the whole block;
   * otherwise the copied block lands with its top-left cell on the selection's top-left cell, and
   * whatever falls past the grid's edge is dropped. The pasted area is selected afterwards.
   */
  const pasteText = (text: string): void => {
    if (readOnly) return;
    const block = parseClipboardTable(text);
    if (block.length === 0) return;
    const targets: { rowIndex: number; position: number; text: string }[] = [];
    if (block.length === 1 && block[0].length === 1 && multiSelected) {
      for (let rowIndex = selection.top; rowIndex <= selection.bottom; rowIndex += 1) {
        for (let position = selection.left; position <= selection.right; position += 1) {
          targets.push({ rowIndex, position, text: block[0][0] });
        }
      }
    } else {
      block.forEach((line, rowOffset) => {
        line.forEach((cell, columnOffset) => {
          const rowIndex = selection.top + rowOffset;
          const position = selection.left + columnOffset;
          if (rowIndex < rows.length && position < navigable.length) targets.push({ rowIndex, position, text: cell });
        });
      });
    }
    if (targets.length === 0) return;
    const edit = collectEdit(targets, 'Pasted');
    if (edit.hours.length === 0 && edit.rates.length === 0) {
      onNotice({ text: 'Nothing pasted: only hours and the editable rate can take a pasted number.', tone: 'warning' });
      return;
    }
    onBulkEdit(edit);
    const last = targets[targets.length - 1];
    setActive({ row: selection.top, col: navigable[selection.left] });
    setAnchor(targets.length > 1 ? { row: last.rowIndex, col: navigable[last.position] } : null);
  };

  // Copy, cut and paste arrive as clipboard events, which need no clipboard permission. They are
  // taken only while the grid itself has focus; inside the cell editor the browser's own copy and
  // paste of text apply. The handlers are read through a ref so the listeners are added once.
  const clipboard = React.useRef({ copy: selectedText, cut: (): void => clearCells('Cut'), paste: pasteText });
  clipboard.current = { copy: selectedText, cut: (): void => clearCells('Cut'), paste: pasteText };
  React.useEffect(() => {
    const owns = (): boolean => !!tableRef.current && document.activeElement === tableRef.current;
    const onCopy = (event: ClipboardEvent, cut: boolean): void => {
      if (!owns() || !event.clipboardData) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      event.clipboardData.setData('text/plain', clipboard.current.copy());
      if (cut) clipboard.current.cut();
    };
    const copy = (event: ClipboardEvent): void => onCopy(event, false);
    const cut = (event: ClipboardEvent): void => onCopy(event, true);
    const paste = (event: ClipboardEvent): void => {
      if (!owns() || !event.clipboardData) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      clipboard.current.paste(event.clipboardData.getData('text/plain'));
    };
    // Capture on window, so the grid is served before any page-level handler of the host.
    window.addEventListener('copy', copy, true);
    window.addEventListener('cut', cut, true);
    window.addEventListener('paste', paste, true);
    return () => {
      window.removeEventListener('copy', copy, true);
      window.removeEventListener('cut', cut, true);
      window.removeEventListener('paste', paste, true);
    };
  }, []);


  const cellStyle = (column: ColumnLayout): React.CSSProperties => ({
    left: column.stickyLeft,
    right: column.stickyRight,
  });

  /** Sticky cells need `position: sticky` from a class; the offsets stay inline. */
  const stickyClass = (column: ColumnLayout): string => {
    const side =
      column.stickyLeft !== undefined ? ' tfg-sticky-left' : column.stickyRight !== undefined ? ' tfg-sticky-right' : '';
    return column.stickyEdge ? `${side} tfg-sticky-edge` : side;
  };

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
        <span className="tfg-identity__meta">{jobLevelLine(row)}</span>
      </span>
      {readOnly ? null : (
        <span className="tfg-rowactions">
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
      'data-selected': isSelected(rowIndex, colIndex) || undefined,
    };

    if (column.kind === 'identity') {
      return (
        <td
          {...base}
          onMouseDown={(event) => handleCellPointerDown(event, rowIndex, colIndex)}
          onMouseEnter={(event) => handleCellPointerEnter(event, rowIndex, colIndex)}
        >
          {identityCell(row, isActive)}
        </td>
      );
    }

    if (column.kind === 'fill') {
      return (
        <td {...base} data-selected={undefined}>
          <button
            type="button"
            className="tfg-fillbtn"
            tabIndex={rowIndex === activeCell.row ? 0 : -1}
            disabled={row.totalHours === 0}
            title={
              row.totalHours === 0
                ? 'Book hours in a period first, then fill them across the following periods'
                : 'Fill the row: copy the first period that has hours into every following period'
            }
            aria-label={`Fill ${row.person.name} across the following periods`}
            onClick={() => onFillRight(row.key)}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
              <path d="M1.5 7.25h9.69L8.22 4.28l1.06-1.06L14.06 8l-4.78 4.78-1.06-1.06 2.97-2.97H1.5v-1.5z" fill="currentColor" />
            </svg>
          </button>
        </td>
      );
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
          onMouseEnter={(event) => handleCellPointerEnter(event, rowIndex, colIndex)}
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
    const outside = column.kind === 'totalHours' && row.outsideWindowHours > 0;
    return (
      <td
        {...base}
        data-locked={!editable || undefined}
        data-outside={(outside && highlightOutside) || undefined}
        title={outside ? outsideWindowTitle(row) : undefined}
        {...(isSelectableColumn(column.kind)
          ? {
              onMouseDown: (event: React.MouseEvent<HTMLTableCellElement>) => handleCellPointerDown(event, rowIndex, colIndex),
              onMouseEnter: (event: React.MouseEvent<HTMLTableCellElement>) => handleCellPointerEnter(event, rowIndex, colIndex),
              onDoubleClick: () => handleCellDoubleClick(rowIndex, colIndex),
            }
          : {})}
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

    if (column.kind === 'fill') {
      return <td key={`f-${index}`} className={`tfg-tf tfg-tf--fill${stickyClass(column)}`} style={cellStyle(column)} aria-hidden="true" />;
    }

    const totals = model.totals;
    let content: React.ReactNode = null;
    switch (column.kind) {
      case 'identity':
        content = (
          <span className="tfg-identity">
            <span className="tfg-identity__text">
              <span className="tfg-identity__name tfg-identity__name--totals">Total</span>
            </span>
          </span>
        );
        break;
      // Every figure in the totals row has one decimal place, like the app's summary card.
      case 'rph':
        content = formatOneDecimal(totals.avgRph);
        break;
      case 'std':
        content = formatOneDecimal(totals.avgStd);
        break;
      case 'real':
        content = formatTotalPercent(totals.avgRealisation);
        break;
      case 'period': {
        // The totals row sums a column across everyone, so it is never compared with one person's
        // capacity: the over-capacity flag belongs to the individual cells above it.
        const hours = column.period ? totals.hours[column.period.id] || 0 : 0;
        return (
          <td
            key={`f-${index}`}
            role="gridcell"
            className={`tfg-tf tfg-tf--period tfg-align--end${stickyClass(column)}`}
            style={cellStyle(column)}
          >
            {formatTotalHours(hours)}
          </td>
        );
      }
      case 'totalHours':
        content = formatTotalHours(totals.hoursTotal);
        break;
      case 'fee':
        content = formatTotalThousands(totals.fee);
        break;
      case 'gm':
        content = formatTotalPercent(totals.gm);
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
    return <div className="tfg-empty">No people added yet - use Add staff to book hours.</div>;
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
        aria-colcount={layout.filter((column) => column.kind !== 'spacer').length}
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

/** Tooltip for a row's Hours cell: the hours kept outside the window, day by day. */
function outsideWindowTitle(row: GridRow): string {
  const days = row.outsideWindow.map((day) => `${formatDateKey(day.dateKey)} (${formatHours(day.hours)}h)`);
  return `${formatHours(row.outsideWindowHours)}h booked outside the workstream window, left untouched: ${days.join(', ')}`;
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
