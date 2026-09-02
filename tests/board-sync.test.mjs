import assert from "node:assert/strict";
import test from "node:test";

import { getBoardWriteCompatibility, shouldApplyBoardResponse } from "../app/board-sync.ts";

const idleResponse = {
  responseVersion: 12,
  currentVersion: 11,
  requestSaveRevision: 4,
  currentSaveRevision: 4,
  isSaving: false,
  isDragging: false,
  isEditing: false,
  isKeyboardMoving: false,
};

test("applies a strictly newer board response while the screen is idle", () => {
  assert.equal(shouldApplyBoardResponse(idleResponse), true);
});

test("rejects an older or duplicate board response", () => {
  assert.equal(shouldApplyBoardResponse({ ...idleResponse, responseVersion: 11 }), false);
  assert.equal(shouldApplyBoardResponse({ ...idleResponse, responseVersion: 10 }), false);
});

test("rejects a response when a local save started after the request", () => {
  assert.equal(shouldApplyBoardResponse({ ...idleResponse, currentSaveRevision: 5 }), false);
  assert.equal(shouldApplyBoardResponse({ ...idleResponse, isSaving: true }), false);
});

test("does not replace the board during an active interaction", () => {
  assert.equal(shouldApplyBoardResponse({ ...idleResponse, isDragging: true }), false);
  assert.equal(shouldApplyBoardResponse({ ...idleResponse, isEditing: true }), false);
  assert.equal(shouldApplyBoardResponse({ ...idleResponse, isKeyboardMoving: true }), false);
});

test("requires version-checked writes from the current application layout", () => {
  assert.equal(getBoardWriteCompatibility(12, 15, 15), "compatible");
  assert.equal(getBoardWriteCompatibility(undefined, 15, 15), "missing-version");
  assert.equal(getBoardWriteCompatibility(12, 14, 15), "layout-mismatch");
  assert.equal(getBoardWriteCompatibility(12, 16, 15), "layout-mismatch");
});
