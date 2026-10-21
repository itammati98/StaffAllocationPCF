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
  /** False hides the pricing chip; the app can set the mode without labelling it. */
  showPricingBadge: boolean;
  readOnly: boolean;
  peopleCount: number;
  periodCount: number;
  hoursTotal: number;
  /** Hours booked by these people outside the workstream window; shown as a warning chip. */
  outsideWindowHours: number;
  /** True while the grid shows only the people with hours outside the window. */
  outsideFilterOn: boolean;
  /** Public holidays inside the workstream window, for the working-days note in the monthly view. */
  holidayCount: number;
  onToggleOutsideFilter: () => void;
  onPhasingChange: (phasing: Phasing) => void;
  /** Asks the host application to add a person; the app owns that flow. */
  onAddStaff: () => void;
}

export function Toolbar(props: ToolbarProps): React.ReactElement {
    const { density, phasing, pricingMethod, showPricingBadge, readOnly, peopleCount, periodCount, hoursTotal, outsideWindowHours, outsideFilterOn, holidayCount } =
    props;
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

      <InfoTip lines={infoLines(phasing, holidayCount)} />

      {outsideWindowHours > 0 ? (
        <button
          type="button"
          className="tfg-chip tfg-chip--warning tfg-chip--button"
          aria-pressed={outsideFilterOn}
          onClick={props.onToggleOutsideFilter}
          title={
            outsideFilterOn
              ? 'Showing only the people with hours outside the workstream window. Click to show everyone.'
              : 'Hours booked outside the workstream window are kept untouched. Click to show only the people who have them.'
          }
        >
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
            <path d="M8 1.5 15 14H1L8 1.5zm-.75 4.5v4h1.5V6h-1.5zm0 5v1.5h1.5V11h-1.5z" fill="currentColor" />
          </svg>
          {formatHours(outsideWindowHours)}h outside the window
          {outsideFilterOn ? <span aria-hidden="true">&nbsp;&times;</span> : null}
        </button>
      ) : null}

      {showPricingBadge ? (
        <span
          className="tfg-chip tfg-chip--info"
          title={`Pricing is set by the app: ${PRICING_LABELS[pricingMethod]} ${
            pricingMethod === 'manualRate' ? 'lets you type RPH, and derives the realisation' : 'lets you type the realisation, and derives RPH'
          }`}
        >
          {PRICING_LABELS[pricingMethod]}
        </span>
      ) : null}

      <span className="tfg-toolbar__spacer" />

      {readOnly ? <span className="tfg-chip" title="The app is in view mode; hours cannot be edited">View only</span> : null}

      <button
        type="button"
        className="tfg-btn tfg-btn--primary tfg-btn--add"
        disabled={readOnly}
        onClick={props.onAddStaff}
        title="Ask the app to add a person to this workstream"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path d="M8 2a1 1 0 0 1 1 1v4h4a1 1 0 1 1 0 2H9v4a1 1 0 1 1-2 0V9H3a1 1 0 1 1 0-2h4V3a1 1 0 0 1 1-1z" fill="currentColor" />
        </svg>
        Add staff
      </button>

    </div>
  );
}

/** The ⓘ text: the working-days rule in the monthly view, then the keyboard and the calculations. */
function infoLines(phasing: Phasing, holidayCount: number): string[] {
  const lines: string[] = [];
  if (phasing === 'monthly') {
    lines.push(
      holidayCount > 0
        ? `Working days = Mon–Fri, excluding ${holidayCount} public ${holidayCount === 1 ? 'holiday' : 'holidays'}.`
        : 'Working days = Mon–Fri, public holidays not excluded.',
    );
  }
  lines.push(
    'Arrow keys move and apply the value being typed · Enter or type to edit · Esc cancels · Tab commits and moves on · Del clears.',
    'Hours spread evenly over the working days of each period. Fee = hours × RPH. GM% is margin on cost.',
  );
  return lines;
}

/** An ⓘ button whose tooltip opens on hover and on keyboard focus; Escape closes it. */
function InfoTip(props: { lines: string[] }): React.ReactElement {
  const id = React.useRef(`tfg-info-${Math.random().toString(36).slice(2, 9)}`).current;
  return (
    <span className="tfg-info">
      <button
        type="button"
        className="tfg-info__btn"
        aria-label="How the grid works"
        aria-describedby={id}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.currentTarget.blur();
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm0 1.3a5.2 5.2 0 1 0 0 10.4A5.2 5.2 0 0 0 8 2.8zM7.3 7h1.4v4.3H7.3V7zm0-2.3h1.4v1.4H7.3V4.7z"
            fill="currentColor"
          />
        </svg>
      </button>
      <span role="tooltip" id={id} className="tfg-info__tip">
        {props.lines.map((line) => (
          <span key={line} className="tfg-info__line">
            {line}
          </span>
        ))}
      </span>
    </span>
  );
}
