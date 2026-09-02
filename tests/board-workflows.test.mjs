import assert from "node:assert/strict";
import test from "node:test";

import {
  PARK_UP_TOP,
  WORK_ROWS_TOP,
  defaultMagneticBoard,
  magnetInventory,
} from "../app/board-data.ts";
import {
  appendBoardHistory,
  compareBoardSnapshots,
  createBoardSnapshot,
  getAllocationStats,
  getOppositeShiftX,
  prepareNextShiftBoard,
  removeOppositeShiftAssetAfterParkUp,
  runBoardReadiness,
} from "../app/board-workflows.ts";
import { isBoardState } from "../app/board-validation.ts";

const magnet = (overrides = {}) => ({
  id: "magnet-1",
  kind: "truck",
  primary: "DT63",
  x: 260,
  y: WORK_ROWS_TOP + 20,
  width: 46,
  height: 20,
  z: 1,
  tone: "white",
  ...overrides,
});

test("allocation counts use the work-area truck lane, not the fleet lane", () => {
  const stats = getAllocationStats([
    magnet({ id: "allocated", x: 260 }),
    magnet({ id: "fleet-lane", primary: "DT64", x: 540 }),
    magnet({ id: "night", primary: "DT65", x: 1260 }),
  ]);
  assert.deepEqual(stats, {
    dayAllocated: 1,
    dayUnallocated: 1,
    nightAllocated: 1,
    nightUnallocated: 0,
    parked: 0,
  });
});

test("parked trucks are excluded from day and night unallocated totals", () => {
  const stats = getAllocationStats([
    magnet({ id: "parked-day-side", x: 260, y: PARK_UP_TOP + 10 }),
    magnet({ id: "parked-night-side", x: 1260, y: PARK_UP_TOP + 10 }),
  ]);

  assert.deepEqual(stats, {
    dayAllocated: 0,
    dayUnallocated: 0,
    nightAllocated: 0,
    nightUnallocated: 0,
    parked: 2,
  });
});

test("parking an asset removes its opposite-shift copy and unlinks that copy's operator", () => {
  const dayTruck = magnet({ id: "day-truck", primary: "DT63", x: 260 });
  const nightTruck = magnet({ id: "night-truck", primary: "dt63", x: 1260 });
  const nightOperator = magnet({
    id: "night-operator",
    kind: "person",
    primary: "CASEY",
    x: 1320,
    width: 56,
    attachedTo: nightTruck.id,
  });
  const sourceMagnets = [dayTruck, nightTruck, nightOperator];
  const parkedMagnets = sourceMagnets.map((item) =>
    item.id === dayTruck.id ? { ...item, x: 120, y: PARK_UP_TOP + 5 } : item,
  );

  const result = removeOppositeShiftAssetAfterParkUp(parkedMagnets, sourceMagnets, dayTruck.id);

  assert.equal(result.some((item) => item.id === dayTruck.id), true);
  assert.equal(result.some((item) => item.id === nightTruck.id), false);
  assert.equal(result.find((item) => item.id === nightOperator.id)?.attachedTo, undefined);
  assert.equal(result.find((item) => item.id === dayTruck.id)?.parkedFromShift, "day");
});

test("moving an asset within its shift does not remove the opposite-shift copy", () => {
  const dayTruck = magnet({ id: "day-truck", x: 260 });
  const nightTruck = magnet({ id: "night-truck", x: 1260 });
  const sourceMagnets = [dayTruck, nightTruck];
  const movedMagnets = sourceMagnets.map((item) =>
    item.id === dayTruck.id ? { ...item, x: 320, y: WORK_ROWS_TOP + 80 } : item,
  );

  const result = removeOppositeShiftAssetAfterParkUp(movedMagnets, sourceMagnets, dayTruck.id);

  assert.equal(result.length, 2);
});

test("an asset returned from the bottom can be mirrored onto the other shift", () => {
  assert.equal(getOppositeShiftX(magnet({ x: 260 })), 1200);
  assert.equal(getOppositeShiftX(magnet({ x: 1260 })), 320);
});

test("readiness check finds allocation, operator, location and equipment issues", () => {
  const board = {
    ...structuredClone(defaultMagneticBoard),
    magnets: [
      magnet({ equipmentStatus: "breakdown" }),
      magnet({ id: "operator", kind: "person", primary: "CASEY", x: 620, width: 56 }),
      magnet({ id: "location", kind: "location", primary: "RHODES ROM", x: 10, width: 110 }),
    ],
  };
  const titles = runBoardReadiness(board).map((issue) => issue.title);
  assert.ok(titles.includes("Truck has no operator"));
  assert.ok(titles.includes("Unassigned operator"));
  assert.ok(titles.includes("Missing work-area details"));
  assert.ok(titles.includes("Allocated equipment needs attention"));
});

test("readiness uses rendered work-row positions but still reports genuine overlaps", () => {
  const structuredBoard = {
    ...structuredClone(defaultMagneticBoard),
    workSectionCount: 4,
    magnets: [
      magnet({ id: "pit-1", kind: "location", primary: "ORE CARTAGE", secondary: "ROM 1", x: 11, y: 598, width: 118, height: 26 }),
      magnet({ id: "pit-2", kind: "location", primary: "ORE CARTAGE", secondary: "ROM 2", x: 11, y: 599, width: 118, height: 26 }),
      magnet({ id: "digger-1", kind: "excavator", primary: "WL36", x: 154, y: 598, width: 58 }),
      magnet({ id: "digger-2", kind: "excavator", primary: "WL36", x: 154, y: 599, width: 58 }),
    ],
  };
  const structuredOverlaps = runBoardReadiness(structuredBoard)
    .filter((issue) => issue.title === "Overlapping magnets");
  assert.deepEqual(structuredOverlaps, []);

  const ordinaryBoard = {
    ...structuredClone(defaultMagneticBoard),
    magnets: [
      magnet({ id: "truck-1", primary: "DT63", x: 320, y: 300 }),
      magnet({ id: "truck-2", primary: "DT64", x: 321, y: 300 }),
    ],
  };
  const ordinaryOverlaps = runBoardReadiness(ordinaryBoard)
    .filter((issue) => issue.title === "Overlapping magnets");
  assert.equal(ordinaryOverlaps.length, 1);
  assert.equal(ordinaryOverlaps[0].detail, "DT63 overlaps DT64.");
});

test("handover comparison respects each snapshot's work-section count", () => {
  const previousBoard = {
    ...structuredClone(defaultMagneticBoard),
    workSectionCount: 4,
    magnets: [magnet({ y: WORK_ROWS_TOP + 20 })],
  };
  const latestBoard = {
    ...previousBoard,
    magnets: [magnet({ y: WORK_ROWS_TOP + 190 })],
  };
  const previous = createBoardSnapshot(previousBoard, "Previous", "CONTROL", "2026-08-22T01:00:00.000Z");
  const latest = createBoardSnapshot(latestBoard, "Latest", "CONTROL", "2026-08-22T02:00:00.000Z");
  assert.deepEqual(compareBoardSnapshots(previous, latest).changedTrucks, ["DT63"]);
});

test("persistent history retains the latest ten restorable versions", () => {
  let board = structuredClone(defaultMagneticBoard);
  for (let index = 0; index < 12; index += 1) {
    board = appendBoardHistory(board, `Change ${index}`, "CONTROL", `2026-08-22T${String(index).padStart(2, "0")}:00:00.000Z`);
  }
  assert.equal(board.historyVersions.length, 10);
  assert.equal(board.historyVersions[0].action, "Change 2");
  assert.equal(board.auditLog.length, 12);
});

test("next-shift preparation snapshots the board, retains equipment details and replaces working operators", () => {
  const board = {
    ...structuredClone(defaultMagneticBoard),
    snapshots: [],
    magnets: [
      magnet({ note: "Tyre check", equipmentStatus: "standby" }),
      magnet({ id: "old-operator", kind: "person", primary: "OLD OP", x: 620, width: 56 }),
      magnet({ id: "shift-note", kind: "note", primary: "Old note", x: 120, y: 74, width: 800, height: 24 }),
    ],
  };
  const next = prepareNextShiftBoard(board, magnetInventory, {
    boardDate: "21 JUL 2026",
    dayCrew: "A",
    nightCrew: "B",
    retainShiftNote: false,
    actor: "CONTROL",
    createdAt: "2026-08-22T02:00:00.000Z",
  });
  assert.equal(next.snapshots.length, 1);
  assert.equal(next.boardDate, "21 JUL 2026");
  assert.equal(next.magnets.some((item) => item.id === "old-operator"), false);
  assert.equal(next.magnets.find((item) => item.id === "magnet-1")?.note, "Tyre check");
  assert.equal(next.magnets.find((item) => item.id === "magnet-1")?.equipmentStatus, "standby");
  assert.equal(next.magnets.find((item) => item.id === "shift-note")?.primary, "");
  assert.equal(isBoardState(next), true);
  assert.ok(next.magnets.some((item) => item.kind === "person" && item.crew === "A"));
  assert.ok(next.magnets.some((item) => item.kind === "person" && item.crew === "B"));

  const retained = prepareNextShiftBoard(board, magnetInventory, {
    boardDate: "21 JUL 2026",
    retainShiftNote: true,
    actor: "CONTROL",
    createdAt: "2026-08-22T02:00:00.000Z",
  });
  assert.equal(retained.magnets.find((item) => item.id === "shift-note")?.primary, "Old note");
  assert.equal(isBoardState(retained), true);
});

test("next-shift crew allocation uses the edited saved rack template", () => {
  const original = magnetInventory.find((item) => item.kind === "person" && item.crew === "A");
  assert.ok(original);
  const edited = {
    ...original,
    primary: "EDITED NAME",
    tone: "blue",
    competencies: ["DOZER", "WATER CART"],
  };
  const board = {
    ...structuredClone(defaultMagneticBoard),
    magnets: [],
    customInventory: [edited],
    personnelNames: { [`A:${original.fullName.toUpperCase()}`]: "STALE BOARD NAME" },
  };
  const next = prepareNextShiftBoard(board, [edited], {
    boardDate: "21 JUL 2026",
    dayCrew: "A",
    retainShiftNote: true,
    actor: "CONTROL",
    createdAt: "2026-08-22T02:00:00.000Z",
  });
  const placed = next.magnets.find((item) => item.kind === "person");
  assert.equal(placed?.primary, "EDITED NAME");
  assert.equal(placed?.tone, "blue");
  assert.deepEqual(placed?.competencies, ["DOZER", "WATER CART"]);
});
