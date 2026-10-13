import * as React from 'react';
import { Grid, GridNotice } from './Grid';
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
  const { host, snapshot, snapshotVersion, onChange } = props;

  const [rootRef, size] = useElementSize<HTMLDivElement>();
  const density = densityForWidth(size.width || 1024);

  const [people, setPeople] = React.useState<PersonRow[]>(() => [...snapshot.people]);
  const [store, setStore] = React.useState<AllocationStore>(() => createStore(snapshot.allocations));
  const [phasing, setPhasing] = React.useState<Phasing>(host.phasing);

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
  const layout = React.useMemo(() => buildColumnLayout(columns, density), [columns, density]);
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
  const totalHours = model.totals.hoursTotal;
  const palette = React.useMemo(() => colorVars(host.colors) as React.CSSProperties, [host.colors]);

  return (
    <div className="tfg-root" ref={rootRef} style={palette} data-density={density} data-readonly={readOnly ? 'true' : undefined}>
      <Toolbar
        density={density}
        phasing={phasing}
        pricingMethod={host.pricingMethod}
        showPricingBadge={host.showPricingBadge}
        readOnly={readOnly}
        peopleCount={people.length}
        periodCount={columns.length}
        hoursTotal={totalHours}
        outsideWindowHours={model.outsideWindowHours}
        onPhasingChange={setPhasing}
        onAddStaff={handleRequestAddStaff}
      />

      {message ? (
        <div className={`tfg-status tfg-status--${message.tone}`} role="status" aria-live="polite">
          <span className="tfg-status__text">{message.text}</span>
        </div>
      ) : null}

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
          model={model}
          density={density}
          readOnly={readOnly}
          pricingMethod={host.pricingMethod}
          onSetHours={handleSetHours}
          onSetRate={handleSetRate}
          onFillRight={handleFillRight}
          onRequestRemove={handleRequestRemove}
          onNotice={handleNotice}
        />
      )}

      <div className="tfg-hint">
        <span>
          <b>Arrow keys</b> move and apply the value being typed &middot; <b>Enter</b> or type to edit &middot; <b>Esc</b> cancels &middot;{' '}
          <b>Tab</b> commits and moves on &middot; <b>Del</b> clears
        </span>
        <span className="tfg-hint__legend">Hours spread over the working days of each period. Fee = hours &times; RPH. GM% is margin on cost.</span>
      </div>
    </div>
  );
}
