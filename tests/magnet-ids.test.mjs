import assert from "node:assert/strict";
import test from "node:test";

import { claimUniqueMagnetId, ensureUniqueMagnetIds } from "../app/magnet-ids.ts";

const magnet = (id, kind, primary, x, y, attachedTo) => ({
  id,
  kind,
  primary,
  x,
  y,
  width: kind === "person" ? 52 : 46,
  height: 20,
  z: 1,
  tone: "white",
  attachedTo,
});

test("claims a stable unused suffix when a generated magnet ID already exists", () => {
  const usedIds = new Set(["fleet-night-dt67", "fleet-night-dt67-2"]);
  assert.equal(claimUniqueMagnetId("fleet-night-dt67", usedIds), "fleet-night-dt67-3");
});

test("repairs duplicate IDs without removing magnets or breaking the nearest operator link", () => {
  const magnets = [
    magnet("fleet-night-dt67", "truck", "DT67", 243, 891),
    magnet("fleet-night-dt67", "truck", "DT67", 1460, 284),
    magnet("operator-dt67", "person", "OPERATOR", 1510, 284, "fleet-night-dt67"),
  ];

  const repaired = ensureUniqueMagnetIds(magnets);

  assert.equal(repaired.changed, true);
  assert.equal(repaired.magnets.length, magnets.length);
  assert.deepEqual(repaired.magnets.map((item) => item.id), [
    "fleet-night-dt67",
    "fleet-night-dt67-2",
    "operator-dt67",
  ]);
  assert.equal(repaired.magnets[2].attachedTo, "fleet-night-dt67-2");
  assert.deepEqual(
    repaired.magnets.slice(0, 2).map(({ x, y }) => ({ x, y })),
    [{ x: 243, y: 891 }, { x: 1460, y: 284 }],
  );
});
