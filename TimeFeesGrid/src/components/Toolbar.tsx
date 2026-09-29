import * as React from 'react';
import { Density } from '../gridColumns';
import { formatHours } from '../format';
import { Phasing, PricingMethod } from '../types';

export const PHASING_LABELS: Record<Phasing, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

export const PRICING_LABELS: Record<PricingMethod, string> = {
  manualRate: 'Manual rate adjustment',
  realisationAdjustment: 'Realisation adjustment',
};

const PHASINGS: readonly Phasing[] = ['daily', 'weekly', 'monthly'];

interface ToolbarProps {
  density: Density;
  phasing: Phasing;
  /** Shown as a read-only chip: the app owns the pricing mode. */
  pricingMethod: PricingMethod;
  readOnly: boolean;
  peopleCount: number;
  periodCount: number;
  hoursTotal: number;
  /** Hours booked by these people outside the workstream window; shown as context. */
  outsideWindowHours: number;
  helpOpen: boolean;
  onPhasingChange: (phasing: Phasing) => void;
  /** Asks the host application to add a person; the app owns that flow. */
  onAddStaff: () => void;
  onToggleHelp: () => void;
}

export function Toolbar(props: ToolbarProps): React.ReactElement {
  const { density, phasing, pricingMethod, readOnly, peopleCount, periodCount, hoursTotal, outsideWindowHours, helpOpen } = props;
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);

  /** Arrow keys move between the phasing buttons, as expected of a radio group. */
  const onPhasingKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = PHASINGS.indexOf(phasing);
    const next = (index + step + PHASINGS.length) % PHASINGS.length;
    props.onPhasingChange(PHASINGS[next]);
    // Keep focus on the button that is now selected so the choice is announced.
    buttons.current[next]?.focus();
  };

  return (
    <div className="tfg-toolbar">
      <span className="tfg-toolbar__titles">
        <span className="tfg-title">Time &amp; fees</span>
        {density !== 'narrow' ? (
          <span className="tfg-subtitle">
            {peopleCount} {peopleCount === 1 ? 'person' : 'people'} &middot; {periodCount} {periodCount === 1 ? 'period' : 'periods'} &middot;{' '}
            {hoursTotal > 0 ? `${formatHours(hoursTotal)}h booked` : 'no hours booked yet'}
            {outsideWindowHours > 0 ? ` + ${formatHours(outsideWindowHours)}h outside the window` : ''}
          </span>
        ) : null}
      </span>

      <div className="tfg-segmented" role="radiogroup" aria-label="Timeline phasing" onKeyDown={onPhasingKeyDown}>
        {PHASINGS.map((option, index) => (
          <button
            key={option}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={phasing === option}
            tabIndex={phasing === option ? 0 : -1}
            className="tfg-seg"
            title={`Group the timeline by ${PHASING_LABELS[option].toLowerCase()} periods`}
            onClick={() => props.onPhasingChange(option)}
          >
            {PHASING_LABELS[option]}
          </button>
        ))}
      </div>

      <span
        className="tfg-chip tfg-chip--info"
        title={`Pricing is set by the app: ${PRICING_LABELS[pricingMethod]} ${
          pricingMethod === 'manualRate' ? 'lets you type RPH, and derives the realisation' : 'lets you type the realisation, and derives RPH'
        }`}
      >
        {PRICING_LABELS[pricingMethod]}
      </span>

      <span className="tfg-toolbar__spacer" />

      {readOnly ? <span className="tfg-chip" title="The app is in view mode; hours cannot be edited">View only</span> : null}

      <button
        type="button"
        className="tfg-btn tfg-btn--primary"
        disabled={readOnly}
        onClick={props.onAddStaff}
        title="Ask the app to add a person to this workstream"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
          <path d="M8 2a1 1 0 0 1 1 1v4h4a1 1 0 1 1 0 2H9v4a1 1 0 1 1-2 0V9H3a1 1 0 1 1 0-2h4V3a1 1 0 0 1 1-1z" fill="currentColor" />
        </svg>
        Add staff
      </button>

      <button
        type="button"
        className="tfg-iconbtn"
        aria-expanded={helpOpen}
        onClick={props.onToggleHelp}
        title="Keyboard shortcuts and how hours, fees and margins are calculated"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM7.25 11.5v-1.5h1.5v1.5h-1.5zm1.6-2.7v.4h-1.5v-.72c0-.9.6-1.3 1.1-1.6.4-.3.7-.5.7-.9 0-.4-.35-.7-.85-.7-.5 0-.9.3-1.1.8l-1.3-.6A2.5 2.5 0 0 1 8.3 3.5c1.3 0 2.4.8 2.4 2.1 0 .9-.6 1.4-1.2 1.8-.3.2-.65.45-.65 1.4z"
            fill="currentColor"
          />
        </svg>
        <span className="tfg-sr">Help</span>
      </button>
    </div>
  );
}
