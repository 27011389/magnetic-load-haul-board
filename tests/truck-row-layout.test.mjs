import assert from "node:assert/strict";
import test from "node:test";

import { isCloseToAllocationLine, packTruckAllocationRow } from "../app/truck-row-layout.ts";

const magnet = (id, kind, x, y, width, attachedTo) => ({
  id,
  kind,
  primary: id.toUpperCase(),
  x,
  y,
  width,
  height: 20,
  z: 1,
  tone: "white",
  attachedTo,
});

test("only treats drops very close to the allocation line as snap candidates", () => {
  assert.equal(isCloseToAllocationLine(167, 177, 10), true);
  assert.equal(isCloseToAllocationLine(177, 177, 10), true);
  assert.equal(isCloseToAllocationLine(187, 177, 10), true);
  assert.equal(isCloseToAllocationLine(166, 177, 10), false);
  assert.equal(isCloseToAllocationLine(188, 177, 10), false);
});

test("packs allocated truck groups onto one line with small even gaps", () => {
  const magnets = [
    magnet("truck-a", "truck", 300, 182, 46),
    magnet("operator-a", "person", 352, 184, 53, "truck-a"),
    magnet("truck-b", "truck", 430, 194, 46),
  ];

  const packed = packTruckAllocationRow({
    magnets,
    truckIds: ["truck-a", "truck-b"],
    lineY: 177,
    laneLeft: 258,
    laneRight: 494,
    boardWidth: 1880,
    boardHeight: 940,
    operatorGap: 4,
    groupGap: 6,
  });

  assert.ok(packed);
  const truckA = packed.find((item) => item.id === "truck-a");
  const operatorA = packed.find((item) => item.id === "operator-a");
  const truckB = packed.find((item) => item.id === "truck-b");

  assert.deepEqual({ x: truckA.x, y: truckA.y }, { x: 258, y: 177 });
  assert.deepEqual({ x: operatorA.x, y: operatorA.y }, { x: 308, y: 177 });
  assert.deepEqual({ x: truckB.x, y: truckB.y }, { x: 367, y: 177 });
  assert.equal(operatorA.x - (truckA.x + truckA.width), 4);
  assert.equal(truckB.x - (operatorA.x + operatorA.width), 6);
});

test("leaves the row unchanged when the packed groups would not fit", () => {
  const magnets = [
    magnet("truck-a", "truck", 300, 182, 64),
    magnet("operator-a", "person", 368, 182, 60, "truck-a"),
    magnet("truck-b", "truck", 440, 182, 64),
    magnet("operator-b", "person", 508, 182, 60, "truck-b"),
  ];

  assert.equal(packTruckAllocationRow({
    magnets,
    truckIds: ["truck-a", "truck-b"],
    lineY: 177,
    laneLeft: 258,
    laneRight: 494,
    boardWidth: 1880,
    boardHeight: 940,
    operatorGap: 4,
    groupGap: 6,
  }), null);
});
