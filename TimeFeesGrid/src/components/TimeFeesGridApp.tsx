import * as React from 'react';
import { BulkEdit, Grid, GridNotice } from './Grid';
import { Toolbar } from './Toolbar';
import { colorVars } from '../colors';
import { buildColumnLayout, densityForWidth } from '../gridColumns';
import { useElementSize, useTransientMessage } from '../hooks';
import { formatHours } from '../format';
import { AllocationStore, GridAction, PeriodColumn, PersonRow, Phasing, TimeFeesGridAppProps } from '../types';
import {
  buildColumns,
  buildOutput,
  computeModel,
  createStore,
  distributeHours,
  fillRight,
  realisationFromRph,
  rphFromRealisation,
  setColumnHours,
} from '../engine';

/**
 * The grid application: owns the editable state (bookings, and the rates the pricing mode owns),
 * renders the toolbar, the keyboard-navigable grid and the status line, publishes every change to
 * the host, and asks the host to add or remove people instead of doing that itself.
 */
export function TimeFeesGridApp(props: TimeFeesGridAppProps): React.ReactElement {
  const { host, snapshot, snapshotVersion, onChange, onHeight } = props;

  const [rootRef, size] = useElementSize<HTMLDivElement>();
  const density = densityForWidth(size.width || 1024);

  const [people, setPeople] = React.useState<PersonRow[]>(() => [...snapshot.people]);
  const [store, setStore] = React.useState<AllocationStore>(() => createStore(snapshot.allocations));
  const [phasing, setPhasing] = React.useState<Phasing>(host.phasing);
  const [outsideFilter, setOutsideFilter] = React.useState(false);

  const { message, show } = useTransientMessage();
  const revision = React.useRef(0);
  const lastSnapshotVersion = React.useRef(snapshotVersion);

  const peopleInOrder = React.useMemo(
    () => [...people].sort((left, right) => left.jobLevelOrder - right.jobLevelOrder),
    [people],
  );
  const columns = React.useMemo(
    () => buildColumns(snapshot.timeline, phasing, host.hoursPerDay),
    [snapshot.timeline, phasing, host.hoursPerDay],
  );
  const model = React.useMemo(() => computeModel(peopleInOrder, store, columns), [peopleInOrder, store, columns]);
  const layout = React.useMemo(() => buildColumnLayout(columns, density, { fill: !host.readOnly }), [columns, density, host.readOnly]);
  // The outside-the-window chip narrows the grid to the people who have such hours; the filter
  // lapses by itself once nobody has any.
  const filterOn = outsideFilter && model.outsideWindowHours > 0;
  const shownModel = React.useMemo(
    () =>
      filterOn
        ? computeModel(
            peopleInOrder.filter((_, index) => model.rows[index].outsideWindowHours > 0),
            store,
            columns,
          )
        : model,
    [filterOn, model, peopleInOrder, store, columns],
  );
  const holidayCount = React.useMemo(() => {
    if (host.holidays.length === 0) return 0;
    const holidays = new Set(host.holidays);
    return snapshot.timeline.filter((day) => day.weekday <= 5 && holidays.has(day.dateKey)).length;
  }, [host.holidays, snapshot.timeline]);
  const readOnly = host.readOnly;

  /** Hands the current state to the host; the host reads it back through `getOutputs`. */
  const publish = React.useCallback(
    (nextStore: AllocationStore, nextPeople: readonly PersonRow[], action: GridAction, personName: string): void => {
      revision.current += 1;
      const payload = buildOutput(nextStore, nextPeople, snapshot.timeline);
      onChange({
        revision: revision.current,
        action,
        personName,
        allocations: payload.allocations,
        people: payload.people,
      });
    },
    [onChange, snapshot.timeline],
  );

  // Rebase whenever the host pushes new data (its collections changed outside the component).
  React.useEffect(() => {
    if (snapshotVersion === lastSnapshotVersion.current) return;
    lastSnapshotVersion.current = snapshotVersion;
    setPeople([...snapshot.people]);
    setStore(createStore(snapshot.allocations));
  }, [snapshotVersion, snapshot]);

  const applyStore = (nextStore: AllocationStore, action: GridAction, personName: string): void => {
    setStore(nextStore);
    publish(nextStore, peopleInOrder, action, personName);
  };

  const applyPeople = (nextPeople: PersonRow[], action: GridAction, personName: string): void => {
    setPeople(nextPeople);
    publish(store, nextPeople, action, personName);
  };

  const handleSetHours = (rowKey: string, period: PeriodColumn, hours: number): void => {
    const nextStore = setColumnHours(store, period, rowKey, hours, host.hoursPerDay);
    const row = model.rows.find((candidate) => candidate.key === rowKey);

    if (hours > period.capacity + 1e-6) {
      show({
        text: `${formatHours(hours)}h is above the ${formatHours(period.capacity)}h capacity of ${period.label}; spread evenly across ${period.workingDays.length} working days.`,
        tone: 'warning',
      });
    } else if (hours === 0) {
      show({ text: `${period.label} cleared for ${row ? row.person.name || 'this person' : 'this person'}.`, tone: 'info' });
    } else {
      const days = distributeHours(hours, period.workingDays.length, host.hoursPerDay).filter((value) => value > 0).length;
      show({
        text: `${formatHours(hours)}h booked in ${period.label} for ${row ? row.person.name || 'this person' : 'this person'}, spread over ${days} ${days === 1 ? 'working day' : 'working days'}.`,
        tone: 'info',
      });
    }

    applyStore(nextStore, hours === 0 ? 'hoursCleared' : 'hoursChanged', row ? row.person.name : '');
  };

  const handleSetRate = (rowKey: string, field: 'rph' | 'realisation', value: number): void => {
    const person = people.find((candidate) => candidate.key === rowKey);
    if (!person) return;
    const nextPeople = people.map((candidate) =>
      candidate.key !== rowKey
        ? candidate
        : field === 'rph'
          ? { ...candidate, rph: value, realisation: realisationFromRph(value, candidate.feeRate) }
          : { ...candidate, realisation: value, rph: rphFromRealisation(value, candidate.feeRate) },
    );
    applyPeople(nextPeople, 'ratesChanged', person.name);
  };

  /**
   * Paste, cut and Delete over a selection: every cell is applied to one new store (or one people
   * list) and published once, so the host gets a single hoursChanged / ratesChanged payload.
   */
  const handleBulkEdit = (edit: BulkEdit): void => {
    const cells = edit.hours.length + edit.rates.length;
    const skipped = edit.skipped > 0 ? ` ${edit.skipped} ${edit.skipped === 1 ? 'cell was' : 'cells were'} skipped (not a number, or not editable here).` : '';
    const nameOf = (keys: string[]): string => {
      const unique = [...new Set(keys)];
      return unique.length === 1 ? people.find((person) => person.key === unique[0])?.name ?? '' : '';
    };

    if (edit.hours.length > 0) {
      let nextStore = store;
      let over = 0;
      for (const update of edit.hours) {
        nextStore = setColumnHours(nextStore, update.period, update.rowKey, update.hours, host.hoursPerDay);
        if (update.hours > update.period.capacity + 1e-6) over += 1;
      }
      const cleared = edit.hours.every((update) => update.hours === 0);
      const overText = over > 0 ? ` ${over} ${over === 1 ? 'period is' : 'periods are'} above capacity.` : '';
      show({
        text: `${edit.verb} ${cells} ${cells === 1 ? 'cell' : 'cells'}.${overText}${skipped}`,
        tone: over > 0 || edit.skipped > 0 ? 'warning' : 'info',
      });
      applyStore(nextStore, cleared ? 'hoursCleared' : 'hoursChanged', nameOf(edit.hours.map((update) => update.rowKey)));
      return;
    }

    if (edit.rates.length > 0) {
      const byKey = new Map(edit.rates.map((update) => [update.rowKey, update]));
      const nextPeople = people.map((person) => {
        const update = byKey.get(person.key);
        if (!update) return person;
        return update.field === 'rph'
          ? { ...person, rph: update.value, realisation: realisationFromRph(update.value, person.feeRate) }
          : { ...person, realisation: update.value, rph: rphFromRealisation(update.value, person.feeRate) };
      });
      show({ text: `${edit.verb} ${cells} ${cells === 1 ? 'rate' : 'rates'}.${skipped}`, tone: edit.skipped > 0 ? 'warning' : 'info' });
      applyPeople(nextPeople, 'ratesChanged', nameOf(edit.rates.map((update) => update.rowKey)));
    }
  };

  const handleFillRight = (rowKey: string): void => {
    const row = model.rows.find((candidate) => candidate.key === rowKey);
    if (!row) return;
    const source = columns.find((column) => (row.hours[column.id] || 0) > 0);
    if (!source) {
      show({ text: 'Nothing to fill: this row has no hours yet. Book hours in one period first.', tone: 'warning' });
      return;
    }
    const nextStore = fillRight(store, columns, rowKey, host.hoursPerDay);
    show({
      text: `Filled ${formatHours(row.hours[source.id] || 0)}h from ${source.label} across the remaining periods for ${row.person.name || 'this person'}.`,
      tone: 'info',
    });
    applyStore(nextStore, 'hoursFilled', row.person.name);
  };

  /**
   * Adding and removing people is the app's job: it owns the person table and whatever picker or
   * confirmation it wants. The grid records the request in the published payload (action, revision
   * and personName) and the app reacts to it; the grid never invents or deletes a person itself.
   */
  const handleRequestAddStaff = (): void => {
    publish(store, peopleInOrder, 'addStaffRequested', '');
    show({ text: 'Adding staff', tone: 'info' });
  };

  const handleRequestRemove = (personName: string): void => {
    publish(store, peopleInOrder, 'removePersonRequested', personName);
    show({ text: `Removed ${personName || 'the person'}`, tone: 'info' });
  };

  const handleNotice = (notice: GridNotice): void => show(notice);

  const warnings = host.showNotifications ? snapshot.warnings : [];
  const palette = React.useMemo(() => colorVars(host.colors) as React.CSSProperties, [host.colors]);

  // Reports the height the grid needs to show every row: measured after each render and whenever
  // the control is resized (a narrower control can wrap the toolbar or add a scrollbar).
  const lastHeight = React.useRef(0);
  const onHeightRef = React.useRef(onHeight);
  onHeightRef.current = onHeight;
  const reportHeight = React.useCallback((): void => {
    const root = rootRef.current;
    const report = onHeightRef.current;
    if (!root || !report) return;
    const height = requiredHeight(root);
    if (height > 0 && height !== lastHeight.current) {
      lastHeight.current = height;
      report(height);
    }
  }, [rootRef]);
  React.useLayoutEffect(reportHeight);
  // Sizes can also change without a render: the control is resized and the toolbar wraps, or a
  // web font arrives. Watch the root, the toolbar and the table themselves.
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(reportHeight);
    observer.observe(root);
    const watched = new Set<Element>();
    const watchParts = (): void => {
      for (const part of Array.from(root.querySelectorAll('.tfg-toolbar, .tfg-table'))) {
        if (!watched.has(part)) {
          watched.add(part);
          observer.observe(part);
        }
      }
    };
    watchParts();
    // The table mounts and unmounts (empty grid, no timeline); pick it up when it appears.
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(watchParts);
    mutations?.observe(root, { childList: true });
    return () => {
      observer.disconnect();
      mutations?.disconnect();
    };
  }, [rootRef, reportHeight]);

  return (
    <div className="tfg-root" ref={rootRef} style={palette} data-density={density} data-readonly={readOnly ? 'true' : undefined}>
      <Toolbar
        phasing={phasing}
        pricingMethod={host.pricingMethod}
        showPricingBadge={host.showPricingBadge}
        readOnly={readOnly}
        outsideWindowHours={model.outsideWindowHours}
        outsideFilterOn={filterOn}
        holidayCount={holidayCount}
        onToggleOutsideFilter={() => setOutsideFilter(!filterOn)}
        onPhasingChange={setPhasing}
        onAddStaff={handleRequestAddStaff}
      >
        {/* The status floats under the toolbar instead of taking a row, so it never changes the
            grid's height (the app sizes the control from requiredHeight). */}
        {message ? (
          <div className={`tfg-status tfg-status--${message.tone}`} role="status" aria-live="polite">
            <span className="tfg-status__text">{message.text}</span>
          </div>
        ) : null}
      </Toolbar>


      {snapshot.error ? <div className="tfg-banner tfg-banner--error">{snapshot.error}</div> : null}
      {warnings.length > 0 ? (
        <ul className="tfg-banner tfg-banner--warning">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {snapshot.loading && people.length === 0 ? (
        <div className="tfg-placeholder">Loading people and bookings&hellip;</div>
      ) : columns.length === 0 || layout.length === 0 ? (
        <div className="tfg-placeholder">
          No timeline to allocate against. Bind the workstream timeline table, or set a workstream start date and number of weeks.
        </div>
      ) : (
        <Grid
          layout={layout}
          model={shownModel}
          density={density}
          readOnly={readOnly}
          pricingMethod={host.pricingMethod}
          highlightOutside={filterOn}
          onSetHours={handleSetHours}
          onSetRate={handleSetRate}
          onFillRight={handleFillRight}
          onBulkEdit={handleBulkEdit}
          onRequestRemove={handleRequestRemove}
          onNotice={handleNotice}
        />
      )}
    </div>
  );
}

/** Room the "no timeline" and loading messages take when the grid has nothing else to show. */
const PLACEHOLDER_HEIGHT = 80;

/** People shown before the control stops growing and the rows scroll inside it. */
export const MAX_VISIBLE_ROWS = 5;

/**
 * Height in pixels the control should have: the toolbar and any banners as drawn, plus the table's
 * own height and the horizontal scrollbar under the timeline when there is one. Only the first
 * `MAX_VISIBLE_ROWS` people count, so with more of them the height stops growing and the rows
 * scroll between the pinned header and totals. The table is measured rather than the area around
 * it, so the answer does not depend on how tall the control currently is.
 */
export function requiredHeight(root: HTMLElement): number {
  let total = 0;
  for (const child of Array.from(root.children) as HTMLElement[]) {
    if (child.classList.contains('tfg-gridwrap')) {
      const table = child.querySelector('table');
      total += (table ? tableHeight(table) : 0) + (child.offsetHeight - child.clientHeight);
    } else if (child.classList.contains('tfg-placeholder')) {
      total += PLACEHOLDER_HEIGHT;
    } else {
      total += child.getBoundingClientRect().height;
    }
  }
  return Math.ceil(total - 0.01);
}

/**
 * Header, the first `MAX_VISIBLE_ROWS` people and the total row. These are added up rather than
 * read from the table, whose filler row stretches to fill the control and would never let the
 * height shrink.
 */
function tableHeight(table: HTMLTableElement): number {
  const rows = Array.from(table.tBodies[0]?.rows ?? []).slice(0, MAX_VISIBLE_ROWS);
  const parts: (Element | null | undefined)[] = [table.tHead, ...rows, table.tFoot];
  return parts.reduce((sum, part) => sum + (part ? part.getBoundingClientRect().height : 0), 0);
}
