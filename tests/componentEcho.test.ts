/**
 * The component's contract with a canvas host: a dataset redelivery that carries the component's own
 * published change must not rebase the editor state (that is the flicker), while a change made
 * outside the component must.
 */
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { TimeFeesGrid } from '../TimeFeesGrid/index';
import { buildOutput, createStore } from '../TimeFeesGrid/src/engine';
import { allocationsFromOutput, createFakeHost, peopleFromOutput } from '../dev/fakeHost';
import type { FakeHost } from '../dev/fakeHost';
import { mockAllocations, mockHostInputs, mockPeople, mockTimeline } from '../dev/mockData';
import type { GridOutput, TimeFeesGridAppProps } from '../TimeFeesGrid/src/types';

function setup(): { component: TimeFeesGrid; host: FakeHost; notified: { count: number } } {
  const host = createFakeHost({
    people: mockPeople,
    allocations: mockAllocations,
    timeline: mockTimeline,
    host: mockHostInputs,
  });
  const component = new TimeFeesGrid();
  const notified = { count: 0 };
  component.init(host.context(), () => {
    notified.count += 1;
  });
  return { component, host, notified };
}

/** The props the host renders the React app from. */
function view(component: TimeFeesGrid, host: FakeHost): TimeFeesGridAppProps {
  // `updateView` is declared with an unparameterised element type; the component always builds it
  // from `TimeFeesGridAppProps` (TimeFeesGrid/index.ts).
  const element = component.updateView(host.context()) as ReactElement<TimeFeesGridAppProps>;
  return element.props;
}

/** What a canvas `OnChange` formula does: read the outputs and write the collections. */
function writeBack(host: FakeHost, output: GridOutput): void {
  host.setCollections({
    people: peopleFromOutput(output, mockPeople),
    allocations: allocationsFromOutput(output),
  });
}

describe('component / host round trip', () => {
  it('publishes nothing on load, ignores the write-back echo, and rebases on outside changes', () => {
    const { component, host, notified } = setup();

    const mounted = view(component, host);
    expect(mounted.snapshotVersion).toBe(1);
    // Screen navigation re-delivers the datasets; the grid must not fire the app's OnChange.
    expect(component.getOutputs().changes).toBeUndefined();
    expect(notified.count).toBe(0);

    // The user books hours: the grid publishes the change.
    const payload = buildOutput(createStore(mockAllocations), mockPeople, mockTimeline);
    const edited: GridOutput = {
      revision: 1,
      action: 'hoursChanged',
      personName: 'Alice Adams',
      allocations: payload.allocations.map((row, index) => (index === 0 ? { ...row, HoursWorked: row.HoursWorked + 4 } : row)),
      people: payload.people,
    };
    mounted.onChange(edited);
    expect(notified.count).toBe(1);
    expect(component.getOutputs().changes).toBe(edited);

    // The app writes it back; the redelivery must leave the editor state alone.
    writeBack(host, edited);
    const afterEdit = view(component, host);
    expect(afterEdit.snapshotVersion).toBe(1);
    expect(afterEdit.snapshot).toBe(mounted.snapshot);

    // A change the component did not make does rebase, so the grid never shows stale data, and
    // nothing is published for it: the outputs still describe the user's own last change.
    host.setCollections({
      allocations: [...allocationsFromOutput(edited), { personKey: 'Bob Brown', dateKey: '2026-01-05', hours: 6 }],
    });
    const rebased = view(component, host);
    expect(rebased.snapshotVersion).toBe(afterEdit.snapshotVersion + 1);
    expect(rebased.snapshot).not.toBe(afterEdit.snapshot);
    expect(rebased.snapshot.allocations).toContainEqual({ personKey: 'Bob Brown', dateKey: '2026-01-05', hours: 6 });
    expect(component.getOutputs().changes).toBe(edited);
    expect(notified.count).toBe(1);
  });

  it('keeps the outputs object identical until something changes', () => {
    const { component, host, notified } = setup();
    view(component, host);

    const outputs = component.getOutputs();
    expect(component.getOutputs()).toBe(outputs);

    const payload = buildOutput(createStore(mockAllocations), mockPeople, mockTimeline);
    const props = view(component, host);
    props.onChange({
      revision: 2,
      action: 'hoursCleared',
      personName: 'Bob Brown',
      allocations: payload.allocations,
      people: payload.people,
    });
    expect(notified.count).toBe(1);
    expect(component.getOutputs()).not.toBe(outputs);
  });
});

describe('component / paged host', () => {
  it('raises the page size, loads every page, and never rebases onto a partial delivery', () => {
    const { component, host } = setup();
    const mounted = view(component, host);

    // The host delivers the bookings one page at a time: the first page only, with more to come.
    const calls = { setPageSize: 0, refresh: 0, loadNextPage: 0 };
    let pages = 1;
    const paged = (context: ReturnType<FakeHost['context']>): ReturnType<FakeHost['context']> => {
      const parameters = context.parameters as unknown as Record<string, Record<string, unknown>>;
      const bookings = parameters.gridAllocations;
      const all = (bookings.sortedRecordIds as string[]).slice();
      const visible = pages === 1 ? all.slice(0, 2) : all;
      Object.defineProperty(bookings, 'sortedRecordIds', { get: () => visible });
      const records = bookings.records as Record<string, unknown>;
      Object.defineProperty(bookings, 'records', {
        get: () => Object.fromEntries(visible.map((id) => [id, records[id]])),
      });
      bookings.paging = {
        pageSize: 25,
        hasNextPage: pages === 1,
        setPageSize: () => (calls.setPageSize += 1),
        loadNextPage: () => {
          calls.loadNextPage += 1;
          pages = 2;
        },
      };
      bookings.refresh = () => (calls.refresh += 1);
      return context;
    };

    // Someone else changes the bookings; the first delivery is partial.
    host.setCollections({ allocations: [...mockAllocations, { personKey: 'Bob Brown', dateKey: '2026-01-05', hours: 6 }] });
    const partial = component.updateView(paged(host.context())) as ReactElement<TimeFeesGridAppProps>;
    expect(calls.setPageSize).toBe(1);
    expect(calls.refresh).toBe(1);
    expect(partial.props.snapshot).toBe(mounted.snapshot);

    const stillPartial = component.updateView(paged(host.context())) as ReactElement<TimeFeesGridAppProps>;
    expect(calls.loadNextPage).toBe(1);
    expect(stillPartial.props.snapshot).toBe(mounted.snapshot);

    // Every page has arrived: the grid rebases onto the whole table.
    const complete = component.updateView(paged(host.context())) as ReactElement<TimeFeesGridAppProps>;
    expect(complete.props.snapshotVersion).toBe(mounted.snapshotVersion + 1);
    expect(complete.props.snapshot.allocations).toHaveLength(mockAllocations.length + 1);
  });
});

describe('component / required height', () => {
  it('publishes the height the grid needs as "heightChanged", once per new value, keeping the data', () => {
    const { component, host, notified } = setup();
    const mounted = view(component, host);

    // Before any edit the payload is an empty heightChanged one, so OnChange has nothing to apply.
    mounted.onHeight?.(353);
    expect(notified.count).toBe(1);
    expect(component.getOutputs().requiredHeight).toBe(353);
    expect(component.getOutputs().changes).toMatchObject({ action: 'heightChanged', allocations: [], people: [] });

    // The same height again publishes nothing.
    mounted.onHeight?.(353);
    expect(notified.count).toBe(1);

    // An edit the host has not read yet keeps its action when the height changes with it: the host
    // may read both notifications at once, and the edit must still reach OnChange.
    const payload = buildOutput(createStore(mockAllocations), mockPeople, mockTimeline);
    mounted.onChange({ revision: 1, action: 'addStaffRequested', personName: '', allocations: payload.allocations, people: payload.people });
    mounted.onHeight?.(373);
    expect(notified.count).toBe(3);
    expect(component.getOutputs().changes).toMatchObject({ action: 'addStaffRequested', revision: 1 });
    expect(component.getOutputs().requiredHeight).toBe(373);

    // Once the host has read it, a later height change no longer repeats the action.
    mounted.onHeight?.(393);
    expect(notified.count).toBe(4);
    const changes = component.getOutputs().changes as GridOutput;
    expect(changes.action).toBe('heightChanged');
    expect(changes.revision).toBe(1);
    expect(changes.allocations).toEqual(payload.allocations);
    expect(component.getOutputs().requiredHeight).toBe(393);
  });
});
