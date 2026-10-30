# TimeFeesGrid test script

Run this in the canvas app after importing a new build. Steps marked **(auto)** are also covered by
`npm test` (`tests/scenarios.test.ts`, `tests/componentEcho.test.ts`). The rest need Power Apps.

Setup: the app's usual workstream screen with the component bound to `colPeopleAllocated`,
`AddColumns(colAllocatedHours, PersonName, Name, AllocationDate, Date)` and `colWorkstreamTimeline`,
and the OnChange formula writing every action back to the collections.

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | Wednesday start **(auto)** | Set the workstream start to a Wednesday (e.g. 7 Jan 2026), 2 weeks. Open Weekly. | Columns are Monday-to-Friday weeks keyed by their Monday, numbered from the start of the workstream: W1 (07 Jan, 3 working days, 24h capacity), W2 (5 days), W3 (2 days). |
| 2 | Weekly to daily **(auto)** | Book 20h in one week, then switch to Daily. | 4h on each of the five working days (spread evenly; any remainder sits on the last day, e.g. 10h over 3 days = 3.33, 3.33, 3.34). |
| 3 | Monthly spanning weeks **(auto)** | Start 28 Dec 2026. Book 40h in W1, switch to Monthly. | Dec 26 shows 32h, Jan 27 shows 8h. The ⓘ next to Daily/Weekly/Monthly reads "Working days = Mon–Fri, public holidays not excluded." |
| 4 | Fill **(auto)** | Book hours in the first week of a person, press the arrow in the Fill column (between REAL% and the first week). | Every following week shows the same total, spread evenly; a short week that cannot hold it is flagged amber. `colAllocatedHours` holds one row per working day for that person, and the grid still shows every booked week (also with more than 500 booking rows). |
| 5 | Start-date shift **(auto)** | With hours booked in week 1, move the start one week later. | Week 1 hours leave the grid and the toolbar shows a "Nh outside the window" chip. Click it: only people with such hours remain and their Hours cell is highlighted; hovering it lists the dates. Click again to show everyone. The hours stay in `colAllocatedHours`. |
| 6 | Save and reopen | Make edits (hours, Fill, RPH), save the workstream, leave the screen and reopen it (or reload the app). | The grid shows exactly what was saved. Opening the screen fires OnChange only with the action `heightChanged`, which the formula ignores; no collection changes. |
| 7 | Read-only user | Open the workstream as a user with view rights only (component `ReadOnly = true`). | "View only" chip shows; Add staff, Fill and Remove are disabled or hidden; typing into a cell does nothing; Delete does not clear. |
| 8 | Holidays (optional) | Set Public holidays to `["2026-12-25","2026-12-28"]`. | Those days take no hours; the week of 21 Dec has 32h capacity; the monthly ⓘ reads "excluding 2 public holidays". |
| 9 | Formats **(auto)** | Book enough hours for a total over 1,000. | Rates and hours show `1,039`; every figure in the totals row has one decimal place (`125.0`, `18.7`, `96.1%`). |
| 10 | Empty state | Remove every person. | "No people added yet - use Add staff to book hours." |
| 11 | Copy and paste | Drag across some hour cells (or Shift+arrows), press Ctrl+C and paste into Excel. Copy a block from Excel, click a cell in the grid and press Ctrl+V. Select a block, copy one value and paste it over the block. Select a block and press Delete, then Ctrl+X. | Excel receives plain numbers. The pasted block lands from the clicked cell, text cells are skipped (the status line says how many), and the app receives one hoursChanged. One value fills the whole selection. Delete and Ctrl+X clear the block in one hoursCleared. Inside an open cell editor, Ctrl+C/V copy and paste text as usual. |
| 12 | Five-person height | With `Height = Self.requiredHeight`, add people one at a time up to seven. | The control grows with each person up to five, then stays the same height; the header and TOTAL row stay pinned while the rows scroll. |
| 13 | Keyboard jumps | From a week cell press Ctrl+Right, Ctrl+Left, Ctrl+Down, Ctrl+Up. Then Ctrl+Shift+Right and Ctrl+Shift+Down, and copy. Click a cell in Hours, Fee (k) or GM%. | Ctrl+arrows land on the last week, the first week, the last person and the first person. Ctrl+Shift selects up to those edges, and the copy holds only those cells. Hours, Fee (k) and GM% cannot be focused, selected or copied. |
| 14 | Total at the bottom | Make the control taller than it needs, with two people. Then add people past five. | TOTAL stays against the bottom of the control with empty space above it. With more than five people it stays there while the rows scroll. |
| 15 | Add staff colours | Hover and press Add staff next to Add Other Fee. | Both go to the same darker blue on hover (`#115EA3`) and on press (`#0C3B5E`), and the white label stays readable. |
