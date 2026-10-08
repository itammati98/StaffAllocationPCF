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
    expect(rebased.snapshot.allocations).toContainEqual({ personKey: 'person-bob', dateKey: '2026-01-05', hours: 6 });
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
