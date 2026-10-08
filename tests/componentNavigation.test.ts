/**
 * The component's contract with a canvas host on screen navigation: the control must read the three
 * bound collections (people, bookings, timeline) whenever they hold data, including when
 * `OnVisible` populates them after the control has already mounted - and it must not publish
 * anything just because a screen was shown, so the app's OnChange never fires on navigation.
 */
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { TimeFeesGrid } from '../TimeFeesGrid/index';
import { createFakeHost } from '../dev/fakeHost';
import type { FakeHost } from '../dev/fakeHost';
import { mockAllocations, mockHostInputs, mockPeople, mockTimeline } from '../dev/mockData';
import type { TimeFeesGridAppProps } from '../TimeFeesGrid/src/types';

function props(component: TimeFeesGrid, host: FakeHost): TimeFeesGridAppProps {
  // `updateView` is declared with an unparameterised element type; the component always builds it
  // from `TimeFeesGridAppProps` (TimeFeesGrid/index.ts).
  const element = component.updateView(host.context()) as ReactElement<TimeFeesGridAppProps>;
  return element.props;
}

describe('screen navigation', () => {
  it('reads the three collections when OnVisible populates them after the control mounted', () => {
    const host = createFakeHost({ people: [], allocations: [], timeline: [], host: { ...mockHostInputs } });
    const component = new TimeFeesGrid();
    component.init(host.context(), () => undefined);

    const first = props(component, host);
    expect(first.snapshot.people).toHaveLength(0);
    expect(first.snapshot.allocations).toHaveLength(0);

    host.setCollections({ people: mockPeople, allocations: mockAllocations, timeline: mockTimeline });

    const second = props(component, host);
    expect(second.snapshotVersion).toBe(first.snapshotVersion + 1);
    expect(second.snapshot.people).toHaveLength(6);
    expect(second.snapshot.allocations.length).toBeGreaterThan(0);
    expect(second.snapshot.timelineFromHost).toBe(true);

    // The outputs stay blank until the user changes something.
    expect(component.getOutputs().changes).toBeUndefined();
  });

  it('reads the collections again when the control is destroyed and recreated on re-entry', () => {
    const host = createFakeHost({ people: mockPeople, allocations: mockAllocations, timeline: mockTimeline, host: { ...mockHostInputs } });
    const component = new TimeFeesGrid();
    component.init(host.context(), () => undefined);
    expect(props(component, host).snapshot.people).toHaveLength(6);
    component.destroy();

    const recreated = new TimeFeesGrid();
    recreated.init(host.context(), () => undefined);
    const view = props(recreated, host);
    expect(view.snapshot.people).toHaveLength(6);
    expect(view.snapshotVersion).toBe(1);
    expect(recreated.getOutputs().changes).toBeUndefined();
  });
});