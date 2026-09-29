import * as React from 'react';
import * as ReactDOM from 'react-dom';
// The PCF host injects this file through the manifest's <css> resource; the harness imports it.
import '../TimeFeesGrid/css/grid.css';
import { TimeFeesGridApp } from '../TimeFeesGrid/src/components/TimeFeesGridApp';
import { realisationFromRph } from '../TimeFeesGrid/src/engine';
import type { GridOutput, PersonRow, PricingMethod } from '../TimeFeesGrid/src/types';
import { mockHostInputs, mockSnapshot } from './mockData';

/**
 * Stands in for the canvas app: it owns the people table, and reacts to the add/remove requests the
 * grid publishes on its Changes output the way an app would (a Timer watching Changes.revision, or
 * the OnChange write-back). Changing the table re-pushes the snapshot like a collection change does.
 */
function Harness(): React.ReactElement {
  const [snapshotVersion, setSnapshotVersion] = React.useState(1);
  const [people, setPeople] = React.useState<PersonRow[]>(mockSnapshot.people);
  const [readOnly, setReadOnly] = React.useState(false);
  const [showNotifications, setShowNotifications] = React.useState(true);
  const [pricingMethod, setPricingMethod] = React.useState<PricingMethod>('manualRate');
  const [output, setOutput] = React.useState<GridOutput | null>(null);
  const added = React.useRef(0);

  const handleChange = (next: GridOutput): void => {
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
          realisation: realisationFromRph(145, 150),
          jobLevelOrder: 1,
          isToBeAdded: true,
          currencyId: 'GBP',
        },
      ]);
      setSnapshotVersion((version) => version + 1);
    } else if (next.action === 'removePersonRequested') {
      setPeople((current) => current.filter((person) => person.name !== next.personName));
      setSnapshotVersion((version) => version + 1);
    }
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
            Pricing
            <select value={pricingMethod} onChange={(event) => setPricingMethod(event.target.value as PricingMethod)}>
              <option value="manualRate">Manual rate</option>
              <option value="realisationAdjustment">Realisation</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              setOutput(null);
              setPeople(mockSnapshot.people);
              added.current = 0;
              setSnapshotVersion((version) => version + 1);
            }}
          >
            Reset
          </button>
        </div>
      </header>
      <div className="panel">
        <TimeFeesGridApp
          host={{ ...mockHostInputs, readOnly, showNotifications, pricingMethod }}
          snapshot={{ ...mockSnapshot, people }}
          snapshotVersion={snapshotVersion}
          onChange={handleChange}
        />
      </div>
      <pre className="output">{output ? JSON.stringify(output, null, 2) : 'No changes yet.'}</pre>
    </div>
  );
}

const container = document.getElementById('root');
if (container) ReactDOM.render(<Harness />, container);
