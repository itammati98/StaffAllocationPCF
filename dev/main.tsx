import * as React from 'react';
import * as ReactDOM from 'react-dom';
// The PCF host injects this file through the manifest's <css> resource; the harness imports it.
import '../TimeFeesGrid/css/grid.css';
import { TimeFeesGrid } from '../TimeFeesGrid/index';
import { DEFAULT_COLORS, GridColors } from '../TimeFeesGrid/src/colors';
import type { AllocationEntry, GridHostInputs, GridOutput, PersonRow, PricingMethod } from '../TimeFeesGrid/src/types';
import { allocationsFromOutput, createFakeHost, peopleFromOutput } from './fakeHost';
import { mockAllocations, mockHostInputs, mockPeople, mockTimeline } from './mockData';

/**
 * Stands in for the canvas app. It holds the collections, builds the host's parameter bag from them
 * and re-renders the real component on every change, so the loop the app runs - edit, publish,
 * write the collections, redeliver the datasets - is exercised here exactly as it is in Power Apps.
 */
function Harness(): React.ReactElement {
  const [people, setPeople] = React.useState<PersonRow[]>(() => [...mockPeople]);
  const [allocations, setAllocations] = React.useState<AllocationEntry[]>(() => [...mockAllocations]);
  const [readOnly, setReadOnly] = React.useState(false);
  const [showNotifications, setShowNotifications] = React.useState(true);
  const [showPricingBadge, setShowPricingBadge] = React.useState(true);
  const [pricingMethod, setPricingMethod] = React.useState<PricingMethod>('manualRate');
  const [colors, setColors] = React.useState<GridColors>(DEFAULT_COLORS);
  const [output, setOutput] = React.useState<GridOutput | null>(null);

  const container = React.useRef<HTMLDivElement>(null);
  const component = React.useRef<TimeFeesGrid | null>(null);
  const added = React.useRef(0);

  const host = React.useMemo<GridHostInputs>(
    () => ({ ...mockHostInputs, readOnly, showNotifications, showPricingBadge, pricingMethod, colors }),
    [readOnly, showNotifications, showPricingBadge, pricingMethod, colors],
  );

  const fakeHost = React.useMemo(
    () => createFakeHost({ people, allocations, timeline: mockTimeline, host }),
    [people, allocations, host],
  );

  /** The app side of the contract: what a canvas `OnChange` formula does with the payload. */
  const applyOutput = React.useCallback(
    (next: GridOutput) => {
      setOutput(next);

      if (next.action === 'addStaffRequested') {
        added.current += 1;
        const number = added.current;
        setPeople((current) => [
          ...current,
          {
            key: `app-added-${number}`,
            name: `App Added ${number}`,
            jobLevel: 'Consultant',
            team: 'Consulting',
            costRate: 45,
            feeRate: 150,
            rph: 145,
            realisation: 145 / 150,
            jobLevelOrder: 1,
            isToBeAdded: true,
            currencyId: 'GBP',
          },
        ]);
        return;
      }

      if (next.action === 'removePersonRequested') {
        setPeople((current) => current.filter((person) => person.name !== next.personName));
        setAllocations((current) => current.filter((entry) => entry.personKey !== next.personName));
        return;
      }

      // Everything else is the grid reporting its own state: write it back into the collections.
      setPeople((current) => peopleFromOutput(next, current));
      setAllocations(allocationsFromOutput(next));
    },
    [],
  );

  // One component instance for the page, driven by the fake host on every collection change.
  React.useEffect(() => {
    const element = container.current;
    if (!element) return;
    if (component.current === null) {
      const instance = new TimeFeesGrid();
      instance.init(fakeHost.context(), () => applyOutput(instance.getOutputs().changes as GridOutput));
      component.current = instance;
    }
    ReactDOM.render(component.current.updateView(fakeHost.context()), element);
  }, [fakeHost, applyOutput]);

  const reset = (): void => {
    added.current = 0;
    setPeople([...mockPeople]);
    setAllocations([...mockAllocations]);
    setOutput(null);
  };

  return (
    <div className="page">
      <header>
        <h1>Time &amp; fees grid harness</h1>
        <div className="controls">
          <label>
            <input type="checkbox" checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} /> View only
          </label>
          <label>
            <input type="checkbox" checked={showNotifications} onChange={(event) => setShowNotifications(event.target.checked)} /> Notifications
          </label>
          <label>
            <input type="checkbox" checked={showPricingBadge} onChange={(event) => setShowPricingBadge(event.target.checked)} /> Pricing badge
          </label>
          <label>
            Pricing
            <select value={pricingMethod} onChange={(event) => setPricingMethod(event.target.value as PricingMethod)}>
              <option value="manualRate">Manual rate</option>
              <option value="realisationAdjustment">Realisation</option>
            </select>
          </label>
          <button type="button" onClick={reset}>
            Reset
          </button>
        </div>
      </header>

      <div className="controls controls--colors">
        {COLOR_FIELDS.map((field) => (
          <label key={field.key}>
            {field.label}
            <input
              type="color"
              value={colors[field.key]}
              onChange={(event) => {
                // React 16 pools the event, so the value is read before the state updater runs.
                const value = event.target.value;
                setColors((current) => ({ ...current, [field.key]: value }));
              }}
            />
          </label>
        ))}
      </div>

      <div className="panel" ref={container} />

      <pre className="output">{output ? JSON.stringify(output, null, 2) : 'No changes yet.'}</pre>
    </div>
  );
}

const COLOR_FIELDS: readonly { key: keyof GridColors; label: string }[] = [
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Background' },
  { key: 'header', label: 'Header / totals' },
  { key: 'text', label: 'Text' },
  { key: 'overCapacity', label: 'Over capacity' },
  { key: 'overCapacityText', label: 'Over capacity text' },
  { key: 'border', label: 'Grid lines' },
  { key: 'mutedText', label: 'Secondary text' },
  { key: 'hover', label: 'Row hover' },
  { key: 'subtleBackground', label: 'Toolbar' },
  { key: 'danger', label: 'Danger' },
];

const root = document.getElementById('root');
if (root) ReactDOM.render(<Harness />, root);
