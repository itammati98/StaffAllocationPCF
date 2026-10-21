import { DEFAULT_COLORS } from '../TimeFeesGrid/src/colors';
import {
  addDays,
  allocationKey,
  buildColumns,
  buildTimeline,
  createStore,
  realisationFromRph,
  setColumnHours,
  startOfWeek,
  toDateKey,
} from '../TimeFeesGrid/src/engine';
import type {
  AllocationEntry,
  AllocationStore,
  GridHostInputs,
  PersonRow,
  TimelineDay,
} from '../TimeFeesGrid/src/types';

const WORKSTREAM_START = startOfWeek(new Date(2026, 0, 5));
const NUMBER_OF_WEEKS = 12;
const HOURS_PER_DAY = 8;

export const mockPeople: PersonRow[] = [
  {
    key: 'person-alice',
    name: 'Alice Adams',
    jobLevel: 'Snr Consultant',
    team: 'Consulting',
    costRate: 55,
    feeRate: 190,
    rph: 180,
    realisation: realisationFromRph(180, 190),
    jobLevelOrder: 0,
    isToBeAdded: false,
    currencyId: 'GBP',
  },
  {
    key: 'person-bob',
    name: 'Bob Brown',
    jobLevel: 'Consultant',
    team: 'Consulting',
    costRate: 45,
    feeRate: 150,
    rph: 140,
    realisation: realisationFromRph(140, 150),
    jobLevelOrder: 1,
    isToBeAdded: false,
    currencyId: 'GBP',
  },
  {
    key: 'person-carol',
    name: 'Carol Clarke',
    jobLevel: 'Research Analyst',
    team: 'Research',
    costRate: 30,
    feeRate: 95,
    rph: 90,
    realisation: realisationFromRph(90, 95),
    jobLevelOrder: 2,
    isToBeAdded: false,
    currencyId: 'GBP',
  },
  {
    key: 'person-dan',
    name: 'Dan Davies',
    jobLevel: 'Consultant',
    team: 'Delivery',
    costRate: 45,
    feeRate: 150,
    rph: 150,
    realisation: realisationFromRph(150, 150),
    jobLevelOrder: 1,
    isToBeAdded: false,
    currencyId: 'GBP',
  },
  {
    key: 'person-erin',
    name: 'Erin Evans',
    jobLevel: 'Research Analyst',
    team: 'Research',
    costRate: 30,
    feeRate: 95,
    rph: 95,
    realisation: realisationFromRph(95, 95),
    jobLevelOrder: 2,
    isToBeAdded: false,
    currencyId: 'GBP',
  },
  {
    key: 'person-frank',
    name: 'Frank Foster',
    jobLevel: 'Snr Consultant',
    team: 'Delivery',
    costRate: 55,
    feeRate: 190,
    rph: 175,
    realisation: realisationFromRph(175, 190),
    jobLevelOrder: 0,
    isToBeAdded: false,
    currencyId: 'GBP',
  },
];

export const mockTimeline: TimelineDay[] = buildTimeline(WORKSTREAM_START, NUMBER_OF_WEEKS);

const weeklyColumns = buildColumns(mockTimeline, 'weekly', HOURS_PER_DAY);
const dailyColumns = buildColumns(mockTimeline, 'daily', HOURS_PER_DAY);

function buildMockStore(): AllocationStore {
  let store = createStore([]);

  // Alice: a 45h week (over the 40h capacity), spread evenly.
  store = setColumnHours(store, weeklyColumns[0], 'person-alice', 45, HOURS_PER_DAY);
  // Bob: a 20h week, spread evenly over its five working days.
  store = setColumnHours(store, weeklyColumns[1], 'person-bob', 20, HOURS_PER_DAY);
  // Carol: a single 20h day in the middle of the window.
  store = setColumnHours(store, dailyColumns[10], 'person-carol', 20, HOURS_PER_DAY);
  // Dan: a full 40h week.
  store = setColumnHours(store, weeklyColumns[2], 'person-dan', 40, HOURS_PER_DAY);
  // Erin deliberately has no hours.
  // Frank: hours outside the 12-week window, after the timeline ends.
  const outsideKey = allocationKey('person-frank', toDateKey(addDays(WORKSTREAM_START, NUMBER_OF_WEEKS * 7 + 3)));
  store = new Map(store).set(outsideKey, 6);

  return store;
}

const mockStore = buildMockStore();

/**
 * colAllocatedHours as a canvas app holds it: the person column carries the person's name, which is
 * what the component resolves against the people list.
 */
export const mockAllocations: AllocationEntry[] = [...mockStore].map(([key, hours]) => {
  const index = key.lastIndexOf('|');
  const personKey = key.slice(0, index);
  return {
    personKey: mockPeople.find((person) => person.key === personKey)?.name ?? personKey,
    dateKey: key.slice(index + 1),
    hours,
  };
});

export const mockHostInputs: GridHostInputs = {
  workstreamStart: WORKSTREAM_START,
  numberOfWeeks: NUMBER_OF_WEEKS,
  hoursPerDay: HOURS_PER_DAY,
  pricingMethod: 'manualRate',
  phasing: 'weekly',
  readOnly: false,
  showNotifications: true,
  showPricingBadge: true,
  holidays: [],
  colors: DEFAULT_COLORS,
};
