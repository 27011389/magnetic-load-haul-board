import assert from "node:assert/strict";
import test from "node:test";

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  defaultMagneticBoard,
  magnetInventory,
  moveAllocatedTruckGroupsIntoWiderLane,
  pruneHiddenWorkSectionControls,
  restoreMineHeaderMagnets,
} from "../app/board-data.ts";

const attachableKinds = new Set([
  "truck", "dozer", "grader", "watercart", "excavator",
  "loader", "lightvehicle", "support",
]);

test("default board IDs and attachment targets are internally consistent", () => {
  const ids = defaultMagneticBoard.magnets.map((magnet) => magnet.id);
  assert.equal(new Set(ids).size, ids.length, "default magnet IDs must be unique");

  const byId = new Map(defaultMagneticBoard.magnets.map((magnet) => [magnet.id, magnet]));
  defaultMagneticBoard.magnets.forEach((magnet) => {
    if (!magnet.attachedTo) return;
    const target = byId.get(magnet.attachedTo);
    assert.ok(target, `${magnet.id} must reference an existing attachment target`);
    assert.ok(attachableKinds.has(target.kind), `${magnet.id} must attach to supported equipment`);
  });
});

test("default magnets fit inside the board coordinate system", () => {
  defaultMagneticBoard.magnets.forEach((magnet) => {
    assert.ok(magnet.x >= 0 && magnet.y >= 0, `${magnet.id} starts outside the board`);
    assert.ok(magnet.x + magnet.width <= BOARD_WIDTH, `${magnet.id} exceeds the board width`);
    assert.ok(magnet.y + magnet.height <= BOARD_HEIGHT, `${magnet.id} exceeds the board height`);
  });
});

test("saved rack templates have unique type and personnel identities", () => {
  const keys = magnetInventory.map((template) => [
    template.kind,
    template.crew ?? "",
    template.fullName ?? template.primary,
  ].join(":").toUpperCase());
  assert.equal(new Set(keys).size, keys.length, "rack templates must not shadow one another");
});

test("Mine 2 and Mine 3 magnets appear in both shift headers", () => {
  const headerMagnets = defaultMagneticBoard.magnets.filter((magnet) =>
    magnet.y >= 100 && magnet.y < 170 && /^MINE [23]$/.test(magnet.primary),
  );

  assert.deepEqual(
    headerMagnets.map((magnet) => `${magnet.x < BOARD_WIDTH / 2 ? "day" : "night"}:${magnet.primary}`).sort(),
    ["day:MINE 2", "day:MINE 3", "night:MINE 2", "night:MINE 3"],
  );
  assert.equal(restoreMineHeaderMagnets(defaultMagneticBoard.magnets).length, defaultMagneticBoard.magnets.length);
});

test("wider allocation lane moves existing truck groups without moving free magnets", () => {
  const magnets = [
    { id: "truck", kind: "truck", primary: "DT63", x: 258, y: 180, width: 46, height: 20, z: 1, tone: "white" },
    { id: "operator", kind: "person", primary: "CASEY", x: 308, y: 180, width: 52, height: 20, z: 2, tone: "white", attachedTo: "truck" },
    { id: "free", kind: "truck", primary: "DT64", x: 540, y: 180, width: 46, height: 20, z: 1, tone: "white" },
  ];
  const moved = moveAllocatedTruckGroupsIntoWiderLane(magnets);
  assert.equal(moved.find((magnet) => magnet.id === "truck").x, 278);
  assert.equal(moved.find((magnet) => magnet.id === "operator").x, 328);
  assert.equal(moved.find((magnet) => magnet.id === "free").x, 540);
});

test("hidden pit and digger controls are pruned when the board has fewer sections", () => {
  const controls = [
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `pit-${index}`,
      kind: "location",
      primary: `PIT ${index}`,
      x: 11,
      y: 180 + index * 100,
      width: 118,
      height: 26,
      z: 1,
      tone: "white",
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `digger-${index}`,
      kind: "excavator",
      primary: `EX${index}`,
      x: 154,
      y: 180 + index * 100,
      width: 58,
      height: 20,
      z: 1,
      tone: "dark",
    })),
    {
      id: "hidden-operator",
      kind: "person",
      primary: "CASEY",
      x: 220,
      y: 480,
      width: 56,
      height: 20,
      z: 2,
      tone: "white",
      attachedTo: "digger-3",
    },
  ];

  const result = pruneHiddenWorkSectionControls(controls, 3);

  assert.equal(result.changed, true);
  assert.deepEqual(
    result.magnets.filter((magnet) => magnet.kind === "location").map((magnet) => magnet.id),
    ["pit-0", "pit-1", "pit-2"],
  );
  assert.deepEqual(
    result.magnets.filter((magnet) => magnet.kind === "excavator").map((magnet) => magnet.id),
    ["digger-0", "digger-1", "digger-2"],
  );
  assert.equal(result.magnets.find((magnet) => magnet.id === "hidden-operator")?.attachedTo, undefined);
});
