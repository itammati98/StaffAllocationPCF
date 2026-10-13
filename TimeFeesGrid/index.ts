import * as React from 'react';
import { IInputs, IOutputs } from './generated/ManifestTypes';
import { TimeFeesGridApp } from './src/components/TimeFeesGridApp';
import {
  AdapterDatasets,
  clampHoursPerDay,
  clampWeeks,
  outputSignature,
  readSnapshot,
  snapshotSignature,
} from './src/datasetAdapter';
import { colorsEqual, DEFAULT_COLORS, GridColors, readColors } from './src/colors';
import { toDate, toNumber } from './src/engine';
import { GridHostInputs, GridOutput, GridSnapshot, Phasing, PricingMethod, TimeFeesGridAppProps } from './src/types';

/** Enum option order must match the manifest: Daily, Weekly, Monthly. */
const PHASINGS: readonly Phasing[] = ['daily', 'weekly', 'monthly'];

/** Records requested per page: a year of daily bookings for a large team fits in one page. */
const PAGE_SIZE = 5000;
/** Upper bound on consecutive page requests before the grid reads whatever has arrived. */
const MAX_PAGE_REQUESTS = 50;

/**
 * Static schema for the Changes output. Canvas apps read it through getOutputSchema so makers get
 * type-ahead on `Component.Changes`, and it is echoed back through the hidden dataSchema property.
 */
const CHANGES_SCHEMA = {
  $schema: 'http://json-schema.org/draft-04/schema#',
  title: 'Changes',
  type: 'object',
  properties: {
    revision: { type: 'integer' },
    action: { type: 'string' },
    personName: { type: 'string' },
    allocations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          Name: { type: 'string' },
          Date: { type: 'string', format: 'date' },
          Value: { type: 'integer' },
          Weekday: { type: 'integer' },
          WeekNum: { type: 'integer' },
          MonthNum: { type: 'integer' },
          YearNum: { type: 'integer' },
          HoursWorked: { type: 'number' },
        },
      },
    },
    people: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          Name: { type: 'string' },
          JobLevel: { type: 'string' },
          Team: { type: 'string' },
          CostRate: { type: 'number' },
          FeeRate: { type: 'number' },
          RPH: { type: 'number' },
          Realisation: { type: 'number' },
          JobLevelOrder: { type: 'integer' },
          IsToBeAdded: { type: 'boolean' },
          CurrencyID: { type: 'string' },
        },
      },
    },
  },
};
const CHANGES_SCHEMA_JSON = JSON.stringify(CHANGES_SCHEMA);

/**
 * Time & fees allocation grid.
 *
 * Reads the three workstream tables bound as datasets, hands a plain domain snapshot to the React
 * grid, and publishes every change back to the host through the Changes object output.
 */
export class TimeFeesGrid implements ComponentFramework.ReactControl<IInputs, IOutputs> {
  private notifyOutputChanged: () => void = () => undefined;
  private latest: GridOutput | null = null;
  /** Cached so a re-read of unchanged outputs is the same object and never fires OnChange again. */
  private outputs: IOutputs | null = null;
  private lastSignature = '';
  /** Signature of the payload the component last published, i.e. of what the host echoes back. */
  private echoSignature = '';
  private snapshotVersion = 0;
  private snapshot: GridSnapshot | null = null;
  private colors: GridColors = DEFAULT_COLORS;
  /** Datasets whose page size has already been raised. */
  private readonly pageSized = new Set<string>();
  /** Consecutive page requests made without the datasets becoming complete. */
  private pageRequests = 0;

  public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void): void {
    this.notifyOutputChanged = notifyOutputChanged;
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    const host = this.readHostInputs(context);
    const datasets = this.readDatasets(context);

    // A canvas host delivers a dataset one page at a time, and Fill multiplies the booking rows
    // (one per person per working day) well past the default page. A partial delivery must never
    // rebase the grid - it would drop every booking beyond the first page - so keep showing what
    // the grid already holds and wait for the remaining pages.
    const complete = this.requestAllRecords(datasets);
    if (!complete && this.snapshot !== null) {
      return this.render(host, this.snapshot);
    }

    const parsed = readSnapshot(datasets, host);
    const signature = snapshotSignature(parsed);

    // A canvas app re-delivers every bound dataset whenever any of its collections changes, so most
    // updateView calls carry data the grid is already showing. Only a snapshot the grid has not seen
    // - and that is not its own published change coming back - rebases the editor state; anything
    // else reuses the previous snapshot, which keeps the props (and so the rendered grid) stable.
    let rebased = false;
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      if (signature === this.echoSignature) {
        // The host wrote the last change back into its collections: the grid already holds it.
        this.echoSignature = '';
      } else {
        rebased = true;
        this.snapshotVersion += 1;
        // The host owns the data it re-delivered, and screen navigation re-delivers it constantly,
        // so nothing is published here: the app's OnChange must not fire just because a screen was
        // shown. The outputs keep describing the last change the user made, and the next edit
        // republishes from the rebased state.
        this.echoSignature = '';
      }
    }

    let snapshot = this.snapshot;
    if (rebased || snapshot === null) {
      snapshot = parsed;
      this.snapshot = parsed;
    }

    return this.render(host, snapshot);
  }

  private render(host: GridHostInputs, snapshot: GridSnapshot): React.ReactElement {
    const appProps: TimeFeesGridAppProps = {
      host,
      snapshot,
      snapshotVersion: this.snapshotVersion,
      onChange: this.handleChange,
    };
    return React.createElement(TimeFeesGridApp, appProps);
  }

  /**
   * Asks the host for every record of every bound dataset: raises the page size once, then loads
   * any further page. Returns false while a dataset is still loading or has records left to fetch.
   * After `MAX_PAGE_REQUESTS` consecutive incomplete deliveries the data is taken as it is, so a
   * host that keeps reporting another page (or keeps loading) can never freeze the grid.
   */
  private requestAllRecords(datasets: AdapterDatasets): boolean {
    if (this.pageRequests >= MAX_PAGE_REQUESTS) {
      this.pageRequests = 0;
      return true;
    }
    let complete = true;
    for (const [name, dataset] of Object.entries(datasets) as [string, ComponentFramework.PropertyTypes.DataSet | undefined][]) {
      if (!dataset) continue;
      try {
        if (dataset.loading === true) {
          this.pageRequests += 1;
          complete = false;
          continue;
        }
        const paging = dataset.paging;
        if (!paging) continue;
        if (!this.pageSized.has(name) && typeof paging.setPageSize === 'function') {
          this.pageSized.add(name);
          if (!(paging.pageSize >= PAGE_SIZE)) {
            paging.setPageSize(PAGE_SIZE);
            dataset.refresh();
            this.pageRequests += 1;
            complete = false;
            continue;
          }
        }
        if (paging.hasNextPage === true) {
          paging.loadNextPage();
          this.pageRequests += 1;
          complete = false;
        }
      } catch {
        // A host without paging support delivers everything it has; read it as it is.
      }
    }
    if (complete) this.pageRequests = 0;
    return complete;
  }

  public getOutputs(): IOutputs {
    // `dataSchema` is declared as a hidden input and echoed back with the schema so that canvas
    // apps can type-check the object output; the platform reads it from here. The object is kept
    // so that re-reading unchanged outputs cannot be mistaken for a new change.
    this.outputs ??= {
      dataSchema: CHANGES_SCHEMA_JSON,
      changes: this.latest ?? undefined,
      changesJson: this.latest === null ? '' : JSON.stringify(this.latest),
    } as IOutputs;
    return this.outputs;
  }

  /** Canvas apps ask for the schema before the control initialises. */
  public async getOutputSchema(_context: ComponentFramework.Context<IInputs>): Promise<Record<string, unknown>> {
    return Promise.resolve({ changes: CHANGES_SCHEMA });
  }

  public destroy(): void {
    this.latest = null;
    this.outputs = null;
    this.snapshot = null;
  }

  private handleChange = (output: GridOutput): void => {
    this.latest = output;
    this.outputs = null;
    // Remember what this change looks like once the app has written it into its collections, so
    // the dataset refresh that follows is recognised as an echo instead of new data.
    if (this.snapshot !== null) {
      this.echoSignature = outputSignature(output, this.snapshot);
    }
    this.notifyOutputChanged();
  };

  private readDatasets(context: ComponentFramework.Context<IInputs>): AdapterDatasets {
    // Canvas apps expose the primary dataset as `Items` and name secondary ones after the dataset.
    const parameters = context.parameters as unknown as Record<string, ComponentFramework.PropertyTypes.DataSet | undefined>;
    return {
      people: parameters.gridPeople ?? parameters.Items,
      allocations: parameters.gridAllocations ?? parameters.gridAllocations_Items,
      timeline: parameters.gridTimeline ?? parameters.gridTimeline_Items,
    };
  }

  private readHostInputs(context: ComponentFramework.Context<IInputs>): GridHostInputs {
    const parameters = context.parameters;
    const weeks = toNumber(parameters.numberOfWeeks?.raw);
    const hoursPerDay = toNumber(parameters.hoursPerDay?.raw);
    const workstreamStart = parameters.workstreamStart;
    // The palette is only replaced when a colour actually changed, so the React app keeps its
    // memoised style object across the host's repeated dataset pushes.
    const colors = readColors(
      (name) => (parameters as unknown as Record<string, { raw?: unknown } | undefined>)[name]?.raw,
    );
    if (!colorsEqual(colors, this.colors)) {
      this.colors = colors;
    }
    return {
      workstreamStart: toDate(workstreamStart ? workstreamStart.raw : null),
      numberOfWeeks: weeks > 0 ? clampWeeks(weeks) : 6,
      hoursPerDay: hoursPerDay > 0 ? clampHoursPerDay(hoursPerDay) : 8,
      phasing: readEnum(parameters.phasing, PHASINGS, 'weekly'),
      pricingMethod: readPricingMethod(parameters.pricingMethod),
      readOnly: readBoolean(parameters.readOnly?.raw),
      // The grid shows the dataset warnings unless the app turns them off.
      showNotifications: parameters.showNotifications?.raw === undefined || parameters.showNotifications?.raw === null
        ? true
        : readBoolean(parameters.showNotifications.raw),
      // The pricing chip is shown unless the app turns it off.
      showPricingBadge: parameters.showPricingBadge?.raw === undefined || parameters.showPricingBadge?.raw === null
        ? true
        : readBoolean(parameters.showPricingBadge.raw),
      colors: this.colors,
    };
  }
}

/** Enum properties arrive as an option index or as a label, depending on the host. */
function readEnum<T extends string>(
  parameter: { raw?: unknown; formatted?: string } | undefined,
  names: readonly T[],
  fallback: T,
): T {
  if (parameter) {
    const candidates: string[] = [];
    if (typeof parameter.raw === 'string') candidates.push(parameter.raw);
    if (typeof parameter.formatted === 'string') candidates.push(parameter.formatted);
    for (const candidate of candidates) {
      const normalised = candidate.replace(/[\s_-]/g, '').toLowerCase();
      const match = names.find((name) => name.replace(/[\s_-]/g, '').toLowerCase() === normalised);
      if (match !== undefined) return match;
    }
    if (typeof parameter.raw === 'number' && parameter.raw >= 0 && parameter.raw < names.length) {
      return names[parameter.raw];
    }
  }
  return fallback;
}

/**
 * Pricing mode arrives as text so the app can drive it from a formula. Anything that mentions
 * "realisation" selects the realisation mode; everything else (including unset) is the manual rate.
 */
function readPricingMethod(parameter: { raw?: unknown; formatted?: string } | undefined): PricingMethod {
  const raw = parameter ? parameter.raw : undefined;
  const text = typeof raw === 'string' ? raw : typeof parameter?.formatted === 'string' ? parameter.formatted : '';
  const normalised = text.replace(/[\s_-]/g, '').toLowerCase();
  return normalised.includes('realis') ? 'realisationAdjustment' : 'manualRate';
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 1 || String(value).toLowerCase() === 'true';
}
