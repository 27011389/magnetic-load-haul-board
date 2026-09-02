type BoardResponseSafety = {
  responseVersion: number;
  currentVersion: number;
  requestSaveRevision: number;
  currentSaveRevision: number;
  isSaving: boolean;
  isDragging: boolean;
  isEditing: boolean;
  isKeyboardMoving: boolean;
};

type BoardWriteCompatibility = "compatible" | "missing-version" | "layout-mismatch";

export function getBoardWriteCompatibility(
  baseVersion: unknown,
  requestedLayoutVersion: number,
  supportedLayoutVersion: number,
): BoardWriteCompatibility {
  if (!Number.isInteger(baseVersion) || (baseVersion as number) < 1) return "missing-version";
  if (requestedLayoutVersion !== supportedLayoutVersion) return "layout-mismatch";
  return "compatible";
}

/**
 * A poll may finish after a local edit or a newer server response. Only a
 * strictly newer response captured during an idle period is safe to display.
 */
export function shouldApplyBoardResponse({
  responseVersion,
  currentVersion,
  requestSaveRevision,
  currentSaveRevision,
  isSaving,
  isDragging,
  isEditing,
  isKeyboardMoving,
}: BoardResponseSafety) {
  return Number.isInteger(responseVersion) &&
    responseVersion > currentVersion &&
    requestSaveRevision === currentSaveRevision &&
    !isSaving &&
    !isDragging &&
    !isEditing &&
    !isKeyboardMoving;
}
