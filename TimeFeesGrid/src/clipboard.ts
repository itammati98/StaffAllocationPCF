/**
 * Clipboard text for the grid, in the format Excel and Google Sheets use: rows separated by line
 * breaks, cells by tabs. Pure functions, no DOM.
 */

import { parseEditableNumber } from './format';

/** Cells as tab-separated text, one line per row, the way spreadsheets put them on the clipboard. */
export function toClipboardTable(cells: readonly (readonly string[])[]): string {
  return cells.map((row) => row.map((cell) => cell.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\r\n');
}

/**
 * Splits clipboard text into rows of cells. The line break spreadsheets add after the last row is
 * dropped, so one copied cell is one row with one cell. Quoted cells (a cell holding a line break)
 * are unwrapped.
 */
export function parseClipboardTable(text: string): string[][] {
  if (typeof text !== 'string' || text === '') return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => line.split('\t').map(unquote));
}

function unquote(cell: string): string {
  const trimmed = cell.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1).replace(/""/g, '"') : cell;
}

/** Spaces (\s includes non-breaking ones) and the currency signs a spreadsheet may copy with a rate. */
const IGNORED_CHARACTERS = /[\s£$€]/g;

/**
 * A pasted number. Accepts what spreadsheets copy: `1,039.5` (thousands separators), `7,5` (a comma
 * as the decimal separator), `95%`, `£150`, and an empty cell, which is 0 and so clears the cell.
 * Returns null for anything that is not a usable number.
 */
export function parsePastedNumber(text: string): number | null {
  let value = text.trim().replace(IGNORED_CHARACTERS, '').replace(/%$/, '');
  if (value === '' || value === '-' || value === '–') return 0;
  // 1,039 or 1,039.5: the commas group thousands (en-GB). A dot is always the decimal point, so
  // 7.125 stays seven and an eighth hours.
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(value)) value = value.replace(/,/g, '');
  return parseEditableNumber(value);
}
