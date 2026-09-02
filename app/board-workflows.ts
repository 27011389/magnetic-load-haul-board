import {
  ALLOCATION_LANE_LEFT,
  ALLOCATION_LANE_RIGHT,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  PARK_UP_TOP,
  SHIFT_WIDTH,
  WORK_ROWS_TOP,
  attachableMagnetKinds,
  getWorkControlRows,
  isDiggerControl,
  isPitWorkAreaControl,
  magnetInventoryKey,
  magnetShiftSide,
  responsiveMagnetWidth,
  type BoardArchiveState,
  type BoardAuditEntry,
  type BoardHistoryEntry,
  type BoardSnapshot,
  type CrewCode,
  type Magnet,
  type MagneticBoardState,
  type MagnetTemplate,
} from "./board-data.ts";
import { claimUniqueMagnetId } from "./magnet-ids.ts";

type AllocationStats = {
  dayAllocated: number;
  dayUnallocated: number;
  nightAllocated: number;
  nightUnallocated: number;
  parked: number;
};

export type ReadinessIssue = {
  id: string;
  severity: "error" | "warning";
  title: string;
  detail: string;
  magnetId?: string;
};

type SnapshotComparison = {
  previous: AllocationStats;
  latest: AllocationStats;
  changedTrucks: string[];
};

type NextShiftOptions = {
  boardDate: string;
  dayCrew?: CrewCode;
  nightCrew?: CrewCode;
  retainShiftNote: boolean;
  actor: string;
  createdAt?: string;
};

const MAX_SNAPSHOTS = 12;
const MAX_HISTORY_VERSIONS = 10;
const MAX_AUDIT_ENTRIES = 100;

const entryId = (prefix: string, createdAt: string) =>
  `${prefix}-${Date.parse(createdAt) || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type MagnetBounds = Pick<Magnet, "x" | "y" | "width" | "height">;

const overlaps = (left: MagnetBounds, right: MagnetBounds) =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

function readinessBounds(
  magnet: Magnet,
  sectionCount: number,
  pitRows: Map<string, number>,
  diggerRows: Map<string, number>,
): MagnetBounds {
  const rowIndex = pitRows.get(magnet.id) ?? diggerRows.get(magnet.id);
  if (rowIndex === undefined) return magnet;
  const sideLeft = magnetShiftSide(magnet) === "day" ? 0 : SHIFT_WIDTH;
  const rowHeight = (PARK_UP_TOP - WORK_ROWS_TOP) / sectionCount;
  const top = Math.round(WORK_ROWS_TOP + rowIndex * rowHeight + 7);
  return pitRows.has(magnet.id)
    ? { x: sideLeft + 4, y: top, width: 128, height: 78 }
    : { x: sideLeft + 138, y: top, width: 60, height: 22 };
}

export function removeOppositeShiftAssetAfterParkUp(
  magnets: Magnet[],
  sourceMagnets: Magnet[],
  movedId: string,
) {
  const source = sourceMagnets.find((magnet) => magnet.id === movedId);
  const parked = magnets.find((magnet) => magnet.id === movedId);
  if (
    !source || !parked ||
    !attachableMagnetKinds.has(source.kind) || !attachableMagnetKinds.has(parked.kind) ||
    source.y >= PARK_UP_TOP || parked.y < PARK_UP_TOP
  ) return magnets;

  const sourceSide = magnetShiftSide(source);
  const unit = parked.primary.trim().toUpperCase();
  const removedIds = new Set(
    magnets
      .filter((magnet) =>
        magnet.id !== movedId &&
        attachableMagnetKinds.has(magnet.kind) &&
        magnet.y < PARK_UP_TOP &&
        magnetShiftSide(magnet) !== sourceSide &&
        magnet.primary.trim().toUpperCase() === unit,
      )
      .map((magnet) => magnet.id),
  );

  return magnets
    .filter((magnet) => !removedIds.has(magnet.id))
    .map((magnet) =>
      magnet.id === movedId
        ? { ...magnet, parkedFromShift: sourceSide }
        : magnet.attachedTo && removedIds.has(magnet.attachedTo)
        ? { ...magnet, attachedTo: undefined }
        : magnet,
    );
}

export const getOppositeShiftX = (magnet: Pick<Magnet, "x">) =>
  magnet.x < SHIFT_WIDTH ? magnet.x + SHIFT_WIDTH : magnet.x - SHIFT_WIDTH;

const isAllocatedTruck = (magnet: Magnet) => {
  if (magnet.kind !== "truck" || magnet.y < WORK_ROWS_TOP || magnet.y >= PARK_UP_TOP) return false;
  const sideLeft = magnet.x < SHIFT_WIDTH ? 0 : SHIFT_WIDTH;
  const centreX = magnet.x + magnet.width / 2 - sideLeft;
  return centreX >= ALLOCATION_LANE_LEFT && centreX < ALLOCATION_LANE_RIGHT;
};

export function getAllocationStats(magnets: Magnet[]): AllocationStats {
  const stats: AllocationStats = {
    dayAllocated: 0,
    dayUnallocated: 0,
    nightAllocated: 0,
    nightUnallocated: 0,
    parked: 0,
  };

  magnets.forEach((magnet) => {
    if (magnet.kind !== "truck") return;
    if (magnet.y >= PARK_UP_TOP) {
      stats.parked += 1;
      return;
    }
    const side = magnetShiftSide(magnet);
    const allocationKey = `${side}${isAllocatedTruck(magnet) ? "Allocated" : "Unallocated"}` as const;
    stats[allocationKey] += 1;
  });

  return stats;
}

function captureBoardArchiveState(board: MagneticBoardState): BoardArchiveState {
  return {
    boardDate: board.boardDate,
    roster: board.roster,
    workSectionCount: board.workSectionCount,
    magnets: board.magnets.map((magnet) => ({
      ...magnet,
      competencies: magnet.competencies ? [...magnet.competencies] : undefined,
    })),
  };
}

export function restoreBoardArchiveState(board: MagneticBoardState, state: BoardArchiveState) {
  return {
    ...board,
    boardDate: state.boardDate,
    roster: state.roster,
    workSectionCount: state.workSectionCount,
    magnets: state.magnets.map((magnet) => ({
      ...magnet,
      competencies: magnet.competencies ? [...magnet.competencies] : undefined,
    })),
  };
}

export function createBoardSnapshot(
  board: MagneticBoardState,
  name: string,
  actor: string,
  createdAt = new Date().toISOString(),
): BoardSnapshot {
  return {
    id: entryId("snapshot", createdAt),
    name: name.trim() || `${board.boardDate} · ${board.roster}`,
    createdAt,
    createdBy: actor,
    state: captureBoardArchiveState(board),
  };
}

export function appendSnapshot(board: MagneticBoardState, snapshot: BoardSnapshot) {
  return {
    ...board,
    snapshots: [...(board.snapshots ?? []), snapshot].slice(-MAX_SNAPSHOTS),
  };
}

export function appendBoardHistory(
  board: MagneticBoardState,
  action: string,
  actor: string,
  createdAt = new Date().toISOString(),
) {
  const id = entryId("history", createdAt);
  const revision: BoardHistoryEntry = {
    id,
    action,
    createdAt,
    createdBy: actor,
    state: captureBoardArchiveState(board),
  };
  const audit: BoardAuditEntry = { id, action, createdAt, createdBy: actor };
  return {
    ...board,
    historyVersions: [...(board.historyVersions ?? []), revision].slice(-MAX_HISTORY_VERSIONS),
    auditLog: [...(board.auditLog ?? []), audit].slice(-MAX_AUDIT_ENTRIES),
  };
}

const truckAssignment = (magnet: Magnet, sectionCount: number) => {
  if (!isAllocatedTruck(magnet)) return `${magnetShiftSide(magnet)}:unallocated`;
  const rowHeight = (PARK_UP_TOP - WORK_ROWS_TOP) / Math.max(1, sectionCount);
  return `${magnetShiftSide(magnet)}:row-${Math.floor((magnet.y - WORK_ROWS_TOP) / rowHeight) + 1}`;
};

export function compareBoardSnapshots(previous: BoardSnapshot, latest: BoardSnapshot): SnapshotComparison {
  const previousTrucks = new Map(previous.state.magnets
    .filter((magnet) => magnet.kind === "truck")
    .map((magnet) => [magnet.primary.trim().toUpperCase(), truckAssignment(magnet, previous.state.workSectionCount ?? 4)]));
  const latestTrucks = new Map(latest.state.magnets
    .filter((magnet) => magnet.kind === "truck")
    .map((magnet) => [magnet.primary.trim().toUpperCase(), truckAssignment(magnet, latest.state.workSectionCount ?? 4)]));
  const units = new Set([...previousTrucks.keys(), ...latestTrucks.keys()]);
  return {
    previous: getAllocationStats(previous.state.magnets),
    latest: getAllocationStats(latest.state.magnets),
    changedTrucks: [...units]
      .filter((unit) => previousTrucks.get(unit) !== latestTrucks.get(unit))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
  };
}

export function runBoardReadiness(
  board: Pick<MagneticBoardState, "magnets" | "workSectionCount">,
): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const byId = new Map(board.magnets.map((magnet) => [magnet.id, magnet]));
  const sectionCount = board.workSectionCount ?? 4;
  const pitRows = getWorkControlRows(board.magnets, sectionCount, isPitWorkAreaControl);
  const diggerRows = getWorkControlRows(board.magnets, sectionCount, isDiggerControl);
  const renderedBounds = new Map(board.magnets.map((magnet) => [
    magnet.id,
    readinessBounds(magnet, sectionCount, pitRows, diggerRows),
  ]));
  const attachedTargets = new Set(
    board.magnets.filter((magnet) => magnet.kind === "person" && magnet.attachedTo)
      .map((magnet) => magnet.attachedTo as string),
  );

  board.magnets.forEach((magnet) => {
    if (
      magnet.x < 0 || magnet.y < 0 ||
      magnet.x + magnet.width > BOARD_WIDTH || magnet.y + magnet.height > BOARD_HEIGHT
    ) {
      issues.push({ id: `bounds-${magnet.id}`, severity: "error", title: "Magnet outside board", detail: `${magnet.primary} is outside the usable board area.`, magnetId: magnet.id });
    }
    if (magnet.attachedTo) {
      const target = byId.get(magnet.attachedTo);
      if (!target || !attachableMagnetKinds.has(target.kind)) {
        issues.push({ id: `link-${magnet.id}`, severity: "error", title: "Broken operator link", detail: `${magnet.primary} is linked to equipment that no longer exists.`, magnetId: magnet.id });
      }
    }
    if (magnet.kind === "person" && magnet.y >= WORK_ROWS_TOP && magnet.y < PARK_UP_TOP && !magnet.attachedTo) {
      issues.push({ id: `operator-${magnet.id}`, severity: "error", title: "Unassigned operator", detail: `${magnet.primary} is not attached to equipment.`, magnetId: magnet.id });
    }
    if (isAllocatedTruck(magnet) && !attachedTargets.has(magnet.id)) {
      issues.push({ id: `truck-${magnet.id}`, severity: "error", title: "Truck has no operator", detail: `${magnet.primary} is allocated without an attached operator.`, magnetId: magnet.id });
    }
    if (magnet.kind === "location" && magnet.y >= WORK_ROWS_TOP && magnet.y < PARK_UP_TOP) {
      const localX = magnet.x < SHIFT_WIDTH ? magnet.x : magnet.x - SHIFT_WIDTH;
      if (localX < 130 && !magnet.secondary?.trim()) {
        issues.push({ id: `details-${magnet.id}`, severity: "warning", title: "Missing work-area details", detail: `${magnet.primary} has no RL, shot or stockpile details.`, magnetId: magnet.id });
      }
    }
    if (magnet.equipmentStatus && ["breakdown", "workshop", "fuel"].includes(magnet.equipmentStatus) && isAllocatedTruck(magnet)) {
      issues.push({ id: `status-${magnet.id}`, severity: "warning", title: "Allocated equipment needs attention", detail: `${magnet.primary} is allocated with status ${magnet.equipmentStatus.replace("-", " ").toUpperCase()}.`, magnetId: magnet.id });
    }
  });

  for (let leftIndex = 0; leftIndex < board.magnets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < board.magnets.length; rightIndex += 1) {
      const left = board.magnets[leftIndex];
      const right = board.magnets[rightIndex];
      if (overlaps(renderedBounds.get(left.id) ?? left, renderedBounds.get(right.id) ?? right)) {
        issues.push({ id: `overlap-${left.id}-${right.id}`, severity: "error", title: "Overlapping magnets", detail: `${left.primary} overlaps ${right.primary}.`, magnetId: left.id });
      }
    }
  }

  (["day", "night"] as const).forEach((side) => {
    const counts = new Map<string, Magnet[]>();
    board.magnets
      .filter((magnet) => magnet.kind === "truck" && magnet.y < PARK_UP_TOP && magnetShiftSide(magnet) === side)
      .forEach((magnet) => {
        const unit = magnet.primary.trim().toUpperCase();
        counts.set(unit, [...(counts.get(unit) ?? []), magnet]);
      });
    counts.forEach((magnets, unit) => {
      if (magnets.length > 1) issues.push({ id: `duplicate-${side}-${unit}`, severity: "error", title: "Duplicate truck", detail: `${unit} appears ${magnets.length} times on ${side.toUpperCase()} shift.`, magnetId: magnets[0].id });
    });
  });

  return issues;
}

export function getCrewInventoryTemplates(inventory: MagnetTemplate[], crew: CrewCode) {
  return inventory.filter((template) => template.kind === "person" && template.crew === crew);
}

function crewMagnets(
  board: MagneticBoardState,
  crew: CrewCode,
  side: "day" | "night",
  inventory: MagnetTemplate[],
  usedIds: Set<string>,
  startingZ: number,
) {
  const left = side === "day" ? 0 : SHIFT_WIDTH;
  const right = left + SHIFT_WIDTH;
  const availableRoster = getCrewInventoryTemplates(inventory, crew);
  const rowsPerColumn = Math.max(1, Math.ceil(availableRoster.length / 2));
  return availableRoster.map((template, index): Magnet => {
    const column = Math.floor(index / rowsPerColumn);
    const row = index % rowsPerColumn;
    const hasSavedRackOverride = board.customInventory?.some((candidate) => magnetInventoryKey(candidate) === magnetInventoryKey(template));
    const primary = hasSavedRackOverride
      ? template.primary
      : board.personnelNames?.[`${crew}:${(template.fullName ?? template.primary).trim().toUpperCase()}`] ?? template.primary;
    const width = responsiveMagnetWidth("person", primary) ?? template.width;
    return {
      ...template,
      primary,
      width,
      id: claimUniqueMagnetId(`crew-${side}-${crew.toLowerCase()}-${(template.fullName ?? template.primary).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, usedIds),
      x: right - 8 - width - column * 118,
      y: WORK_ROWS_TOP + 4 + row * 22,
      z: startingZ + index,
    };
  });
}

export function prepareNextShiftBoard(
  board: MagneticBoardState,
  inventory: MagnetTemplate[],
  options: NextShiftOptions,
) {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const snapshot = createBoardSnapshot(board, `${board.boardDate} · ${board.roster}`, options.actor, createdAt);
  let magnets = board.magnets.filter((magnet) => !(magnet.kind === "person" && magnet.y >= WORK_ROWS_TOP));
  if (!options.retainShiftNote) {
    magnets = magnets.map((magnet) => magnet.id === "shift-note" ? { ...magnet, primary: "" } : magnet);
  }
  const usedIds = new Set(magnets.map((magnet) => magnet.id));
  let nextZ = Math.max(1, ...magnets.map((magnet) => magnet.z)) + 1;
  if (options.dayCrew) {
    const placed = crewMagnets(board, options.dayCrew, "day", inventory, usedIds, nextZ);
    magnets = [...magnets, ...placed];
    nextZ += placed.length;
  }
  if (options.nightCrew) {
    const placed = crewMagnets(board, options.nightCrew, "night", inventory, usedIds, nextZ);
    magnets = [...magnets, ...placed];
  }
  return {
    ...board,
    boardDate: options.boardDate.trim().toUpperCase(),
    roster: `DAY: ${options.dayCrew ? `${options.dayCrew} CREW` : "NOT SET"} · NIGHT: ${options.nightCrew ? `${options.nightCrew} CREW` : "NOT SET"}`,
    magnets,
    snapshots: [...(board.snapshots ?? []), snapshot].slice(-MAX_SNAPSHOTS),
  };
}

export function suggestedNextBoardDate(boardDate: string) {
  const parsed = new Date(boardDate);
  if (Number.isNaN(parsed.getTime())) return boardDate;
  parsed.setDate(parsed.getDate() + 1);
  return new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" })
    .format(parsed)
    .toUpperCase();
}
