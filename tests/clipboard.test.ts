/** Clipboard text in and out of the grid: the tab-separated format spreadsheets use. */
import { describe, expect, it } from 'vitest';
import { parseClipboardTable, parsePastedNumber, toClipboardTable } from '../TimeFeesGrid/src/clipboard';

describe('clipboard tables', () => {
  it('writes rows on lines and cells between tabs', () => {
    expect(toClipboardTable([['8', '4'], ['', '7.5']])).toBe('8\t4\r\n\t7.5');
    expect(toClipboardTable([['Alice\tAdams']])).toBe('Alice Adams');
  });

  it('reads what Excel copies, including its trailing line break', () => {
    expect(parseClipboardTable('8\t4\r\n\t7.5\r\n')).toEqual([['8', '4'], ['', '7.5']]);
    expect(parseClipboardTable('12\n')).toEqual([['12']]);
    expect(parseClipboardTable('"1,039"\t5')).toEqual([['1,039', '5']]);
    expect(parseClipboardTable('')).toEqual([]);
  });

  it('round-trips a copied block', () => {
    const cells = [['40', '32'], ['8', '']];
    expect(parseClipboardTable(toClipboardTable(cells))).toEqual(cells);
  });
});

describe('pasted numbers', () => {
  it('reads plain, grouped and comma-decimal numbers', () => {
    expect(parsePastedNumber('8')).toBe(8);
    expect(parsePastedNumber(' 7.5 ')).toBe(7.5);
    expect(parsePastedNumber('7,5')).toBe(7.5);
    expect(parsePastedNumber('1,039')).toBe(1039);
    expect(parsePastedNumber('1,039.5')).toBe(1039.5);
    expect(parsePastedNumber('7.125')).toBe(7.125);
  });

  it('drops currency signs and a percent sign', () => {
    expect(parsePastedNumber('£150')).toBe(150);
    expect(parsePastedNumber('95%')).toBe(95);
  });

  it('treats an empty cell or a dash as 0, which clears the cell', () => {
    expect(parsePastedNumber('')).toBe(0);
    expect(parsePastedNumber('-')).toBe(0);
    expect(parsePastedNumber('–')).toBe(0);
  });

  it('rejects text and negative numbers', () => {
    expect(parsePastedNumber('Alice')).toBeNull();
    expect(parsePastedNumber('-4')).toBeNull();
  });
});
