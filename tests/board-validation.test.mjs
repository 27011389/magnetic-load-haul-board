import assert from "node:assert/strict";
import test from "node:test";

import { defaultMagneticBoard } from "../app/board-data.ts";
import { isBoardState, isMagnetTemplate } from "../app/board-validation.ts";

test("accepts the complete default board and a valid rack template", () => {
  assert.equal(isBoardState(defaultMagneticBoard), true);
  assert.equal(isMagnetTemplate({
    kind: "truck",
    primary: "DT63",
    tone: "white",
    width: 46,
    height: 20,
  }), true);
});

test("allows only the reserved shift note to be cleared", () => {
  const board = structuredClone(defaultMagneticBoard);
  board.magnets.find((magnet) => magnet.id === "shift-note").primary = "";
  assert.equal(isBoardState(board), true);

  const ordinaryNote = structuredClone(board.magnets.find((magnet) => magnet.id === "shift-note"));
  ordinaryNote.id = "empty-ordinary-note";
  board.magnets.push(ordinaryNote);
  assert.equal(isBoardState(board), false);

  assert.equal(isMagnetTemplate({
    kind: "note",
    primary: "",
    tone: "white",
    width: 120,
    height: 20,
  }), false);
});

test("rejects incomplete or non-finite magnet geometry", () => {
  const missingWidth = structuredClone(defaultMagneticBoard);
  delete missingWidth.magnets[0].width;
  assert.equal(isBoardState(missingWidth), false);

  const invalidCoordinate = structuredClone(defaultMagneticBoard);
  invalidCoordinate.magnets[0].x = Number.POSITIVE_INFINITY;
  assert.equal(isBoardState(invalidCoordinate), false);
});

test("rejects unsupported magnet values and malformed optional board fields", () => {
  const invalidKind = structuredClone(defaultMagneticBoard);
  invalidKind.magnets[0].kind = "spaceship";
  assert.equal(isBoardState(invalidKind), false);

  const invalidInventory = structuredClone(defaultMagneticBoard);
  invalidInventory.customInventory = [{ primary: "DT63" }];
  assert.equal(isBoardState(invalidInventory), false);

  const invalidTimestamp = structuredClone(defaultMagneticBoard);
  invalidTimestamp.updatedAt = "not a date";
  assert.equal(isBoardState(invalidTimestamp), false);
});

test("allows duplicate IDs to load so the client migration can repair them", () => {
  const repairable = structuredClone(defaultMagneticBoard);
  repairable.magnets[1].id = repairable.magnets[0].id;
  assert.equal(isBoardState(repairable), true);
});

test("accepts operational notes, statuses, handovers and history", () => {
  const board = structuredClone(defaultMagneticBoard);
  board.magnets[0].equipmentStatus = "workshop";
  board.magnets[0].parkedFromShift = "day";
  board.magnets[0].note = "Inspect before shift";
  const state = {
    boardDate: board.boardDate,
    roster: board.roster,
    workSectionCount: board.workSectionCount,
    magnets: structuredClone(board.magnets),
  };
  board.snapshots = [{ id: "snapshot-1", name: "Handover", createdAt: board.updatedAt, createdBy: "CONTROL", state }];
  board.historyVersions = [{ id: "history-1", action: "Moved DT63", createdAt: board.updatedAt, createdBy: "CONTROL", state }];
  board.auditLog = [{ id: "history-1", action: "Moved DT63", createdAt: board.updatedAt, createdBy: "CONTROL" }];
  assert.equal(isBoardState(board), true);
});

test("rejects unknown equipment status and malformed history", () => {
  const invalidStatus = structuredClone(defaultMagneticBoard);
  invalidStatus.magnets[0].equipmentStatus = "missing";
  assert.equal(isBoardState(invalidStatus), false);

  const invalidParkedShift = structuredClone(defaultMagneticBoard);
  invalidParkedShift.magnets[0].parkedFromShift = "afternoon";
  assert.equal(isBoardState(invalidParkedShift), false);

  const invalidHistory = structuredClone(defaultMagneticBoard);
  invalidHistory.historyVersions = [{ id: "history-1" }];
  assert.equal(isBoardState(invalidHistory), false);
});
