"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  ALLOCATION_LANE_LEFT,
  ALLOCATION_LANE_RIGHT,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  SHIFT_WIDTH,
  LEGACY_ACTIVE_WIDTH,
  LEGACY_PARK_UP_TOP,
  LEGACY_WORK_ROWS_TOP,
  LEGACY_WORK_ROW_HEIGHT,
  PARK_UP_TOP,
  WORK_ROWS_TOP,
  attachableMagnetKinds,
  compactBoardY,
  compactCurrentMagnetWidths,
  compactMagnetHeight,
  expandShiftBoardX,
  getWorkControlRows,
  isDiggerControl,
  isPitWorkAreaControl,
  magnetInventoryKey,
  magnetShiftSide,
  resizeWorkSections,
  spreadFourSectionMagnets,
  responsiveMagnetWidth,
  restoreMineHeaderMagnets,
  defaultMagneticBoard,
  kindDefaults,
  magnetInventory,
  magnetKindLabels,
  moveAllocatedTruckGroupsIntoWiderLane,
  pruneHiddenWorkSectionControls,
  type Magnet,
  type BoardHistoryEntry,
  type BoardSnapshot,
  type CrewCode,
  type EquipmentStatus,
  type MagnetKind,
  type MagnetTemplate,
  type MagneticBoardState,
  type WorkSectionCount,
} from "./board-data";
import { isCloseToAllocationLine, packTruckAllocationRow } from "./truck-row-layout";
import { claimUniqueMagnetId, ensureUniqueMagnetIds } from "./magnet-ids";
import { isMagnetTemplate } from "./board-validation";
import { shouldApplyBoardResponse } from "./board-sync";
import {
  appendBoardHistory,
  appendSnapshot,
  compareBoardSnapshots,
  createBoardSnapshot,
  getCrewInventoryTemplates,
  getAllocationStats,
  getOppositeShiftX,
  prepareNextShiftBoard,
  removeOppositeShiftAssetAfterParkUp,
  restoreBoardArchiveState,
  runBoardReadiness,
  suggestedNextBoardDate,
  type ReadinessIssue,
} from "./board-workflows";

type SyncState = "loading" | "saving" | "saved" | "error";

type DragState = {
  id: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  historyBase: MagneticBoardState;
};

type CommitOptions = {
  historyBase?: MagneticBoardState;
  movedId?: string;
  recordHistory?: boolean;
  recordAudit?: boolean;
  action?: string;
};

type ShiftSide = "day" | "night";
type TvShiftView = "both" | ShiftSide;

type PresenceUser = {
  sessionId: string;
  displayName: string;
  activeMagnetId?: string;
  updatedAt: string;
};

type DuplicateTruck = {
  number: string;
  side: ShiftSide;
};

type BoardWarning = {
  title: string;
  message: string;
};

type ConfirmationPrompt = BoardWarning & {
  confirmLabel: string;
};

type RackContextMenuState = {
  template: MagnetTemplate;
  x: number;
  y: number;
};

type BoardContextMenuState = {
  magnetId: string;
  x: number;
  y: number;
};

type CursorContextAction = {
  label: string;
  description: string;
  icon: string;
  danger?: boolean;
  onSelect: () => void;
};

const ATTACH_DISTANCE = 36;
const ATTACH_GAP = 4;
const ALLOCATION_GROUP_GAP = 6;
const ALLOCATION_LANE_INSET = 6;
const ALLOCATION_SNAP_DISTANCE = 10;
const BOARD_REFRESH_INTERVAL_MS = 1_500;
const MIGRATABLE_LAYOUT_VERSIONS = new Set([3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]);
const TV_SINGLE_HEADER_HEIGHT = 120;
const TV_SINGLE_CONTENT_TOP = 100;
const TV_SINGLE_CONTENT_HEIGHT = PARK_UP_TOP - TV_SINGLE_CONTENT_TOP;
const V4_WORK_ROWS_TOP = 218;
const V4_WORK_ROW_HEIGHT = 112;
const V4_PARK_UP_TOP = 778;
const PARK_UP_ZONE_NAMES = new Set([
  "TOPVAR GO LINE",
  "RADIO HILL GO LINE",
  "CHRIS D GO LINE",
  "RADIO HILL SHUT PAD",
  "CORGAN SHUT PAD",
  "CHRIS D SHUT PAD",
  "BIG MACK SHUT PAD",
  "WORKSHOP GO LINE",
  "WORKSHOP",
  "LONG-TERM PARK-UP",
]);
const EQUIPMENT_STATUS_OPTIONS: Array<{ value: EquipmentStatus; label: string }> = [
  { value: "available", label: "AVAILABLE" },
  { value: "breakdown", label: "BREAKDOWN" },
  { value: "fuel", label: "FUEL" },
  { value: "workshop", label: "WORKSHOP" },
  { value: "standby", label: "STANDBY" },
  { value: "awaiting-operator", label: "AWAITING OPERATOR" },
];

const RACK_CONTEXT_MENU_WIDTH = 236;
const RACK_CONTEXT_MENU_HEIGHT = 158;
const BOARD_CONTEXT_MENU_HEIGHT = 210;
const RACK_CONTEXT_MENU_GUTTER = 8;
const RACK_CONTEXT_MENU_OFFSET = 6;

const rackContextStyles = {
  layer: {
    position: "fixed",
    zIndex: 2900,
    inset: 0,
    background: "transparent",
  },
  menu: {
    position: "fixed",
    width: RACK_CONTEXT_MENU_WIDTH,
    display: "grid",
    gap: 3,
    border: "1px solid #b8bfba",
    borderRadius: 8,
    background: "#f9f8f4",
    boxShadow: "0 14px 34px rgba(20, 31, 27, .3)",
    padding: 6,
  },
  header: {
    display: "grid",
    gap: 2,
    borderBottom: "1px solid #dde0da",
    padding: "5px 8px 7px",
  },
  button: {
    width: "100%",
    minHeight: 45,
    display: "grid",
    gridTemplateColumns: "22px minmax(0, 1fr)",
    alignItems: "center",
    gap: 7,
    border: "1px solid transparent",
    borderRadius: 5,
    background: "transparent",
    color: "#33453d",
    padding: "6px 8px",
    textAlign: "left",
  },
  icon: {
    width: 22,
    height: 22,
    display: "grid",
    placeItems: "center",
    borderRadius: 4,
    background: "#e7eae5",
    color: "#40534b",
    fontSize: 13,
    lineHeight: 1,
  },
  copy: {
    minWidth: 0,
    display: "grid",
    gap: 2,
  },
} satisfies Record<string, CSSProperties>;

function positionCursorContextMenu(
  clientX: number,
  clientY: number,
  menuHeight: number,
  offset = RACK_CONTEXT_MENU_OFFSET,
) {
  return {
    x: Math.max(
      RACK_CONTEXT_MENU_GUTTER,
      Math.min(clientX + offset, window.innerWidth - RACK_CONTEXT_MENU_WIDTH - RACK_CONTEXT_MENU_GUTTER),
    ),
    y: Math.max(
      RACK_CONTEXT_MENU_GUTTER,
      Math.min(clientY + offset, window.innerHeight - menuHeight - RACK_CONTEXT_MENU_GUTTER),
    ),
  };
}

const PARK_UP_ROWS = [
  { label: "GO LINE", tone: "green", zones: ["TOPVAR GO LINE", "RADIO HILL GO LINE", "CHRIS D GO LINE"] },
  { label: "SHUT PAD", tone: "red", zones: ["RADIO HILL SHUT PAD", "CORGAN SHUT PAD", "CHRIS D SHUT PAD", "BIG MACK SHUT PAD"] },
  { label: "WORKSHOP", tone: "orange", zones: ["WORKSHOP GO LINE", "WORKSHOP"] },
  { label: "STANDBY", tone: "slate", zones: ["UNALLOCATED / STANDBY"] },
  { label: "GRAVEYARD", tone: "violet", zones: ["LONG-TERM PARK-UP"] },
] as const;

// Reserve the printed lane-name area at the start of each bottom zone.
const PARK_UP_ZONE_LABEL_CLEARANCE = 150;
const PIT_WORK_AREA_OPTIONS = [
  "RADIO HILL", "BIG MACK", "CORGAN", "PALO", "CHRIS D PIT", "RHODES ROM",
  "DIRECT CART", "ORE CARTAGE", "CAMP", "MILL", "TRAINING", "U/S", "D&A",
  "TRAMMING", "ON LEAVE / SICK",
];
const DIGGER_OPTIONS = ["EX25", "EX27", "EX28", "EX29", "EX30", "EX31", "EX32"];

function parseLocationDetails(secondary?: string) {
  return {
    rl: secondary?.match(/\bRL\s*([^·|]+?)(?=\s*(?:·|\||SHOT|DIRECT ORE|$))/i)?.[1]?.trim() ?? "",
    shot: secondary?.match(/\bSHOT\s*([^·|]+?)(?=\s*(?:·|\||DIRECT ORE|$))/i)?.[1]?.trim() ?? "",
    directOreColour: secondary?.match(/\bDIRECT ORE\s*(.+)$/i)?.[1]?.trim() ?? "",
  };
}

function formatLocationDetails(rl: string, shot: string, directOreColour = "") {
  return [
    rl.trim() ? `RL ${rl.trim()}` : "",
    shot.trim() ? `SHOT ${shot.trim()}` : "",
    directOreColour.trim() ? `DIRECT ORE ${directOreColour.trim()}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

const isOreCartage = (primary: string) => primary.trim().toUpperCase() === "ORE CARTAGE";

function parseOreCartageDetails(secondary?: string) {
  return {
    stockpile: secondary?.match(/\bSTOCKPILE\s*([^·|]+?)(?=\s*(?:·|\||COLOUR|$))/i)?.[1]?.trim() ?? "",
    colour: secondary?.match(/\bCOLOUR\s*(.+)$/i)?.[1]?.trim() ?? "",
  };
}

function formatOreCartageDetails(stockpile: string, colour: string) {
  return [stockpile.trim() ? `STOCKPILE ${stockpile.trim()}` : "", colour.trim() ? `COLOUR ${colour.trim()}` : ""]
    .filter(Boolean)
    .join(" · ");
}

function PitDetailsContent({ magnet }: { magnet: Pick<Magnet, "primary" | "secondary"> }) {
  if (isOreCartage(magnet.primary)) {
    const details = parseOreCartageDetails(magnet.secondary);
    return <span className="pit-meta">{[details.stockpile, details.colour].filter(Boolean).join(" · ") || "ADD STOCKPILE / COLOUR"}</span>;
  }
  const details = parseLocationDetails(magnet.secondary);
  const location = formatLocationDetails(details.rl, details.shot);
  const directOreColours = details.directOreColour
    .split(/\s*(?:,|\/|&|\+)\s*/)
    .filter(Boolean);
  return (
    <>
      <span className="pit-meta">{location || "ADD RL / SHOT"}</span>
      {directOreColours.length > 0 && (
        <span className="pit-direct-ore">
          <b>DIRECT ORE</b>
          {directOreColours.map((colour, index) => <span key={`${colour}-${index}`}>{colour}</span>)}
        </span>
      )}
    </>
  );
}

function pitWorkAreaPosition(magnet: Pick<Magnet, "x" | "z">, sectionCount: WorkSectionCount, rowIndex: number) {
  const sideLeft = magnet.x < SHIFT_WIDTH ? 0 : SHIFT_WIDTH;
  const rowHeight = (PARK_UP_TOP - WORK_ROWS_TOP) / sectionCount;
  return {
    left: sideLeft + 4,
    top: Math.round(WORK_ROWS_TOP + rowIndex * rowHeight + 7),
    width: 128,
    height: 78,
    zIndex: magnet.z + 10,
  };
}

function diggerPosition(magnet: Pick<Magnet, "x" | "z">, sectionCount: WorkSectionCount, rowIndex: number) {
  const sideLeft = magnet.x < SHIFT_WIDTH ? 0 : SHIFT_WIDTH;
  const rowHeight = (PARK_UP_TOP - WORK_ROWS_TOP) / sectionCount;
  return {
    left: sideLeft + 138,
    top: Math.round(WORK_ROWS_TOP + rowIndex * rowHeight + 7),
    width: 60,
    height: 22,
    zIndex: magnet.z + 10,
  };
}

const cloneBoard = (board: MagneticBoardState): MagneticBoardState => ({
  ...board,
  magnets: board.magnets.map((magnet) => ({ ...magnet })),
  startingMagnets: board.startingMagnets?.map((magnet) => ({ ...magnet })),
});

const isWorkingOperator = (magnet: Magnet) =>
  magnet.kind === "person" &&
  magnet.x < BOARD_WIDTH &&
  magnet.y >= WORK_ROWS_TOP &&
  magnet.y < PARK_UP_TOP;

const PARK_UP_ZONE_RECTS = (() => {
  const innerLeft = 8;
  const innerWidth = BOARD_WIDTH - 16;
  const labelWidth = 82;
  return PARK_UP_ROWS.flatMap((row, rowIndex) => {
    const top = PARK_UP_TOP + 3 + rowIndex * 22;
    const zoneWidth = (innerWidth - labelWidth - row.zones.length * 3) / row.zones.length;
    return row.zones.map((zone, zoneIndex) => {
      const left = innerLeft + labelWidth + 3 + zoneIndex * (zoneWidth + 3);
      return { zone, left, right: left + zoneWidth, top, bottom: top + 20 };
    });
  });
})();

function countParkUpZones(magnets: Magnet[]) {
  const counts = Object.fromEntries(
    PARK_UP_ZONE_RECTS.map(({ zone }) => [zone, 0]),
  ) as Record<string, number>;

  magnets.forEach((magnet) => {
    if (!attachableMagnetKinds.has(magnet.kind)) return;
    const centreX = magnet.x + magnet.width / 2;
    const centreY = magnet.y + magnet.height / 2;
    const rect = PARK_UP_ZONE_RECTS.find((candidate) =>
      centreX >= candidate.left && centreX < candidate.right &&
      centreY >= candidate.top && centreY < candidate.bottom,
    );
    if (rect) counts[rect.zone] += 1;
  });

  return counts;
}

function snapGroupToParkUpZone(magnets: Magnet[], id: string) {
  const anchor = magnets.find((magnet) => magnet.id === id);
  if (!anchor) return null;
  const centreX = anchor.x + anchor.width / 2;
  const centreY = anchor.y + anchor.height / 2;
  const zone = PARK_UP_ZONE_RECTS.find((rect) =>
    centreX >= rect.left && centreX < rect.right && centreY >= rect.top - 2 && centreY < rect.bottom + 2,
  );
  if (!zone) return null;

  const groupIds = linkedGroupIds(magnets, id);
  const group = magnets.filter((magnet) => groupIds.has(magnet.id));
  const rightOffset = Math.max(...group.map((magnet) => magnet.x + magnet.width - anchor.x));
  const firstX = zone.left + PARK_UP_ZONE_LABEL_CLEARANCE;
  const lastX = zone.right - rightOffset - 4;
  for (let x = firstX; x <= lastX; x += 4) {
    const snapped = moveLinkedGroup(magnets, id, Math.round(x), zone.top, false);
    if (snapped) return snapped;
  }
  return null;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const personnelRosterKey = (magnet: Pick<Magnet, "crew" | "fullName" | "primary">) =>
  magnet.crew
    ? `${magnet.crew}:${(magnet.fullName ?? magnet.primary).trim().toUpperCase()}`
    : null;

const inventoryKindOrder: Record<MagnetKind, number> = {
  truck: 0,
  dozer: 1,
  grader: 2,
  watercart: 3,
  excavator: 4,
  loader: 5,
  lightvehicle: 6,
  support: 7,
  person: 8,
  location: 9,
  note: 10,
};

const compareInventoryTemplates = (left: MagnetTemplate, right: MagnetTemplate) => {
  const kindDifference = inventoryKindOrder[left.kind] - inventoryKindOrder[right.kind];
  if (kindDifference) return kindDifference;
  if (left.kind === "person" && right.kind === "person") {
    const crewDifference = (left.crew ?? "Z").localeCompare(right.crew ?? "Z");
    if (crewDifference) return crewDifference;
  }
  return left.primary.localeCompare(right.primary, undefined, { numeric: true, sensitivity: "base" });
};

const truckShiftKey = (magnet: Magnet) => {
  if (
    magnet.kind !== "truck" ||
    magnet.x < 0 ||
    magnet.x >= BOARD_WIDTH ||
    magnet.y >= PARK_UP_TOP
  ) return null;
  const side = magnetShiftSide(magnet);
  return `${side}:${magnet.primary.trim().toUpperCase()}`;
};

function findNewDuplicateTruck(previous: Magnet[], next: Magnet[]): DuplicateTruck | null {
  const counts = (magnets: Magnet[]) => {
    const result = new Map<string, number>();
    magnets.forEach((magnet) => {
      const key = truckShiftKey(magnet);
      if (key) result.set(key, (result.get(key) ?? 0) + 1);
    });
    return result;
  };
  const previousCounts = counts(previous);
  for (const [key, count] of counts(next)) {
    if (count > 1 && count > (previousCounts.get(key) ?? 0)) {
      const [side, ...numberParts] = key.split(":");
      return { side: side as ShiftSide, number: numberParts.join(":") };
    }
  }
  return null;
}

const overlaps = (a: Magnet, b: Magnet) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

const rectangleDistance = (a: Magnet, b: Magnet) => {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
  const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);
  return Math.hypot(dx, dy);
};

const isInsideBoard = (magnet: Magnet) =>
  magnet.x >= 0 && magnet.y >= 0 &&
  magnet.x + magnet.width <= BOARD_WIDTH &&
  magnet.y + magnet.height <= BOARD_HEIGHT;

const collidesWithOthers = (magnet: Magnet, magnets: Magnet[], ignoredIds = new Set<string>()) =>
  magnets.some((other) =>
    other.id !== magnet.id && !ignoredIds.has(other.id) && overlaps(magnet, other),
  );

function expandFloorRows(magnets: Magnet[]) {
  return magnets.map((magnet) => {
    if (magnet.x >= 1732) return magnet;
    if (magnet.y >= V4_WORK_ROWS_TOP && magnet.y < V4_PARK_UP_TOP) {
      const row = Math.min(4, Math.floor((magnet.y - V4_WORK_ROWS_TOP) / V4_WORK_ROW_HEIGHT));
      const offset = magnet.y - (V4_WORK_ROWS_TOP + row * V4_WORK_ROW_HEIGHT);
      return { ...magnet, y: LEGACY_WORK_ROWS_TOP + row * LEGACY_WORK_ROW_HEIGHT + offset };
    }
    if (magnet.y >= V4_PARK_UP_TOP && magnet.y < 890) {
      return { ...magnet, y: magnet.y + (LEGACY_PARK_UP_TOP - V4_PARK_UP_TOP) };
    }
    return magnet;
  });
}

function compactBoardLayout(magnets: Magnet[]) {
  return compactCurrentMagnetWidths(magnets.map((magnet) => ({
    ...magnet,
    y: compactBoardY(magnet.y, magnet.x),
    height: compactMagnetHeight(magnet.kind, magnet.height),
  })));
}

function inferNearbyAttachments(magnets: Magnet[]) {
  const claimed = new Set(
    magnets.filter((magnet) => magnet.attachedTo).map((magnet) => magnet.attachedTo as string),
  );
  let changed = false;
  const next = magnets.map((magnet) => {
    if (magnet.kind !== "person" || magnet.attachedTo) return magnet;
    const target = magnets
      .filter((candidate) => attachableMagnetKinds.has(candidate.kind) && !claimed.has(candidate.id))
      .map((candidate) => ({ candidate, distance: rectangleDistance(magnet, candidate) }))
      .filter(({ candidate, distance }) =>
        distance <= 8 && magnet.x >= candidate.x + candidate.width,
      )
      .sort((a, b) => a.distance - b.distance)[0]?.candidate;
    if (!target) return magnet;
    claimed.add(target.id);
    changed = true;
    return { ...magnet, attachedTo: target.id };
  });
  return { magnets: next, changed };
}

function linkedGroupIds(magnets: Magnet[], id: string) {
  const anchor = magnets.find((magnet) => magnet.id === id);
  return new Set([
    id,
    ...(anchor && attachableMagnetKinds.has(anchor.kind)
      ? magnets.filter((magnet) => magnet.attachedTo === id).map((magnet) => magnet.id)
      : []),
  ]);
}

function linkedGroupOverlaps(magnets: Magnet[], id: string) {
  const groupIds = linkedGroupIds(magnets, id);
  return magnets.some((magnet) =>
    groupIds.has(magnet.id) && collidesWithOthers(magnet, magnets, groupIds),
  );
}

function moveLinkedGroup(magnets: Magnet[], id: string, requestedX: number, requestedY: number, allowOverlap = false) {
  const anchor = magnets.find((magnet) => magnet.id === id);
  if (!anchor) return null;
  const groupIds = linkedGroupIds(magnets, id);
  const group = magnets.filter((magnet) => groupIds.has(magnet.id));
  const minDx = Math.max(...group.map((magnet) => -magnet.x));
  const maxDx = Math.min(...group.map((magnet) => BOARD_WIDTH - magnet.x - magnet.width));
  const minDy = Math.max(...group.map((magnet) => -magnet.y));
  const maxDy = Math.min(...group.map((magnet) => BOARD_HEIGHT - magnet.y - magnet.height));
  const dx = clamp(requestedX - anchor.x, minDx, maxDx);
  const dy = clamp(requestedY - anchor.y, minDy, maxDy);
  const moved = group.map((magnet) => ({ ...magnet, x: magnet.x + dx, y: magnet.y + dy }));
  if (!allowOverlap && moved.some((magnet) => collidesWithOthers(magnet, magnets, groupIds))) return null;
  const movedById = new Map(moved.map((magnet) => [magnet.id, magnet]));
  return magnets.map((magnet) => movedById.get(magnet.id) ?? magnet);
}

function snapTruckGroupToDiggerRow(magnets: Magnet[], truckId: string, sectionCount: WorkSectionCount) {
  const truck = magnets.find((magnet) => magnet.id === truckId && magnet.kind === "truck");
  if (!truck || truck.y < WORK_ROWS_TOP || truck.y >= PARK_UP_TOP) return null;

  const sideLeft = truck.x + truck.width / 2 < SHIFT_WIDTH ? 0 : SHIFT_WIDTH;
  const localCentreX = truck.x + truck.width / 2 - sideLeft;
  const rowHeight = (PARK_UP_TOP - WORK_ROWS_TOP) / sectionCount;
  const rowIndex = clamp(Math.floor((truck.y + truck.height / 2 - WORK_ROWS_TOP) / rowHeight), 0, sectionCount - 1);
  const rowTop = WORK_ROWS_TOP + rowIndex * rowHeight;
  const lineY = Math.round(rowTop + 7);

  if (
    localCentreX < ALLOCATION_LANE_LEFT ||
    localCentreX >= ALLOCATION_LANE_RIGHT ||
    !isCloseToAllocationLine(truck.y, lineY, ALLOCATION_SNAP_DISTANCE)
  ) return null;

  const diggerRows = getWorkControlRows(magnets, sectionCount, isDiggerControl);
  const hasDigger = magnets.some((magnet) => {
    if (!isDiggerControl(magnet)) return false;
    const diggerSideLeft = magnet.x < SHIFT_WIDTH ? 0 : SHIFT_WIDTH;
    return diggerSideLeft === sideLeft && diggerRows.get(magnet.id) === rowIndex;
  });
  if (!hasDigger) return null;

  const rowTrucks = magnets
    .filter((magnet) => {
      if (magnet.kind !== "truck") return false;
      if (magnet.id === truckId) return true;
      const magnetSideLeft = magnet.x + magnet.width / 2 < SHIFT_WIDTH ? 0 : SHIFT_WIDTH;
      const localX = magnet.x + magnet.width / 2 - magnetSideLeft;
      return magnetSideLeft === sideLeft &&
        localX >= ALLOCATION_LANE_LEFT &&
        localX < ALLOCATION_LANE_RIGHT &&
        Math.abs(magnet.y - lineY) <= 12;
    })
    .sort((left, right) => left.x - right.x || left.id.localeCompare(right.id));

  return packTruckAllocationRow({
    magnets,
    truckIds: rowTrucks.map((rowTruck) => rowTruck.id),
    lineY,
    laneLeft: sideLeft + ALLOCATION_LANE_LEFT + ALLOCATION_LANE_INSET,
    laneRight: sideLeft + ALLOCATION_LANE_RIGHT - ALLOCATION_LANE_INSET,
    boardWidth: BOARD_WIDTH,
    boardHeight: BOARD_HEIGHT,
    operatorGap: ATTACH_GAP,
    groupGap: ALLOCATION_GROUP_GAP,
  });
}

function moveGroupToNearestOpenPosition(magnets: Magnet[], id: string) {
  const anchor = magnets.find((magnet) => magnet.id === id);
  if (!anchor) return null;
  const step = 4;
  const maxRadius = Math.max(BOARD_WIDTH, BOARD_HEIGHT);
  let best: { magnets: Magnet[]; distance: number } | null = null;

  for (let radius = step; radius <= maxRadius; radius += step) {
    if (best && radius > best.distance) break;
    const offsets: Array<[number, number]> = [];
    for (let offset = -radius; offset <= radius; offset += step) {
      offsets.push([offset, -radius], [offset, radius]);
      if (Math.abs(offset) !== radius) offsets.push([-radius, offset], [radius, offset]);
    }
    offsets.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));

    for (const [dx, dy] of offsets) {
      const moved = moveLinkedGroup(magnets, id, anchor.x + dx, anchor.y + dy);
      if (!moved || linkedGroupOverlaps(moved, id)) continue;
      const movedAnchor = moved.find((magnet) => magnet.id === id);
      if (!movedAnchor) continue;
      const distance = Math.hypot(movedAnchor.x - anchor.x, movedAnchor.y - anchor.y);
      if (!best || distance < best.distance) best = { magnets: moved, distance };
    }
  }

  return best?.magnets ?? null;
}

function findOpenPosition(
  magnet: Magnet,
  magnets: Magnet[],
  preferredX: number,
  preferredY: number,
  ignoredIds = new Set<string>(),
) {
  const tryPosition = (x: number, y: number) => {
    const candidate = {
      ...magnet,
      x: clamp(Math.round(x), 0, BOARD_WIDTH - magnet.width),
      y: clamp(Math.round(y), 0, BOARD_HEIGHT - magnet.height),
    };
    return !collidesWithOthers(candidate, magnets, ignoredIds) ? candidate : null;
  };
  const preferred = tryPosition(preferredX, preferredY);
  if (preferred) return preferred;
  for (let y = WORK_ROWS_TOP; y <= BOARD_HEIGHT - magnet.height - 26; y += 10) {
    for (let x = 0; x <= BOARD_WIDTH - magnet.width; x += 10) {
      const candidate = tryPosition(x, y);
      if (candidate) return candidate;
    }
  }
  return null;
}

function findOpenPositionOnShift(
  magnet: Magnet,
  magnets: Magnet[],
  preferredX: number,
  preferredY: number,
  sideLeft: number,
) {
  const sideRight = sideLeft + SHIFT_WIDTH;
  const tryPosition = (x: number, y: number) => {
    const candidate = {
      ...magnet,
      x: clamp(Math.round(x), sideLeft, sideRight - magnet.width),
      y: clamp(Math.round(y), 0, PARK_UP_TOP - magnet.height),
    };
    return !collidesWithOthers(candidate, magnets) ? candidate : null;
  };
  const preferred = tryPosition(preferredX, preferredY);
  if (preferred) return preferred;

  let nearest: { magnet: Magnet; distance: number } | null = null;
  for (let y = 0; y <= PARK_UP_TOP - magnet.height; y += 10) {
    for (let x = sideLeft; x <= sideRight - magnet.width; x += 10) {
      const candidate = tryPosition(x, y);
      if (!candidate) continue;
      const distance = Math.hypot(candidate.x - preferredX, candidate.y - preferredY);
      if (!nearest || distance < nearest.distance) nearest = { magnet: candidate, distance };
    }
  }
  return nearest?.magnet ?? null;
}

function cleanUpTruckMagnets(magnets: Magnet[], inventory: MagnetTemplate[] = magnetInventory) {
  const truckTemplates = inventory.filter((template) => template.kind === "truck");
  const existingTrucks = magnets.filter((magnet) => magnet.kind === "truck" && magnet.y < PARK_UP_TOP);
  const retained = magnets.filter((magnet) => magnet.kind !== "truck" || magnet.y >= PARK_UP_TOP);
  const cleanedTrucks: Magnet[] = [];
  const truckPositions = new Map<string, Magnet>();
  const usedIds = new Set(magnets.map((magnet) => magnet.id));
  let nextZ = Math.max(1, ...magnets.map((magnet) => magnet.z)) + 1;

  (["day", "night"] as ShiftSide[]).forEach((side) => {
    const left = side === "day" ? 0 : SHIFT_WIDTH;
    const sideTrucks = existingTrucks.filter((magnet) => magnet.x >= left && magnet.x < left + SHIFT_WIDTH);
    const byUnit = new Map(sideTrucks.map((magnet) => [magnet.primary.toUpperCase(), magnet]));
    const parkedUnits = new Set(
      retained.filter((magnet) =>
        magnet.kind === "truck" && magnet.y >= PARK_UP_TOP && magnet.x >= left && magnet.x < left + SHIFT_WIDTH,
      ).map((magnet) => magnet.primary.toUpperCase()),
    );
    const groups: [Magnet[], Magnet[]] = [[], []];

    truckTemplates.forEach((template) => {
      if (parkedUnits.has(template.primary.toUpperCase())) return;
      const existing = byUnit.get(template.primary.toUpperCase());
      const magnet: Magnet = existing ?? {
        ...template,
        id: claimUniqueMagnetId(`fleet-${side}-${template.primary.toLowerCase()}`, usedIds),
        x: left + 520,
        y: WORK_ROWS_TOP,
        z: nextZ++,
      };
      const unitNumber = template.primary.replace(/^DT/i, "");
      const fleetColumn = unitNumber.length <= 2 ? 0 : 1;
      groups[fleetColumn].push(magnet);
    });

    // Continuous fleet lanes sit to the right of the dashed divider: 777
    // trucks, 789 trucks, AUX, then the two personnel columns.
    groups.forEach((group, column) => {
      group.sort((a, b) => a.primary.localeCompare(b.primary, undefined, { numeric: true }));
      group.forEach((magnet, index) => {
        const positioned = {
          ...magnet,
          x: left + 520 + column * 70,
          y: WORK_ROWS_TOP + 4 + index * 22,
          height: 20,
          z: nextZ++,
        };
        cleanedTrucks.push(positioned);
        truckPositions.set(positioned.id, positioned);
      });
    });
  });

  const retainedIds = new Set(cleanedTrucks.map((truck) => truck.id));
  const repositioned = retained.map((magnet) => {
    if (magnet.kind !== "person" || !magnet.attachedTo) return magnet;
    const truck = truckPositions.get(magnet.attachedTo);
    if (truck) {
      return { ...magnet, x: truck.x + truck.width + 4, y: truck.y, z: truck.z + 1 };
    }
    return retainedIds.has(magnet.attachedTo) ? magnet : { ...magnet, attachedTo: undefined };
  });

  return [...repositioned, ...cleanedTrucks];
}

const AUX_WATER_UNITS = new Set(["WC018", "WC019", "WC201"]);
const AUX_RESET_COLUMNS = [
  ["DZ014", "DZ017", "DZ018", "DZ019", "WD001"],
  ["WC019", "WC201", "WC018", "GR012", "GR013", "GR014"],
] as const;
const AUX_UNIT_ALIASES: Record<string, string> = { DZ17: "DZ017", WD14: "DZ014" };
const canonicalAuxUnit = (unit: string) => AUX_UNIT_ALIASES[unit.toUpperCase()] ?? unit.toUpperCase();
const isAuxiliaryMagnet = (magnet: Pick<Magnet, "kind" | "primary">) =>
  magnet.kind === "grader" ||
  magnet.kind === "dozer" ||
  magnet.kind === "watercart" ||
  (magnet.kind === "support" && magnet.primary.toUpperCase() === "WD001");

function resetAuxiliaryMagnetsToMiddle(magnets: Magnet[], inventory: MagnetTemplate[] = magnetInventory) {
  const auxiliaryTemplates = inventory.filter((template) =>
    template.kind === "grader" ||
    template.kind === "dozer" ||
    (template.kind === "watercart" && AUX_WATER_UNITS.has(template.primary)) ||
    (template.kind === "support" && template.primary === "WD001"),
  );
  const existingAux = magnets.filter(isAuxiliaryMagnet);
  const resettableAux = existingAux.filter((magnet) => magnet.y < PARK_UP_TOP);
  const resettableAuxIds = new Set(resettableAux.map((magnet) => magnet.id));
  const retained = magnets.filter((magnet) =>
    !isAuxiliaryMagnet(magnet) || magnet.y >= PARK_UP_TOP,
  );
  const cleanedAux: Magnet[] = [];
  const auxPositions = new Map<string, Magnet>();
  let nextZ = Math.max(1, ...magnets.map((magnet) => magnet.z)) + 1;

  (["day", "night"] as ShiftSide[]).forEach((side) => {
    const left = side === "day" ? 0 : SHIFT_WIDTH;
    const isOnSide = (magnet: Magnet) => magnet.x >= left && magnet.x < left + SHIFT_WIDTH;
    const sideAux = resettableAux.filter(isOnSide);
    const parkedUnits = new Set(
      existingAux.filter((magnet) => isOnSide(magnet) && magnet.y >= PARK_UP_TOP)
        .map((magnet) => canonicalAuxUnit(magnet.primary)),
    );
    const byUnit = new Map(sideAux.map((magnet) => [canonicalAuxUnit(magnet.primary), magnet]));
    const sideMagnets = auxiliaryTemplates.flatMap((template) => {
      if (parkedUnits.has(template.primary)) return [];
      const existing = byUnit.get(template.primary);
      return [existing ? { ...existing, kind: template.kind, primary: template.primary, tone: template.tone } : {
        ...template,
        id: `aux-${side}-${template.primary.toLowerCase()}`,
        x: left + SHIFT_WIDTH / 2,
        y: WORK_ROWS_TOP,
        z: nextZ++,
      }];
    });

    const byResetUnit = new Map(sideMagnets.map((magnet) => [magnet.primary, magnet]));
    const orderedUnits = AUX_RESET_COLUMNS.flatMap((units) => units);
    orderedUnits.filter((unit) => byResetUnit.has(unit))
      .forEach((unit, index) => {
        const magnet = byResetUnit.get(unit);
        if (!magnet) return;
        const positioned = {
          ...magnet,
          x: left + 660,
          y: WORK_ROWS_TOP + 4 + index * 22,
          height: 20,
          z: nextZ++,
        };
        cleanedAux.push(positioned);
        auxPositions.set(positioned.id, positioned);
    });
  });

  const repositioned = retained.map((magnet) => {
    if (magnet.kind !== "person" || !magnet.attachedTo) return magnet;
    const auxiliary = auxPositions.get(magnet.attachedTo);
    if (auxiliary) return { ...magnet, x: auxiliary.x + auxiliary.width + 4, y: auxiliary.y, z: auxiliary.z + 1 };
    return resettableAuxIds.has(magnet.attachedTo) ? { ...magnet, attachedTo: undefined } : magnet;
  });

  return [...repositioned, ...cleanedAux];
}

function attachPersonToNearestEquipment(magnets: Magnet[], personId: string, sectionCount: WorkSectionCount) {
  const person = magnets.find((magnet) => magnet.id === personId && magnet.kind === "person");
  if (!person) return magnets;
  const diggerRows = getWorkControlRows(magnets, sectionCount, isDiggerControl);
  const occupiedTargets = new Set(
    magnets.filter((magnet) => magnet.kind === "person" && magnet.id !== personId && magnet.attachedTo)
      .map((magnet) => magnet.attachedTo as string),
  );
  const targets = magnets
    .filter((magnet) => attachableMagnetKinds.has(magnet.kind) && !occupiedTargets.has(magnet.id))
    .map((target) => {
      const rowIndex = diggerRows.get(target.id);
      const position = rowIndex === undefined ? null : diggerPosition(target, sectionCount, rowIndex);
      const attachmentTarget = position
        ? { ...target, x: position.left, y: position.top, width: position.width, height: position.height }
        : target;
      return { target, attachmentTarget, distance: rectangleDistance(person, attachmentTarget) };
    })
    .filter(({ attachmentTarget, distance }) =>
      distance <= ATTACH_DISTANCE && person.x + person.width / 2 >= attachmentTarget.x + attachmentTarget.width,
    )
    .sort((a, b) => a.distance - b.distance);

  for (const { target, attachmentTarget } of targets) {
    const candidate = {
      ...person,
      x: attachmentTarget.x + attachmentTarget.width + ATTACH_GAP,
      y: attachmentTarget.y + (attachmentTarget.height - person.height) / 2,
      attachedTo: target.id,
      z: target.z + 1,
    };
    if (!isInsideBoard(candidate)) continue;
    if (collidesWithOthers(candidate, magnets, new Set([person.id]))) continue;
    return magnets.map((magnet) => magnet.id === person.id ? candidate : magnet);
  }
  return magnets.map((magnet) =>
    magnet.id === person.id ? { ...magnet, attachedTo: undefined } : magnet,
  );
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Australia/Perth",
  }).format(new Date(value));
}

function newMagnet(kind: MagnetKind): Magnet {
  const defaults = kindDefaults[kind];

  return {
    id: `magnet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    primary: kind === "truck" ? "DT000" : "NEW MAGNET",
    x: 760,
    y: 380,
    width: defaults.width,
    height: defaults.height,
    z: 100,
    tone: defaults.tone,
  };
}

function ActionMenu({
  label,
  children,
  variant = "quick",
}: {
  label: ReactNode;
  children: ReactNode;
  variant?: "quick" | "tool";
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`action-menu action-menu-${variant}${open ? " open" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        setOpen(false);
        event.currentTarget.querySelector<HTMLButtonElement>(".action-menu-trigger")?.focus();
      }}
    >
      <button
        className="action-menu-trigger"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}<span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div
          className="action-menu-panel"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button")) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function CursorContextMenu({
  eyebrow,
  label,
  x,
  y,
  actions,
  onClose,
}: {
  eyebrow: string;
  label: string;
  x: number;
  y: number;
  actions: CursorContextAction[];
  onClose: () => void;
}) {
  return createPortal((
    <div
      className="rack-context-layer"
      role="presentation"
      style={rackContextStyles.layer}
      onMouseDown={onClose}
      onContextMenu={(event) => { event.preventDefault(); onClose(); }}
    >
      <div
        className="rack-context-menu"
        role="menu"
        aria-label={`Actions for ${label}`}
        style={{ ...rackContextStyles.menu, left: x, top: y }}
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <header style={rackContextStyles.header}>
          <strong>{label}</strong>
          <span>{eyebrow}</span>
        </header>
        {actions.map((action, index) => (
          <button
            key={action.label}
            className={action.danger ? "menu-danger" : undefined}
            type="button"
            role="menuitem"
            autoFocus={index === 0}
            style={{
              ...rackContextStyles.button,
              ...(index > 0 ? { borderTopColor: "#e1e3de", borderRadius: 0 } : {}),
            }}
            onClick={() => {
              onClose();
              action.onSelect();
            }}
          >
            <span
              className="rack-context-icon"
              style={action.danger
                ? { ...rackContextStyles.icon, background: "#f7e8e5", color: "#9d3d32" }
                : rackContextStyles.icon}
              aria-hidden="true"
            >
              {action.icon}
            </span>
            <span className="rack-context-copy" style={rackContextStyles.copy}>
              <strong>{action.label}</strong>
              <small>{action.description}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  ), document.body);
}

export default function Home() {
  const [board, setBoard] = useState<MagneticBoardState>(defaultMagneticBoard);
  const [locked, setLocked] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [boardReady, setBoardReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [invalidDropId, setInvalidDropId] = useState<string | null>(null);
  const [editorMagnet, setEditorMagnet] = useState<Magnet | null>(null);
  const [isNewMagnet, setIsNewMagnet] = useState(false);
  const [inventoryEditingTemplate, setInventoryEditingTemplate] = useState<MagnetTemplate | null>(null);
  const [rackOpen, setRackOpen] = useState(false);
  const [rackKind, setRackKind] = useState<MagnetKind | "all">("all");
  const [rackSearch, setRackSearch] = useState("");
  const [rackContextMenu, setRackContextMenu] = useState<RackContextMenuState | null>(null);
  const [boardContextMenu, setBoardContextMenu] = useState<BoardContextMenuState | null>(null);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [undoStack, setUndoStack] = useState<MagneticBoardState[]>([]);
  const [shiftEditorOpen, setShiftEditorOpen] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [crewDialogOpen, setCrewDialogOpen] = useState(false);
  const [pitListOpen, setPitListOpen] = useState(false);
  const [diggerListOpen, setDiggerListOpen] = useState(false);
  const [pitDetailsMagnet, setPitDetailsMagnet] = useState<Magnet | null>(null);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [nextShiftOpen, setNextShiftOpen] = useState(false);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [clientSession, setClientSession] = useState({ sessionId: "", displayName: "MINE CONTROL" });
  const [warning, setWarning] = useState<BoardWarning | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationPrompt | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tvScale, setTvScale] = useState(1);
  const [tvShiftView, setTvShiftView] = useState<TvShiftView>("both");
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const keyboardHistoryRef = useRef<MagneticBoardState | null>(null);
  const stateRef = useRef(board);
  const savingRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveRevisionRef = useRef(0);
  const cancelledSaveRevisionRef = useRef(0);
  const serverVersionRef = useRef(0);
  const loadInFlightRef = useRef(false);
  const activePresenceMagnetRef = useRef<string | undefined>(undefined);
  const editorOpenRef = useRef(false);
  const confirmationResolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  useEffect(() => {
    if (!presentation) return;

    const fitBoardToScreen = () => {
      if (tvShiftView === "both") {
        setTvScale(Math.min(
          window.innerWidth / BOARD_WIDTH,
          window.innerHeight / BOARD_HEIGHT,
        ));
      } else {
        const horizontalGutter = 48;
        const verticalGutter = 24;
        setTvScale(Math.min(
          (window.innerWidth - horizontalGutter) / SHIFT_WIDTH,
          (window.innerHeight - TV_SINGLE_HEADER_HEIGHT - verticalGutter) / TV_SINGLE_CONTENT_HEIGHT,
        ));
      }
    };

    fitBoardToScreen();
    window.addEventListener("resize", fitBoardToScreen);
    return () => window.removeEventListener("resize", fitBoardToScreen);
  }, [presentation, tvShiftView]);

  useEffect(() => {
    const updateFullscreenState = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => document.removeEventListener("fullscreenchange", updateFullscreenState);
  }, []);

  const truckStats = useMemo(() => {
    return getAllocationStats(board.magnets);
  }, [board.magnets]);

  const otherPresenceUsers = useMemo(
    () => presenceUsers.filter((user) => user.sessionId !== clientSession.sessionId),
    [clientSession.sessionId, presenceUsers],
  );
  const remoteActiveMagnetIds = useMemo(
    () => new Set(otherPresenceUsers.map((user) => user.activeMagnetId).filter((id): id is string => Boolean(id))),
    [otherPresenceUsers],
  );
  const readinessIssues = useMemo(
    () => runBoardReadiness({
      magnets: board.magnets,
      workSectionCount: board.workSectionCount,
    }),
    [board.magnets, board.workSectionCount],
  );

  const effectiveInventory = useMemo(() => {
    const removed = new Set(board.removedInventory ?? []);
    const byKey = new Map<string, MagnetTemplate>();
    [...magnetInventory, ...(board.customInventory ?? [])].forEach((template) => {
      const key = magnetInventoryKey(template);
      if (!removed.has(key)) byKey.set(key, template);
    });
    return [...byKey.values()].sort(compareInventoryTemplates);
  }, [board.customInventory, board.removedInventory]);

  const filteredInventory = useMemo(() => {
    const query = rackSearch.trim().toLowerCase();
    return effectiveInventory.filter((item) =>
      (rackKind === "all" || item.kind === rackKind) &&
      (item.primary.toLowerCase().includes(query) || item.fullName?.toLowerCase().includes(query)),
    );
  }, [effectiveInventory, rackKind, rackSearch]);

  const boardSearchResults = useMemo(() => {
    const query = findQuery.trim().toLowerCase();
    if (!query) return [];
    return board.magnets.filter((magnet) =>
      magnet.primary.toLowerCase().includes(query) ||
      magnet.fullName?.toLowerCase().includes(query) ||
      magnet.secondary?.toLowerCase().includes(query),
    );
  }, [board.magnets, findQuery]);

  const boardContextMagnet = useMemo(
    () => boardContextMenu
      ? board.magnets.find((magnet) => magnet.id === boardContextMenu.magnetId) ?? null
      : null,
    [board.magnets, boardContextMenu],
  );

  const unassignedOperators = useMemo(() => board.magnets.filter((magnet) =>
    isWorkingOperator(magnet) && !magnet.attachedTo,
  ), [board.magnets]);

  const linkedMagnetIds = useMemo(() => {
    const ids = new Set<string>();
    board.magnets.forEach((magnet) => {
      if (!magnet.attachedTo) return;
      ids.add(magnet.id);
      ids.add(magnet.attachedTo);
    });
    return ids;
  }, [board.magnets]);

  const pitWorkAreaRows = useMemo(() => {
    const sectionCount = board.workSectionCount ?? 4;
    return getWorkControlRows(board.magnets, sectionCount, isPitWorkAreaControl);
  }, [board.magnets, board.workSectionCount]);
  const pitWorkAreaOptions = board.pitWorkAreas?.length ? board.pitWorkAreas : PIT_WORK_AREA_OPTIONS;
  const diggerOptions = board.diggerOptions?.length ? board.diggerOptions : DIGGER_OPTIONS;
  const diggerRows = useMemo(() => {
    const sectionCount = board.workSectionCount ?? 4;
    return getWorkControlRows(board.magnets, sectionCount, isDiggerControl);
  }, [board.magnets, board.workSectionCount]);
  const nextWorkSectionControls = useMemo(() => {
    const sectionCount = board.workSectionCount ?? 4;
    return (["day", "night"] as ShiftSide[]).map((side) => {
      const isOnSide = (magnet: Magnet) => magnetShiftSide(magnet) === side;
      const pitCount = board.magnets.filter((magnet) =>
        isPitWorkAreaControl(magnet) && isOnSide(magnet) && pitWorkAreaRows.has(magnet.id),
      ).length;
      const assetCount = board.magnets.filter((magnet) =>
        isDiggerControl(magnet) && isOnSide(magnet) && diggerRows.has(magnet.id),
      ).length;
      return {
        side,
        pitRow: pitCount < sectionCount ? pitCount : null,
        assetRow: assetCount < sectionCount ? assetCount : null,
      };
    });
  }, [board.magnets, board.workSectionCount, diggerRows, pitWorkAreaRows]);

  const parkUpCounts = useMemo(() => countParkUpZones(board.magnets), [board.magnets]);
  const totalParked = useMemo(
    () => Object.values(parkUpCounts).reduce((total, count) => total + count, 0),
    [parkUpCounts],
  );
  const tvShiftStats = tvShiftView === "night"
    ? { allocated: truckStats.nightAllocated, unallocated: truckStats.nightUnallocated }
    : { allocated: truckStats.dayAllocated, unallocated: truckStats.dayUnallocated };
  const tvShiftNote = board.magnets.find((magnet) => magnet.id === "shift-note")?.primary.trim();

  const updateBoard = useCallback((next: MagneticBoardState) => {
    stateRef.current = next;
    setBoard(next);
  }, []);

  useEffect(() => {
    const savedSessionId = window.sessionStorage.getItem("shiftboard-session-id");
    const savedDisplayName = window.sessionStorage.getItem("shiftboard-display-name");
    const sessionId = savedSessionId ?? (
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `control-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    );
    const displayName = savedDisplayName ?? `CONTROL ${sessionId.replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase()}`;
    window.sessionStorage.setItem("shiftboard-session-id", sessionId);
    window.sessionStorage.setItem("shiftboard-display-name", displayName);
    window.queueMicrotask(() => setClientSession({ sessionId, displayName }));
  }, []);

  const publishPresence = useCallback(async (activeMagnetId: string | null | undefined = activePresenceMagnetRef.current) => {
    activePresenceMagnetRef.current = activeMagnetId ?? undefined;
    if (!clientSession.sessionId) return;
    try {
      const response = await fetch("/api/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...clientSession, activeMagnetId }),
        keepalive: true,
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { users?: PresenceUser[] };
      setPresenceUsers(payload.users ?? []);
    } catch {
      // Presence is advisory; board saving continues if it is temporarily unavailable.
    }
  }, [clientSession]);

  useEffect(() => {
    if (!clientSession.sessionId) return;
    void publishPresence();
    const interval = window.setInterval(() => void publishPresence(), 5_000);
    return () => {
      window.clearInterval(interval);
      void fetch("/api/presence", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: clientSession.sessionId }),
        keepalive: true,
      }).catch(() => undefined);
    };
  }, [clientSession.sessionId, publishPresence]);

  const cancelActiveDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    void publishPresence(null);
    setInvalidDropId(null);
    updateBoard(cloneBoard(drag.historyBase));
  }, [publishPresence, updateBoard]);

  useEffect(() => {
    const cancelWhenHidden = () => {
      if (document.hidden) cancelActiveDrag();
    };
    window.addEventListener("blur", cancelActiveDrag);
    document.addEventListener("visibilitychange", cancelWhenHidden);
    return () => {
      window.removeEventListener("blur", cancelActiveDrag);
      document.removeEventListener("visibilitychange", cancelWhenHidden);
    };
  }, [cancelActiveDrag]);

  const requestConfirmation = useCallback((prompt: ConfirmationPrompt) => {
    confirmationResolverRef.current?.(false);
    setConfirmation(prompt);
    return new Promise<boolean>((resolve) => {
      confirmationResolverRef.current = resolve;
    });
  }, []);

  const closeConfirmation = useCallback((confirmed: boolean) => {
    const resolve = confirmationResolverRef.current;
    confirmationResolverRef.current = null;
    setConfirmation(null);
    resolve?.(confirmed);
  }, []);

  const commitBoard = useCallback(async (next: MagneticBoardState, options: CommitOptions = {}) => {
    if (!serverVersionRef.current) {
      setSyncState("error");
      setLoadError("The live board has not finished loading. No change was saved.");
      return;
    }
    const historyBase = cloneBoard(options.historyBase ?? stateRef.current);
    const duplicateTruck = findNewDuplicateTruck(historyBase.magnets, next.magnets);
    if (duplicateTruck) {
      updateBoard(historyBase);
      setWarning({
        title: "Duplicate truck",
        message: `${duplicateTruck.number} is already assigned to ${duplicateTruck.side === "day" ? "Day" : "Night"} shift. Each truck number can only appear once within that shift. The shared bottom section is excluded.`,
      });
      return;
    }
    if (options.recordHistory !== false) {
      setUndoStack((history) => [...history.slice(-19), historyBase]);
    }
    const now = new Date().toISOString();
    const movedMagnet = options.movedId ? next.magnets.find((magnet) => magnet.id === options.movedId) : null;
    const action = options.action ?? (movedMagnet ? `Updated ${movedMagnet.primary}` : "Updated board");
    const audited = options.recordAudit === false
      ? next
      : appendBoardHistory(next, action, clientSession.displayName, now);
    const optimistic = {
      ...audited,
      lastMovedId: options.movedId ?? next.lastMovedId,
      updatedAt: now,
      updatedBy: clientSession.displayName,
    };
    updateBoard(optimistic);
    const revision = ++saveRevisionRef.current;
    savingRef.current = true;
    setSyncState("saving");

    const save = async () => {
      if (revision <= cancelledSaveRevisionRef.current) return;
      const response = await fetch("/api/board", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          board: optimistic,
          baseVersion: serverVersionRef.current,
          actor: clientSession.displayName,
        }),
      });
      const payload = (await response.json()) as { board?: MagneticBoardState; version?: number; error?: string };
      if (response.status === 409) {
        cancelledSaveRevisionRef.current = saveRevisionRef.current;
        if (payload.board && payload.version) {
          if (payload.board.layoutVersion === defaultMagneticBoard.layoutVersion) {
            serverVersionRef.current = payload.version;
            updateBoard(payload.board);
            setBoardReady(true);
            setLoadError(null);
          } else {
            serverVersionRef.current = 0;
            setBoardReady(false);
            setLoadError(null);
          }
        }
        setUndoStack([]);
        setSyncState(payload.board?.layoutVersion === defaultMagneticBoard.layoutVersion ? "saved" : "loading");
        setWarning({
          title: "Board changed on another screen",
          message: payload.error ?? "Your pending change was not saved because a newer board version was detected. The latest shared board is now displayed.",
        });
        return;
      }
      if (!response.ok || !payload.board || !payload.version) throw new Error("Unable to save board");
      serverVersionRef.current = payload.version;
      if (revision === saveRevisionRef.current) {
        updateBoard(payload.board);
        setBoardReady(true);
        setLoadError(null);
        setSyncState("saved");
      }
    };

    const queuedSave = saveQueueRef.current.catch(() => undefined).then(save);
    saveQueueRef.current = queuedSave.then(() => undefined, () => undefined);
    try {
      await queuedSave;
    } catch {
      if (revision === saveRevisionRef.current) setSyncState("error");
    } finally {
      if (revision === saveRevisionRef.current) savingRef.current = false;
    }
  }, [clientSession.displayName, updateBoard]);

  useEffect(() => {
    let active = true;

    const loadBoard = async (quiet = false) => {
      if (
        savingRef.current || loadInFlightRef.current || dragRef.current ||
        editorOpenRef.current || keyboardHistoryRef.current || document.hidden
      ) return;
      const requestSaveRevision = saveRevisionRef.current;
      loadInFlightRef.current = true;
      try {
        const knownVersion = serverVersionRef.current;
        const response = await fetch(
          knownVersion ? `/api/board?since=${knownVersion}` : "/api/board",
          { cache: "no-store" },
        );
        if (response.status === 204) return;
        if (!response.ok) throw new Error("Unable to load board");
        const payload = (await response.json()) as { board: MagneticBoardState; version: number };
        if (!payload.board || !Number.isInteger(payload.version) || payload.version < 1) {
          throw new Error("The live board response is invalid");
        }
        if (
          active &&
          shouldApplyBoardResponse({
            responseVersion: payload.version,
            currentVersion: serverVersionRef.current,
            requestSaveRevision,
            currentSaveRevision: saveRevisionRef.current,
            isSaving: savingRef.current,
            isDragging: Boolean(dragRef.current),
            isEditing: editorOpenRef.current,
            isKeyboardMoving: Boolean(keyboardHistoryRef.current),
          })
        ) {
          if (
            payload.board.layoutVersion !== defaultMagneticBoard.layoutVersion &&
            !MIGRATABLE_LAYOUT_VERSIONS.has(payload.board.layoutVersion)
          ) {
            setBoardReady(false);
            setSyncState("error");
            setLoadError(
              `This screen cannot safely open board layout ${payload.board.layoutVersion}. Refresh the page to load the latest application before editing.`,
            );
            return;
          }
          serverVersionRef.current = payload.version;
          setBoardReady(true);
          setLoadError(null);
          if (payload.board.layoutVersion === 3) {
            const retainedMagnets = payload.board.magnets.filter((magnet) =>
              !magnet.id.startsWith("park-") &&
              !(magnet.kind === "location" && PARK_UP_ZONE_NAMES.has(magnet.primary.trim().toUpperCase())),
            );
            const linked = inferNearbyAttachments(compactBoardLayout(expandFloorRows(retainedMagnets)));
            void commitBoard({
              ...payload.board,
              layoutVersion: defaultMagneticBoard.layoutVersion,
              magnets: linked.magnets,
            }, { recordHistory: false, recordAudit: false });
            return;
          }
          if (payload.board.layoutVersion === 4) {
            const linked = inferNearbyAttachments(compactBoardLayout(expandFloorRows(payload.board.magnets)));
            void commitBoard({
              ...payload.board,
              layoutVersion: defaultMagneticBoard.layoutVersion,
              magnets: linked.magnets,
            }, { recordHistory: false, recordAudit: false });
            return;
          }
          if (payload.board.layoutVersion === 5) {
            const linked = inferNearbyAttachments(compactBoardLayout(payload.board.magnets));
            void commitBoard({
              ...payload.board,
              layoutVersion: defaultMagneticBoard.layoutVersion,
              magnets: linked.magnets,
            }, { recordHistory: false, recordAudit: false });
            return;
          }
          if (
            payload.board.layoutVersion === 6
            || payload.board.layoutVersion === 7
            || payload.board.layoutVersion === 8
            || payload.board.layoutVersion === 10
            || payload.board.layoutVersion === 11
          ) {
            const expandMagnets = (magnets: Magnet[]) => compactCurrentMagnetWidths(magnets
              .filter((magnet) => magnet.x < LEGACY_ACTIVE_WIDTH)
              .map((magnet) => ({
                ...magnet,
                x: Math.min(expandShiftBoardX(magnet.x), BOARD_WIDTH - magnet.width),
              })));
            const magnets = spreadFourSectionMagnets(expandMagnets(payload.board.magnets));
            const startingMagnets = payload.board.startingMagnets
              ? spreadFourSectionMagnets(expandMagnets(payload.board.startingMagnets))
              : undefined;
            const linked = inferNearbyAttachments(magnets);
            void commitBoard({
              ...payload.board,
              layoutVersion: defaultMagneticBoard.layoutVersion,
              magnets: linked.magnets,
              startingMagnets,
            }, { recordHistory: false, recordAudit: false });
            return;
          }
          if (payload.board.layoutVersion === 12) {
            void commitBoard({
              ...payload.board,
              layoutVersion: defaultMagneticBoard.layoutVersion,
              magnets: compactCurrentMagnetWidths(spreadFourSectionMagnets(payload.board.magnets)),
              startingMagnets: payload.board.startingMagnets
                ? compactCurrentMagnetWidths(spreadFourSectionMagnets(payload.board.startingMagnets))
                : undefined,
            }, { recordHistory: false, recordAudit: false });
            return;
          }
          if (payload.board.layoutVersion === 13) {
            void commitBoard({
              ...payload.board,
              layoutVersion: defaultMagneticBoard.layoutVersion,
              magnets: compactCurrentMagnetWidths(payload.board.magnets),
              startingMagnets: payload.board.startingMagnets
                ? compactCurrentMagnetWidths(payload.board.startingMagnets)
                : undefined,
            }, { recordHistory: false, recordAudit: false });
            return;
          }
          if (payload.board.layoutVersion === 14) {
            void commitBoard({
              ...payload.board,
              layoutVersion: defaultMagneticBoard.layoutVersion,
              magnets: moveAllocatedTruckGroupsIntoWiderLane(payload.board.magnets),
              startingMagnets: payload.board.startingMagnets
                ? moveAllocatedTruckGroupsIntoWiderLane(payload.board.startingMagnets)
                : undefined,
              snapshots: payload.board.snapshots?.map((snapshot) => ({
                ...snapshot,
                state: {
                  ...snapshot.state,
                  magnets: moveAllocatedTruckGroupsIntoWiderLane(snapshot.state.magnets),
                },
              })),
              historyVersions: payload.board.historyVersions?.map((entry) => ({
                ...entry,
                state: {
                  ...entry.state,
                  magnets: moveAllocatedTruckGroupsIntoWiderLane(entry.state.magnets),
                },
              })),
            }, { recordHistory: false, recordAudit: false });
            return;
          }
          if (payload.board.layoutVersion === 15) {
            const addHeaderMagnets = (magnets: Magnet[]) => restoreMineHeaderMagnets(magnets);
            void commitBoard({
              ...payload.board,
              layoutVersion: defaultMagneticBoard.layoutVersion,
              magnets: addHeaderMagnets(payload.board.magnets),
              startingMagnets: payload.board.startingMagnets
                ? addHeaderMagnets(payload.board.startingMagnets)
                : undefined,
              snapshots: payload.board.snapshots?.map((snapshot) => ({
                ...snapshot,
                state: {
                  ...snapshot.state,
                  magnets: addHeaderMagnets(snapshot.state.magnets),
                },
              })),
              historyVersions: payload.board.historyVersions?.map((entry) => ({
                ...entry,
                state: {
                  ...entry.state,
                  magnets: addHeaderMagnets(entry.state.magnets),
                },
              })),
            }, { recordHistory: false, recordAudit: false });
            return;
          }
          if (payload.board.layoutVersion !== defaultMagneticBoard.layoutVersion) {
            setBoardReady(false);
            setSyncState("error");
            setLoadError("The saved board uses an unsupported layout and was left unchanged.");
            return;
          }
          const sectionCount = payload.board.workSectionCount ?? 4;
          const pruned = pruneHiddenWorkSectionControls(payload.board.magnets, sectionCount);
          const prunedStarting = payload.board.startingMagnets
            ? pruneHiddenWorkSectionControls(payload.board.startingMagnets, sectionCount)
            : null;
          const unique = ensureUniqueMagnetIds(pruned.magnets);
          const uniqueStarting = prunedStarting
            ? ensureUniqueMagnetIds(prunedStarting.magnets)
            : null;
          const linked = inferNearbyAttachments(unique.magnets);
          if (pruned.changed || prunedStarting?.changed || unique.changed || uniqueStarting?.changed || linked.changed) {
            void commitBoard(
              {
                ...payload.board,
                magnets: linked.magnets,
                startingMagnets: uniqueStarting?.magnets ?? payload.board.startingMagnets,
              },
              { recordHistory: false, recordAudit: false },
            );
            return;
          }
          updateBoard(payload.board);
          setSyncState("saved");
        }
      } catch {
        if (active && (!quiet || !serverVersionRef.current)) {
          setSyncState("error");
          setLoadError("Unable to reach the live board. Retrying automatically.");
        }
      } finally {
        loadInFlightRef.current = false;
      }
    };

    void loadBoard();
    const refreshWhenFocused = () => void loadBoard(true);
    const refreshWhenVisible = () => {
      if (!document.hidden) void loadBoard(true);
    };
    const interval = window.setInterval(() => void loadBoard(true), BOARD_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshWhenFocused);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenFocused);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [commitBoard, updateBoard]);

  const focusMagnet = useCallback((magnet: Magnet) => {
    setSelectedId(magnet.id);
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-magnet-id="${magnet.id}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }, 0);
  }, []);

  const findNextMagnet = useCallback(() => {
    if (!boardSearchResults.length) return;
    const result = boardSearchResults[findIndex % boardSearchResults.length];
    focusMagnet(result);
    setFindIndex((index) => (index + 1) % boardSearchResults.length);
  }, [boardSearchResults, findIndex, focusMagnet]);

  const focusNextUnassigned = useCallback(() => {
    if (!unassignedOperators.length) return;
    const currentIndex = unassignedOperators.findIndex((magnet) => magnet.id === selectedId);
    focusMagnet(unassignedOperators[(currentIndex + 1) % unassignedOperators.length]);
  }, [focusMagnet, selectedId, unassignedOperators]);

  const undoLastChange = useCallback(() => {
    const previous = undoStack.at(-1);
    if (!previous || locked) return;
    setUndoStack((history) => history.slice(0, -1));
    setSelectedId(previous.lastMovedId ?? null);
    void commitBoard(cloneBoard(previous), { recordHistory: false, action: "Undid the last board change" });
  }, [commitBoard, locked, undoStack]);

  const saveStartingLayout = useCallback(async () => {
    if (!(await requestConfirmation({ title: "Save starting layout?", message: "Use the current magnet arrangement as the new starting layout for future board resets?", confirmLabel: "SAVE LAYOUT" }))) return;
    const current = stateRef.current;
    void commitBoard({
      ...current,
      startingMagnets: current.magnets.map((magnet) => ({ ...magnet })),
    }, { action: "Saved the starting board layout" });
  }, [commitBoard, requestConfirmation]);

  const saveHandoverSnapshot = useCallback((name: string) => {
    const current = stateRef.current;
    const snapshot = createBoardSnapshot(current, name, clientSession.displayName);
    setHandoverOpen(false);
    void commitBoard(appendSnapshot(current, snapshot), {
      action: `Saved handover snapshot ${snapshot.name}`,
    });
  }, [clientSession.displayName, commitBoard]);

  const restoreHistoryEntry = useCallback(async (entry: BoardHistoryEntry) => {
    if (!(await requestConfirmation({
      title: "Restore board version?",
      message: `Restore the board state saved after “${entry.action}” at ${formatUpdatedAt(entry.createdAt)}? The current state will remain in history.`,
      confirmLabel: "RESTORE VERSION",
    }))) return;
    setHistoryOpen(false);
    setSelectedId(null);
    void commitBoard(restoreBoardArchiveState(stateRef.current, entry.state), {
      action: `Restored history version: ${entry.action}`,
    });
  }, [commitBoard, requestConfirmation]);

  const prepareNextShift = useCallback((options: {
    boardDate: string;
    dayCrew?: CrewCode;
    nightCrew?: CrewCode;
    retainShiftNote: boolean;
  }) => {
    const next = prepareNextShiftBoard(stateRef.current, effectiveInventory, {
      ...options,
      actor: clientSession.displayName,
    });
    setNextShiftOpen(false);
    setSelectedId(null);
    void commitBoard(next, { action: `Prepared next shift for ${options.boardDate.trim().toUpperCase()}` });
  }, [clientSession.displayName, commitBoard, effectiveInventory]);

  const clearPersonnel = useCallback(async () => {
    const current = stateRef.current;
    const personnelCount = current.magnets.filter((magnet) => magnet.kind === "person").length;
    if (!personnelCount) {
      setWarning({ title: "No personnel found", message: "There are no personnel magnets on the board to clear." });
      return;
    }
    if (!(await requestConfirmation({ title: "Clear personnel?", message: `Remove all ${personnelCount} personnel magnets? Assets, locations and notes will remain in place.`, confirmLabel: "CLEAR PERSONNEL" }))) return;
    setSelectedId(null);
    void commitBoard({
      ...current,
      magnets: current.magnets.filter((magnet) => magnet.kind !== "person"),
    });
  }, [commitBoard, requestConfirmation]);

  const cleanUpTrucks = useCallback(async () => {
    const current = stateRef.current;
    if (!(await requestConfirmation({ title: "Clean up trucks?", message: "Arrange two-digit (777) trucks in one column and three-digit (789) trucks in another on each shift? Trucks in the shared bottom section will remain there.", confirmLabel: "CLEAN UP TRUCKS" }))) return;
    setSelectedId(null);
    void commitBoard({
      ...current,
      magnets: cleanUpTruckMagnets(current.magnets, effectiveInventory),
    });
  }, [commitBoard, effectiveInventory, requestConfirmation]);

  const resetAuxiliaryToMiddle = useCallback(async () => {
    const current = stateRef.current;
    if (!(await requestConfirmation({ title: "Reset auxiliary layout?", message: "Reset auxiliary equipment into two columns in the upper-middle of each shift? Excavators, light vehicles, and assets in the shared bottom section will remain where they are.", confirmLabel: "RESET AUX LAYOUT" }))) return;
    setSelectedId(null);
    void commitBoard({
      ...current,
      magnets: resetAuxiliaryMagnetsToMiddle(current.magnets, effectiveInventory),
    });
  }, [commitBoard, effectiveInventory, requestConfirmation]);

  const changeSectionCount = useCallback((delta: -1 | 1) => {
    const current = stateRef.current;
    const previousCount = current.workSectionCount ?? 4;
    const workSectionCount = Math.max(1, Math.min(5, previousCount + delta)) as WorkSectionCount;
    if (workSectionCount === previousCount) return;
    void commitBoard({
      ...current,
      workSectionCount,
      magnets: resizeWorkSections(current.magnets, previousCount, workSectionCount),
      startingMagnets: current.startingMagnets
        ? resizeWorkSections(current.startingMagnets, previousCount, workSectionCount)
        : undefined,
    });
  }, [commitBoard]);

  const copyShift = useCallback(async (source: ShiftSide) => {
    const destination: ShiftSide = source === "day" ? "night" : "day";
    if (!(await requestConfirmation({ title: "Copy shift allocations?", message: `Replace the ${destination.toUpperCase()} work area with a copy of the ${source.toUpperCase()} work area? The shared bottom section will not be changed.`, confirmLabel: "COPY SHIFT" }))) return;
    const current = stateRef.current;
    const sourceLeft = source === "day" ? 0 : SHIFT_WIDTH;
    const destinationLeft = destination === "day" ? 0 : SHIFT_WIDTH;
    const inSide = (magnet: Magnet, left: number) =>
      magnet.x >= left && magnet.x < left + SHIFT_WIDTH &&
      magnet.y >= WORK_ROWS_TOP && magnet.y < PARK_UP_TOP;
    const sourceMagnets = current.magnets.filter((magnet) => inSide(magnet, sourceLeft));
    const idMap = new Map(sourceMagnets.map((magnet, index) => [
      magnet.id,
      `copy-${destination}-${Date.now()}-${index}`,
    ]));
    const maxZ = Math.max(1, ...current.magnets.map((item) => item.z));
    const copiedMagnets = sourceMagnets.map((magnet, index) => ({
      ...magnet,
      id: idMap.get(magnet.id) as string,
      x: magnet.x + destinationLeft - sourceLeft,
      z: maxZ + index + 1,
      attachedTo: magnet.attachedTo ? idMap.get(magnet.attachedTo) : undefined,
    }));
    const retained = current.magnets.filter((magnet) => !inSide(magnet, destinationLeft));
    void commitBoard({ ...current, magnets: [...retained, ...copiedMagnets] });
    setCopyDialogOpen(false);
  }, [commitBoard, requestConfirmation]);

  const allocateCrew = useCallback(async (crew: CrewCode, side: ShiftSide) => {
    const sideLabel = side === "day" ? "DAY" : "NIGHT";
    if (!(await requestConfirmation({ title: `Allocate ${crew} Crew?`, message: `Place all ${crew} Crew magnets down the right side of ${sideLabel} shift? Only the crew currently on ${sideLabel} shift will be replaced.`, confirmLabel: "ALLOCATE CREW" }))) return;
    const current = stateRef.current;
    const left = side === "day" ? 0 : SHIFT_WIDTH;
    const right = left + SHIFT_WIDTH;
    const isOnTargetSide = (magnet: Magnet) => magnet.x >= left && magnet.x < right;
    const retained = current.magnets.filter((magnet) =>
      !(magnet.kind === "person" && magnet.crew && isOnTargetSide(magnet)),
    );
    const highestZ = Math.max(1, ...retained.map((magnet) => magnet.z));
    const crewRowSpacing = 22;
    const availableRoster = getCrewInventoryTemplates(effectiveInventory, crew);
    const rowsPerColumn = Math.ceil(availableRoster.length / 2);
    const placed: Magnet[] = availableRoster.map((template, index) => {
      const column = Math.floor(index / rowsPerColumn);
      const row = index % rowsPerColumn;
      const savedName = current.personnelNames?.[personnelRosterKey(template) as string];
      const hasSavedRackOverride = current.customInventory?.some((candidate) => magnetInventoryKey(candidate) === magnetInventoryKey(template));
      const primary = hasSavedRackOverride ? template.primary : savedName ?? template.primary;
      const width = responsiveMagnetWidth("person", primary) ?? template.width;
      return {
        ...template,
        primary,
        width,
        id: `crew-${side}-${crew.toLowerCase()}-${(template.fullName ?? template.primary).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        x: right - 8 - width - column * 118,
        y: WORK_ROWS_TOP + 4 + row * crewRowSpacing,
        z: highestZ + index + 1,
      };
    });

    const oppositeLeft = side === "day" ? SHIFT_WIDTH : 0;
    const oppositeCrew = current.magnets.find((magnet) =>
      magnet.kind === "person" && magnet.crew && magnet.x >= oppositeLeft && magnet.x < oppositeLeft + SHIFT_WIDTH,
    )?.crew;
    const dayCrew = side === "day" ? crew : oppositeCrew;
    const nightCrew = side === "night" ? crew : oppositeCrew;
    setCrewDialogOpen(false);
    setSelectedId(placed[0]?.id ?? null);
    void commitBoard({
      ...current,
      roster: `DAY: ${dayCrew ? `${dayCrew} CREW` : "NOT SET"} · NIGHT: ${nightCrew ? `${nightCrew} CREW` : "NOT SET"}`,
      magnets: [...retained, ...placed],
    }, { movedId: placed[0]?.id });
  }, [commitBoard, effectiveInventory, requestConfirmation]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setWarning({ title: "Full screen unavailable", message: "This browser or device does not currently allow full-screen mode." });
    }
  }, []);

  const addInventoryMagnet = useCallback((template: MagnetTemplate, x = 760, y = 390) => {
    const proposed: Magnet = {
      ...template,
      id: `magnet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      x,
      y,
      z: Math.max(1, ...stateRef.current.magnets.map((item) => item.z)) + 1,
    };
    const created = findOpenPosition(proposed, stateRef.current.magnets, x, y);
    if (!created) {
      setWarning({ title: "No clear space", message: "There is no clear position available for another magnet. Move an existing magnet and try again." });
      return;
    }
    setSelectedId(created.id);
    void commitBoard(
      { ...stateRef.current, magnets: [...stateRef.current.magnets, created] },
      { movedId: created.id },
    );
  }, [commitBoard]);

  const removeInventoryTemplate = useCallback(async (template: MagnetTemplate) => {
    const label = template.fullName ?? template.primary;
    if (!(await requestConfirmation({
      title: `Delete ${label} permanently?`,
      message: `${label} will be removed from the saved Magnet Rack and will not return during crew, truck, AUX, or board resets. Magnets already placed on the board will stay where they are.`,
      confirmLabel: "DELETE PERMANENTLY",
    }))) return false;
    const current = stateRef.current;
    const key = magnetInventoryKey(template);
    void commitBoard({
      ...current,
      customInventory: current.customInventory?.filter((item) => magnetInventoryKey(item) !== key),
      removedInventory: [...new Set([...(current.removedInventory ?? []), key])],
    });
    return true;
  }, [commitBoard, requestConfirmation]);

  const editInventoryTemplate = useCallback((template: MagnetTemplate) => {
    setInventoryEditingTemplate(template);
    setIsNewMagnet(false);
    setEditorMagnet({
      ...template,
      id: `inventory-${magnetInventoryKey(template)}`,
      x: 0,
      y: 0,
      z: 0,
    });
  }, []);

  const saveInventoryTemplate = useCallback((magnet: Magnet) => {
    if (!inventoryEditingTemplate) return;
    const current = stateRef.current;
    const originalKey = magnetInventoryKey(inventoryEditingTemplate);
    const template: MagnetTemplate = {
      kind: magnet.kind,
      primary: magnet.primary,
      tone: magnet.tone,
      width: magnet.width,
      height: magnet.height,
      crew: magnet.crew,
      competencies: magnet.competencies,
      fullName: magnet.fullName,
    };
    const nextKey = magnetInventoryKey(template);
    const originalRosterKey = inventoryEditingTemplate.kind === "person"
      ? personnelRosterKey(inventoryEditingTemplate)
      : null;
    const nextRosterKey = template.kind === "person" ? personnelRosterKey(template) : null;
    const personnelNames = { ...(current.personnelNames ?? {}) };
    if (originalRosterKey && originalRosterKey !== nextRosterKey) delete personnelNames[originalRosterKey];
    if (nextRosterKey) personnelNames[nextRosterKey] = template.primary;
    void commitBoard({
      ...current,
      customInventory: [
        ...(current.customInventory ?? []).filter((item) => {
          const key = magnetInventoryKey(item);
          return key !== originalKey && key !== nextKey;
        }),
        template,
      ],
      removedInventory: [...new Set([...(current.removedInventory ?? []), originalKey])]
        .filter((key) => key !== nextKey),
      personnelNames: originalRosterKey || nextRosterKey ? personnelNames : current.personnelNames,
    });
    setInventoryEditingTemplate(null);
    setEditorMagnet(null);
  }, [commitBoard, inventoryEditingTemplate]);

  const dropFromRack = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/x-shiftboard-template");
    if (!raw || !canvasRef.current) return;
    let template: unknown;
    try {
      template = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isMagnetTemplate(template)) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (BOARD_WIDTH / rect.width) - template.width / 2;
    const y = (event.clientY - rect.top) * (BOARD_HEIGHT / rect.height) - template.height / 2;
    addInventoryMagnet(template, Math.round(x), Math.round(y));
  };

  const changePitWorkArea = (magnet: Magnet, primary: string) => {
    const current = stateRef.current;
    void commitBoard({
      ...current,
      magnets: current.magnets.map((item) => item.id === magnet.id ? { ...item, primary } : item),
    }, { movedId: magnet.id });
  };

  const changeDigger = (magnet: Magnet, primary: string) => {
    const current = stateRef.current;
    void commitBoard({
      ...current,
      magnets: current.magnets.map((item) => item.id === magnet.id ? { ...item, primary } : item),
    }, { movedId: magnet.id });
  };

  const addWorkSectionControl = (side: ShiftSide, rowIndex: number, kind: "location" | "excavator", primary: string) => {
    const current = stateRef.current;
    const sectionCount = current.workSectionCount ?? 4;
    if (locked || presentation || rowIndex < 0 || rowIndex >= sectionCount) return;

    const isOnSide = (magnet: Magnet) => magnetShiftSide(magnet) === side;
    const existingCount = current.magnets
      .filter((magnet) => (kind === "location" ? isPitWorkAreaControl(magnet) : isDiggerControl(magnet)) && isOnSide(magnet))
      .slice(0, sectionCount)
      .length;
    if (existingCount !== rowIndex) return;

    const sideLeft = side === "day" ? 0 : SHIFT_WIDTH;
    const rowHeight = (PARK_UP_TOP - WORK_ROWS_TOP) / sectionCount;
    const defaults = kindDefaults[kind];
    const id = claimUniqueMagnetId(
      `work-${side}-${kind}-${primary.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      new Set(current.magnets.map((magnet) => magnet.id)),
    );
    const created: Magnet = {
      id,
      kind,
      primary,
      x: sideLeft + (kind === "location" ? 4 : 138),
      y: Math.round(WORK_ROWS_TOP + rowIndex * rowHeight + 7),
      width: kind === "location" ? 128 : (responsiveMagnetWidth(kind, primary) ?? defaults.width),
      height: defaults.height,
      z: Math.max(1, ...current.magnets.map((magnet) => magnet.z)) + 1,
      tone: defaults.tone,
    };
    setSelectedId(id);
    void commitBoard(
      { ...current, magnets: [...current.magnets, created] },
      {
        movedId: id,
        action: `Added ${primary} to ${side === "day" ? "Day" : "Night"} shift section ${rowIndex + 1}`,
      },
    );
  };

  useEffect(() => {
    editorOpenRef.current = Boolean(
      editorMagnet || shiftEditorOpen || copyDialogOpen || crewDialogOpen || pitListOpen ||
      pitDetailsMagnet || diggerListOpen || handoverOpen || readinessOpen || historyOpen || nextShiftOpen,
    );
  }, [copyDialogOpen, crewDialogOpen, diggerListOpen, editorMagnet, handoverOpen, historyOpen, nextShiftOpen, pitDetailsMagnet, pitListOpen, readinessOpen, shiftEditorOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      if (event.key === "Escape") {
        if (boardContextMenu) setBoardContextMenu(null);
        else if (rackContextMenu) setRackContextMenu(null);
        else if (confirmation) closeConfirmation(false);
        else if (warning) setWarning(null);
        else if (editorMagnet) {
          setEditorMagnet(null);
          setInventoryEditingTemplate(null);
        } else if (pitDetailsMagnet) setPitDetailsMagnet(null);
        else if (pitListOpen) setPitListOpen(false);
        else if (diggerListOpen) setDiggerListOpen(false);
        else if (shiftEditorOpen) setShiftEditorOpen(false);
        else if (copyDialogOpen) setCopyDialogOpen(false);
        else if (crewDialogOpen) setCrewDialogOpen(false);
        else if (handoverOpen) setHandoverOpen(false);
        else if (readinessOpen) setReadinessOpen(false);
        else if (historyOpen) setHistoryOpen(false);
        else if (nextShiftOpen) setNextShiftOpen(false);
        else if (presentation) setPresentation(false);
        else setSelectedId(null);
        return;
      }

      if (target?.matches("input, textarea, select")) return;

      if (presentation && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        setTvShiftView(event.key === "ArrowLeft" ? "day" : "night");
        return;
      }

      if (!selectedId || locked || editorOpenRef.current) return;
      const movement: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const delta = movement[event.key];
      if (!delta) return;
      event.preventDefault();
      if (!keyboardHistoryRef.current) keyboardHistoryRef.current = cloneBoard(stateRef.current);
      const amount = event.shiftKey ? 10 : 1;
      const current = stateRef.current;
      const selected = current.magnets.find((magnet) => magnet.id === selectedId);
      if (!selected) return;
      const workingMagnets = selected.kind === "person" && selected.attachedTo
        ? current.magnets.map((magnet) =>
            magnet.id === selectedId ? { ...magnet, attachedTo: undefined } : magnet,
          )
        : current.magnets;
      const moved = moveLinkedGroup(
        workingMagnets,
        selectedId,
        selected.x + delta[0] * amount,
        selected.y + delta[1] * amount,
      );
      if (moved) updateBoard({ ...current, magnets: moved });
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key.startsWith("Arrow") && selectedId && !locked && !editorOpenRef.current) {
        void commitBoard(stateRef.current, {
          historyBase: keyboardHistoryRef.current ?? undefined,
          movedId: selectedId,
        });
        keyboardHistoryRef.current = null;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    closeConfirmation,
    boardContextMenu,
    commitBoard,
    confirmation,
    copyDialogOpen,
    crewDialogOpen,
    diggerListOpen,
    editorMagnet,
    handoverOpen,
    historyOpen,
    locked,
    nextShiftOpen,
    pitDetailsMagnet,
    pitListOpen,
    presentation,
    readinessOpen,
    rackContextMenu,
    selectedId,
    shiftEditorOpen,
    updateBoard,
    warning,
  ]);

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    magnet: Magnet,
  ) => {
    if (event.button !== 0 || locked || presentation) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    setBoardContextMenu(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = canvas.getBoundingClientRect();
    const scaleX = BOARD_WIDTH / rect.width;
    const scaleY = BOARD_HEIGHT / rect.height;
    dragRef.current = {
      id: magnet.id,
      pointerId: event.pointerId,
      offsetX: (event.clientX - rect.left) * scaleX - magnet.x,
      offsetY: (event.clientY - rect.top) * scaleY - magnet.y,
      historyBase: cloneBoard(stateRef.current),
    };
    void publishPresence(magnet.id);
    setInvalidDropId(null);
    setSelectedId(magnet.id);

    const maxZ = Math.max(1, ...stateRef.current.magnets.map((item) => item.z));
    const groupIds = new Set([
      magnet.id,
      ...(attachableMagnetKinds.has(magnet.kind)
        ? stateRef.current.magnets.filter((item) => item.attachedTo === magnet.id).map((item) => item.id)
        : []),
    ]);
    const next = {
      ...stateRef.current,
      magnets: stateRef.current.magnets.map((item) =>
        groupIds.has(item.id)
          ? { ...item, z: maxZ + 1 + (item.id === magnet.id ? 0 : 1), attachedTo: item.id === magnet.id && item.kind === "person" ? undefined : item.attachedTo }
          : item,
      ),
    };
    updateBoard(next);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas || drag.pointerId !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = BOARD_WIDTH / rect.width;
    const scaleY = BOARD_HEIGHT / rect.height;

    const current = stateRef.current;
    const rawX = (event.clientX - rect.left) * scaleX - drag.offsetX;
    const rawY = (event.clientY - rect.top) * scaleY - drag.offsetY;
    const moved = moveLinkedGroup(
      current.magnets,
      drag.id,
      Math.round(rawX),
      Math.round(rawY),
      true,
    );
    if (moved) {
      setInvalidDropId(linkedGroupOverlaps(moved, drag.id) ? drag.id : null);
      updateBoard({ ...current, magnets: moved });
    }
  };

  const finishActiveDrag = useCallback((pointerId: number) => {
    if (!dragRef.current || dragRef.current.pointerId !== pointerId) return;
    const { id: draggedId, historyBase } = dragRef.current;
    dragRef.current = null;
    void publishPresence(null);
    const currentMagnets = stateRef.current.magnets;
    const snappedMagnets = snapGroupToParkUpZone(currentMagnets, draggedId);
    const rowSnappedMagnets = snappedMagnets
      ? null
      : snapTruckGroupToDiggerRow(currentMagnets, draggedId, stateRef.current.workSectionCount ?? 4);
    let dropMagnets = snappedMagnets ?? rowSnappedMagnets ?? currentMagnets;
    if (linkedGroupOverlaps(dropMagnets, draggedId)) {
      dropMagnets = moveGroupToNearestOpenPosition(currentMagnets, draggedId) ?? [];
    }
    if (!dropMagnets.length || linkedGroupOverlaps(dropMagnets, draggedId)) {
      setInvalidDropId(null);
      updateBoard(cloneBoard(historyBase));
      return;
    }
    setInvalidDropId(null);
    if (snappedMagnets) {
      dropMagnets = removeOppositeShiftAssetAfterParkUp(
        dropMagnets,
        historyBase.magnets,
        draggedId,
      );
    }
    let dragged = dropMagnets.find((magnet) => magnet.id === draggedId);
    const source = historyBase.magnets.find((magnet) => magnet.id === draggedId);
    if (
      source && source.y >= PARK_UP_TOP &&
      dragged && dragged.y < PARK_UP_TOP &&
      attachableMagnetKinds.has(dragged.kind)
    ) {
      dropMagnets = dropMagnets.map((magnet) =>
        magnet.id === draggedId ? { ...magnet, parkedFromShift: undefined } : magnet,
      );
      dragged = dropMagnets.find((magnet) => magnet.id === draggedId);
      if (dragged) {
        const returnedSide = magnetShiftSide(dragged);
        const unit = dragged.primary.trim().toUpperCase();
        const oppositeCopyExists = dropMagnets.some((magnet) =>
          magnet.id !== draggedId &&
          attachableMagnetKinds.has(magnet.kind) &&
          magnet.y < PARK_UP_TOP &&
          magnetShiftSide(magnet) !== returnedSide &&
          magnet.primary.trim().toUpperCase() === unit,
        );
        if (!oppositeCopyExists) {
          const proposedCopy: Magnet = {
            ...dragged,
            id: claimUniqueMagnetId(
              `return-${returnedSide === "day" ? "night" : "day"}-${unit.toLowerCase()}`,
              new Set(dropMagnets.map((magnet) => magnet.id)),
            ),
            x: getOppositeShiftX(dragged),
            z: Math.max(1, ...dropMagnets.map((magnet) => magnet.z)) + 1,
            attachedTo: undefined,
            parkedFromShift: undefined,
          };
          const copy = findOpenPositionOnShift(
            proposedCopy,
            dropMagnets,
            proposedCopy.x,
            proposedCopy.y,
            returnedSide === "day" ? SHIFT_WIDTH : 0,
          );
          if (!copy) {
            setInvalidDropId(null);
            updateBoard(cloneBoard(historyBase));
            setWarning({
              title: "No room on opposite shift",
              message: `${dragged.primary} could not be restored on both shifts because the opposite shift has no clear space.`,
            });
            return;
          }
          dropMagnets = [...dropMagnets, copy];
        }
      }
    }
    const magnets = dragged?.kind === "person"
      ? attachPersonToNearestEquipment(dropMagnets, draggedId, stateRef.current.workSectionCount ?? 4)
      : dropMagnets;
    void commitBoard(
      { ...stateRef.current, magnets },
      { historyBase, movedId: draggedId },
    );
  }, [commitBoard, publishPresence, updateBoard]);

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishActiveDrag(event.pointerId);
  };

  useEffect(() => {
    const finishWindowDrag = (event: PointerEvent) => finishActiveDrag(event.pointerId);
    window.addEventListener("pointerup", finishWindowDrag);
    return () => window.removeEventListener("pointerup", finishWindowDrag);
  }, [finishActiveDrag]);

  const cancelPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    cancelActiveDrag();
  };

  const openEditor = (magnet: Magnet, isNew = false) => {
    if (locked || presentation) return;
    setSelectedId(magnet.id);
    setIsNewMagnet(isNew);
    setEditorMagnet(magnet);
  };

  const openBoardContextMenu = (magnet: Magnet, clientX: number, clientY: number, offset = RACK_CONTEXT_MENU_OFFSET) => {
    if (locked || presentation || isPitWorkAreaControl(magnet) || isDiggerControl(magnet)) return;
    setRackContextMenu(null);
    setSelectedId(magnet.id);
    setBoardContextMenu({
      magnetId: magnet.id,
      ...positionCursorContextMenu(clientX, clientY, BOARD_CONTEXT_MENU_HEIGHT, offset),
    });
  };

  const saveMagnet = (magnet: Magnet, saveToInventory = false) => {
    const current = stateRef.current;
    const original = current.magnets.find((item) => item.id === magnet.id);
    const exists = current.magnets.some((item) => item.id === magnet.id);
    const attachedOperators = exists
      ? current.magnets.filter((item) => item.kind === "person" && item.attachedTo === magnet.id)
      : [];
    const editedGroupIds = new Set([
      ...(exists ? [magnet.id] : []),
      ...attachedOperators.map((operator) => operator.id),
    ]);
    const placed = findOpenPosition(
      magnet,
      current.magnets,
      magnet.x,
      magnet.y,
      attachableMagnetKinds.has(magnet.kind)
        ? editedGroupIds
        : new Set(exists ? [magnet.id] : []),
    );
    if (!placed) {
      setWarning({ title: "Magnet cannot be placed", message: "That magnet size would overlap another magnet, and no nearby clear position is available." });
      return;
    }
    const repositionedOperators = new Map<string, Magnet>();
    let operatorX = placed.x + placed.width + ATTACH_GAP;
    attachedOperators
      .sort((left, right) => left.x - right.x || left.id.localeCompare(right.id))
      .forEach((operator) => {
        if (!attachableMagnetKinds.has(placed.kind)) {
          repositionedOperators.set(operator.id, { ...operator, attachedTo: undefined });
          return;
        }
        const candidate = {
          ...operator,
          x: operatorX,
          y: Math.round(placed.y + (placed.height - operator.height) / 2),
          z: Math.max(operator.z, placed.z + 1),
        };
        const blocked = !isInsideBoard(candidate) ||
          collidesWithOthers(candidate, current.magnets, editedGroupIds) ||
          [...repositionedOperators.values()].some((positioned) => overlaps(candidate, positioned));
        repositionedOperators.set(
          operator.id,
          blocked ? { ...operator, attachedTo: undefined } : candidate,
        );
        if (!blocked) operatorX = candidate.x + candidate.width + ATTACH_GAP;
      });
    const nextMagnets = exists
      ? current.magnets.map((item) => {
          if (item.id === magnet.id) return placed;
          const repositioned = repositionedOperators.get(item.id);
          if (repositioned) return repositioned;
          return item;
        })
      : [...current.magnets, placed];
    const template: MagnetTemplate = {
      kind: placed.kind,
      primary: placed.primary,
      tone: placed.tone,
      width: placed.width,
      height: placed.height,
      crew: placed.crew,
      competencies: placed.competencies,
      fullName: placed.fullName,
    };
    const templateKey = magnetInventoryKey(template);
    const next = {
      ...current,
      magnets: nextMagnets,
      customInventory: saveToInventory
        ? [...(current.customInventory ?? []).filter((item) => magnetInventoryKey(item) !== templateKey), template]
        : current.customInventory,
      removedInventory: saveToInventory
        ? current.removedInventory?.filter((key) => key !== templateKey)
        : current.removedInventory,
      personnelNames: original?.kind === "person" && magnet.kind === "person"
        ? {
            ...current.personnelNames,
            ...((personnelRosterKey(original) ?? personnelRosterKey(magnet))
              ? { [(personnelRosterKey(original) ?? personnelRosterKey(magnet)) as string]: placed.primary }
              : {}),
          }
        : current.personnelNames,
    };
    setEditorMagnet(null);
    setSelectedId(magnet.id);
    void commitBoard(next, { movedId: magnet.id });
  };

  const deleteMagnet = (id: string) => {
    const next = {
      ...stateRef.current,
      magnets: stateRef.current.magnets
        .filter((item) => item.id !== id)
        .map((item) => item.attachedTo === id ? { ...item, attachedTo: undefined } : item),
    };
    setEditorMagnet(null);
    setSelectedId(null);
    void commitBoard(next);
  };

  const duplicateMagnet = (magnet: Magnet) => {
    if (isPitWorkAreaControl(magnet) || isDiggerControl(magnet)) {
      setWarning({
        title: "Use the section controls",
        message: "Pit / work area and digger rows cannot be duplicated. Use their left-click controls to change the pit or asset.",
      });
      return;
    }
    const proposed = {
      ...magnet,
      id: `magnet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      x: magnet.x + 20,
      y: magnet.y + 20,
      z: magnet.z + 1,
      attachedTo: undefined,
    };
    const copy = findOpenPosition(proposed, stateRef.current.magnets, proposed.x, proposed.y);
    if (!copy) {
      setWarning({ title: "Cannot duplicate magnet", message: "There is no clear position available for the duplicate. Move an existing magnet and try again." });
      return;
    }
    const next = { ...stateRef.current, magnets: [...stateRef.current.magnets, copy] };
    setEditorMagnet(null);
    setSelectedId(copy.id);
    void commitBoard(next, { movedId: copy.id });
  };

  const removeMagnetFromBoard = async (magnet: Magnet) => {
    const label = magnet.fullName ?? magnet.primary;
    const confirmed = await requestConfirmation({
      title: `Remove ${label} from this board?`,
      message: "This only removes the placed magnet from the whiteboard. It does not permanently delete anything from the Magnet Rack.",
      confirmLabel: "REMOVE FROM BOARD",
    });
    if (confirmed) deleteMagnet(magnet.id);
  };

  const resetBoard = async () => {
    if (!(await requestConfirmation({ title: "Reset working area?", message: "Rebuild the upper board in the saved structured layout? Everything allocated in the shared bottom section will stay exactly where it is.", confirmLabel: "RESET BOARD" }))) return;
    const current = stateRef.current;
    const startingMagnets = current.startingMagnets ?? defaultMagneticBoard.magnets;
    const protectedBottom = current.magnets
      .filter((magnet) => magnet.y >= PARK_UP_TOP)
      .map((magnet) => ({ ...magnet }));
    const protectedIds = new Set(protectedBottom.map((magnet) => magnet.id));
    const startingWorkingArea = startingMagnets
      .filter((magnet) => magnet.y < PARK_UP_TOP && !protectedIds.has(magnet.id))
      .map((magnet) => ({ ...magnet }));
    const restored = inferNearbyAttachments([...startingWorkingArea, ...protectedBottom]).magnets;
    const structured = resetAuxiliaryMagnetsToMiddle(cleanUpTruckMagnets(restored, effectiveInventory), effectiveInventory);
    setSelectedId(null);
    void commitBoard({
      ...current,
      magnets: structured,
      updatedAt: new Date().toISOString(),
      updatedBy: "MINE CONTROL",
    });
  };

  if (!boardReady) {
    return (
      <main className="app board-loading-shell" aria-live="polite">
        <section className="board-loading-card">
          <span className="control-icon" aria-hidden="true">M</span>
          <span className={`connection-pill connection-${loadError ? "error" : "loading"}`}>
            <i /> {loadError ? "LIVE BOARD UNAVAILABLE" : "CONNECTING TO LIVE BOARD"}
          </span>
          <h1>{loadError ? "The saved board has not been opened" : "Loading the latest shiftboard"}</h1>
          <p>{loadError ?? "Waiting for the shared database. The bundled starting board is intentionally hidden."}</p>
          {loadError && (
            <button type="button" onClick={() => window.location.reload()}>REFRESH APPLICATION</button>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className={presentation ? `app presentation presentation-${tvShiftView}${tvShiftView === "both" ? "" : " presentation-single"}` : "app"}>
      {!presentation && (
        <header className="control-bar">
          <div className="control-brand">
            <span className="control-icon">M</span>
            <div>
              <strong>MAGNETIC SHIFTBOARD</strong>
              <span>DRAG · DROP · SYNC</span>
            </div>
          </div>

          <div className="board-session">
            <span className={`connection-pill connection-${syncState}`}>
              <i />
              {syncState === "loading" && "CONNECTING"}
              {syncState === "saving" && "SAVING"}
              {syncState === "saved" && "LIVE BOARD"}
              {syncState === "error" && "RETRYING"}
            </span>
            <span
              className={otherPresenceUsers.length ? "presence-pill presence-active" : "presence-pill"}
              title={otherPresenceUsers.length
                ? otherPresenceUsers.map((user) => `${user.displayName}${user.activeMagnetId ? " · moving a magnet" : ""}`).join("\n")
                : `This screen: ${clientSession.displayName}`}
            >
              <i /> {otherPresenceUsers.length ? `${otherPresenceUsers.length + 1} SCREENS LIVE` : "1 SCREEN LIVE"}
            </span>
            <span>{board.roster}</span>
            <span>{board.boardDate}</span>
          </div>

          <nav className="board-tools" aria-label="Board tools">
            <ActionMenu label="MAGNETS" variant="tool">
              <span className="action-menu-heading">ADD TO BOARD</span>
              <button type="button" onClick={() => { setRackOpen((value) => !value); setRackContextMenu(null); setBoardContextMenu(null); }} disabled={locked}>
                <strong>{rackOpen ? "Close magnet rack" : "Open magnet rack"}</strong>
                <small>Browse saved equipment and people</small>
              </button>
              <button type="button" onClick={() => openEditor(newMagnet("truck"), true)} disabled={locked}>
                <strong>Create custom magnet</strong>
                <small>Add a new unit, person or location</small>
              </button>
            </ActionMenu>
            <button
              className={locked ? "tool-button tool-primary locked" : "tool-button tool-primary"}
              type="button"
              onClick={() => {
                setLocked((value) => !value);
                setSelectedId(null);
                setBoardContextMenu(null);
              }}
            >
              {locked ? "BOARD LOCKED" : "LOCK BOARD"}
            </button>
            <ActionMenu label="VIEW" variant="tool">
              <span className="action-menu-heading">DISPLAY</span>
              <button type="button" onClick={() => setPresentation(true)}>
                <strong>TV view</strong>
                <small>Show the board without controls</small>
              </button>
              <button type="button" onClick={toggleFullscreen}>
                <strong>{isFullscreen ? "Exit full screen" : "Full screen"}</strong>
                <small>Use the whole display</small>
              </button>
            </ActionMenu>
          </nav>
        </header>
      )}

      {!presentation && (
        <section className="quick-actions" aria-label="Quick board actions">
          <div className="quick-group quick-group-search">
          <button className="quick-button" type="button" onClick={undoLastChange} disabled={!undoStack.length || locked}>
            ↶ UNDO
          </button>
          <form
            className="quick-find"
            onSubmit={(event) => {
              event.preventDefault();
              findNextMagnet();
            }}
          >
            <input
              aria-label="Find a magnet on the board"
              placeholder="FIND MAGNET"
              value={findQuery}
              onChange={(event) => {
                setFindQuery(event.target.value);
                setFindIndex(0);
              }}
            />
            <button type="submit" disabled={!boardSearchResults.length}>
              FIND{boardSearchResults.length ? ` ${findIndex + 1}/${boardSearchResults.length}` : ""}
            </button>
          </form>
          </div>
          <div className="quick-group quick-group-status">
          <button
            className={unassignedOperators.length ? "status-chip status-warning" : "status-chip status-ok"}
            type="button"
            onClick={focusNextUnassigned}
            title={unassignedOperators.map((magnet) => magnet.primary).join(", ") || "All working operators are assigned"}
          >
            {unassignedOperators.length ? `⚠ ${unassignedOperators.length} UNASSIGNED` : "✓ ALL ASSIGNED"}
          </button>
          <span className="status-chip">PARKED {totalParked}</span>
          </div>
          <div className="quick-group quick-group-workflows">
          <ActionMenu label="SHIFT">
            <span className="action-menu-heading">SHIFT &amp; PEOPLE</span>
            <button type="button" onClick={() => setShiftEditorOpen(true)} disabled={locked}>
              <strong>Shift details &amp; note</strong>
              <small>Change date, roster or shift message</small>
            </button>
            <button type="button" onClick={() => setCrewDialogOpen(true)} disabled={locked}>
              <strong>Allocate crew</strong>
              <small>Place the selected crew on the board</small>
            </button>
            <button className="menu-danger" type="button" onClick={clearPersonnel} disabled={locked}>
              <strong>Clear personnel</strong>
              <small>Remove working-area people only</small>
            </button>
            <button type="button" onClick={() => setNextShiftOpen(true)} disabled={locked}>
              <strong>Prepare next shift</strong>
              <small>Save this shift and set up the next one</small>
            </button>
          </ActionMenu>
          <div className="section-count-control">
            <button type="button" aria-label="Remove board section" title="Remove board section" onClick={() => changeSectionCount(-1)} disabled={locked || (board.workSectionCount ?? 4) === 1}>−</button>
            <span>{board.workSectionCount ?? 4} SECTIONS</span>
            <button type="button" aria-label="Add board section" title="Add board section" onClick={() => changeSectionCount(1)} disabled={locked || (board.workSectionCount ?? 4) === 5}>+</button>
          </div>
          <ActionMenu label={<><span>HANDOVER</span>{readinessIssues.length > 0 && <b>{readinessIssues.length}</b>}</>}>
            <span className="action-menu-heading">CHECK &amp; HANDOVER</span>
            <button type="button" onClick={() => setReadinessOpen(true)}>
              <strong>Board check{readinessIssues.length ? ` · ${readinessIssues.length} to review` : " · Ready"}</strong>
              <small>Check assignments and missing details</small>
            </button>
            <button type="button" onClick={() => setHandoverOpen(true)} disabled={locked}>
              <strong>Save handover</strong>
              <small>Capture and compare this shift</small>
            </button>
            <button type="button" onClick={() => setHistoryOpen(true)}>
              <strong>History &amp; restore</strong>
              <small>Review activity or restore a version</small>
            </button>
          </ActionMenu>
          <ActionMenu label="BOARD">
            <span className="action-menu-heading">LAYOUT &amp; RECOVERY</span>
            <button type="button" onClick={cleanUpTrucks} disabled={locked}>
              <strong>Line up trucks</strong>
              <small>Tidy allocated truck rows</small>
            </button>
            <button type="button" onClick={resetAuxiliaryToMiddle} disabled={locked}>
              <strong>Reset AUX layout</strong>
              <small>Return support units to their lanes</small>
            </button>
            <button type="button" onClick={saveStartingLayout} disabled={locked}>
              <strong>Save starting layout</strong>
              <small>Use the current board as the reset point</small>
            </button>
            <button type="button" onClick={() => setCopyDialogOpen(true)} disabled={locked}>
              <strong>Copy shift</strong>
              <small>Copy allocations between day and night</small>
            </button>
            <button className="menu-danger" type="button" onClick={resetBoard} disabled={locked}>
              <strong>Reset working area</strong>
              <small>Restore the saved starting layout</small>
            </button>
          </ActionMenu>
          </div>
        </section>
      )}

      {!presentation && rackOpen && (
        <section className="magnet-rack" aria-label="Magnet rack">
          <header>
            <div><strong>MAGNET RACK</strong><span>{effectiveInventory.length} saved magnets · left-click to add · right-click to edit or delete</span></div>
            <input aria-label="Search magnets" placeholder="SEARCH UNIT OR NAME" value={rackSearch} onChange={(event) => setRackSearch(event.target.value)} />
          </header>
          <nav aria-label="Magnet categories">
            {(["all", "truck", "dozer", "grader", "watercart", "excavator", "loader", "lightvehicle", "support", "person", "location"] as const).map((kind) => (
              <button key={kind} type="button" className={rackKind === kind ? "active" : ""} onClick={() => setRackKind(kind)}>
                {kind === "all" ? "ALL" : magnetKindLabels[kind]}
              </button>
            ))}
          </nav>
          <div className="rack-items">
            {filteredInventory.map((template) => (
              <span className="rack-item" key={magnetInventoryKey(template)}>
              <button
                type="button"
                draggable
                className={`rack-magnet magnet-${template.kind} tone-${template.tone}`}
                onDragStart={(event) => {
                  setRackContextMenu(null);
                  setBoardContextMenu(null);
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData("application/x-shiftboard-template", JSON.stringify(template));
                }}
                onClick={() => addInventoryMagnet(template)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setBoardContextMenu(null);
                  setRackContextMenu({
                    template,
                    ...positionCursorContextMenu(event.clientX, event.clientY, RACK_CONTEXT_MENU_HEIGHT),
                  });
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setBoardContextMenu(null);
                  setRackContextMenu({
                    template,
                    ...positionCursorContextMenu(rect.left, rect.bottom + 4, RACK_CONTEXT_MENU_HEIGHT, 0),
                  });
                }}
              ><strong>{template.kind === "person" && template.crew ? template.primary.split(" ")[0] : template.primary}</strong></button>
              </span>
            ))}
          </div>
        </section>
      )}

      {rackContextMenu && (
        <CursorContextMenu
          eyebrow="SAVED MAGNET"
          label={rackContextMenu.template.fullName ?? rackContextMenu.template.primary}
          x={rackContextMenu.x}
          y={rackContextMenu.y}
          onClose={() => setRackContextMenu(null)}
          actions={[
            {
              label: "EDIT SAVED MAGNET",
              description: "Change its name, type or details",
              icon: "✎",
              onSelect: () => editInventoryTemplate(rackContextMenu.template),
            },
            {
              label: "DELETE PERMANENTLY",
              description: "Remove it from the rack and future resets",
              icon: "×",
              danger: true,
              onSelect: () => { void removeInventoryTemplate(rackContextMenu.template); },
            },
          ]}
        />
      )}

      {boardContextMenu && boardContextMagnet && (
        <CursorContextMenu
          eyebrow="WHITEBOARD MAGNET"
          label={boardContextMagnet.fullName ?? boardContextMagnet.primary}
          x={boardContextMenu.x}
          y={boardContextMenu.y}
          onClose={() => setBoardContextMenu(null)}
          actions={[
            {
              label: "EDIT MAGNET",
              description: "Change this placed magnet's details",
              icon: "✎",
              onSelect: () => openEditor(boardContextMagnet),
            },
            {
              label: "DUPLICATE ON BOARD",
              description: "Create another copy nearby",
              icon: "⧉",
              onSelect: () => duplicateMagnet(boardContextMagnet),
            },
            {
              label: "REMOVE FROM BOARD",
              description: "The saved rack magnet stays available",
              icon: "−",
              danger: true,
              onSelect: () => { void removeMagnetFromBoard(boardContextMagnet); },
            },
          ]}
        />
      )}

      {presentation && tvShiftView !== "both" && (
        <header className={`tv-shift-header tv-shift-header-${tvShiftView}`}>
          <div className="tv-shift-brand">
            <span className="tv-shift-logo" aria-hidden="true" />
            <div>
              <small>WOODIE WOODIE OPERATIONS</small>
              <strong>LOAD &amp; HAUL</strong>
            </div>
          </div>
          <div className="tv-shift-title">
            <span>LIVE SHIFTBOARD</span>
            <h1>{tvShiftView === "day" ? "DAY SHIFT" : "NIGHT SHIFT"}</h1>
          </div>
          <div className="tv-shift-context">
            <span>BOARD DATE</span>
            <strong>{board.boardDate}</strong>
            <small>{board.roster}</small>
          </div>
          <div className="tv-shift-metrics" aria-label={`${tvShiftView} shift truck totals`}>
            <div><span>ALLOCATED</span><strong>{tvShiftStats.allocated}</strong></div>
            <div><span>UNALLOCATED</span><strong>{tvShiftStats.unallocated}</strong></div>
            <div><span>PARKED</span><strong>{totalParked}</strong></div>
          </div>
          <div className="tv-shift-live">
            <span><i aria-hidden="true" /> LIVE</span>
            <small>{formatUpdatedAt(board.updatedAt)}</small>
          </div>
          <div className="tv-shift-note">
            <strong>SHIFT NOTE</strong>
            <span>{tvShiftNote || "No shift note entered"}</span>
          </div>
        </header>
      )}

      <div className="board-scroll">
        <div
          className="board-stage"
          style={{
            width: presentation
              ? (tvShiftView === "both" ? BOARD_WIDTH : SHIFT_WIDTH) * tvScale
              : BOARD_WIDTH,
            height: presentation
              ? (tvShiftView === "both" ? BOARD_HEIGHT : TV_SINGLE_CONTENT_HEIGHT) * tvScale
              : BOARD_HEIGHT,
            overflow: presentation && tvShiftView !== "both" ? "hidden" : undefined,
          }}
        >
          <div
            ref={canvasRef}
            className={locked ? "magnet-canvas canvas-locked" : "magnet-canvas"}
            style={{
              width: BOARD_WIDTH,
              height: BOARD_HEIGHT,
              transform: presentation
                ? `scale(${tvScale}) translate(${tvShiftView === "night" ? -SHIFT_WIDTH : 0}px, ${tvShiftView === "both" ? 0 : -TV_SINGLE_CONTENT_TOP}px)`
                : undefined,
            } as CSSProperties}
            onDragOver={(event) => event.preventDefault()}
            onDrop={dropFromRack}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                setSelectedId(null);
                setBoardContextMenu(null);
              }
            }}
          >
            <BoardBackground truckStats={truckStats} parkUpCounts={parkUpCounts} board={board} />

            {board.magnets.map((item) => (
              isPitWorkAreaControl(item) && pitWorkAreaRows.has(item.id) ? (
                <div
                  key={item.id}
                  className="work-area-control"
                  data-magnet-id={item.id}
                  style={pitWorkAreaPosition(item, board.workSectionCount ?? 4, pitWorkAreaRows.get(item.id) as number)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <select
                    aria-label="Pit / work area"
                    value={item.primary}
                    disabled={locked || presentation}
                    onChange={(event) => {
                      if (event.target.value === "__edit_list__") setPitListOpen(true);
                      else changePitWorkArea(item, event.target.value);
                    }}
                  >
                    {!pitWorkAreaOptions.includes(item.primary) && <option value={item.primary}>{item.primary}</option>}
                    {pitWorkAreaOptions.map((pit) => <option key={pit} value={pit}>{pit}</option>)}
                    <option disabled>──────────</option>
                    <option value="__edit_list__">EDIT LIST…</option>
                  </select>
                  <button
                    type="button"
                    disabled={locked || presentation}
                    onClick={() => setPitDetailsMagnet(item)}
                    aria-label={isOreCartage(item.primary) ? `Edit stockpile location and colour for ${item.primary}` : `Edit RL and shot number for ${item.primary}`}
                    title={isOreCartage(item.primary) ? "Edit stockpile location and colour" : "Edit RL and shot number"}
                  >
                    <PitDetailsContent magnet={item} />
                  </button>
                </div>
              ) : isPitWorkAreaControl(item) ? null : isDiggerControl(item) && diggerRows.has(item.id) ? (
                <div
                  key={item.id}
                  className={`digger-control${item.equipmentStatus && item.equipmentStatus !== "available" ? ` equipment-status-${item.equipmentStatus}` : ""}${remoteActiveMagnetIds.has(item.id) ? " magnet-remote-active" : ""}`}
                  data-magnet-id={item.id}
                  style={diggerPosition(item, board.workSectionCount ?? 4, diggerRows.get(item.id) as number)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.preventDefault()}
                  onDoubleClick={() => { if (!locked && !presentation) openEditor(item); }}
                  title={magnetTitle(item)}
                >
                  <select
                    aria-label="Digger"
                    value={item.primary}
                    disabled={locked || presentation}
                    onChange={(event) => {
                      if (event.target.value === "__edit_list__") setDiggerListOpen(true);
                      else changeDigger(item, event.target.value);
                    }}
                  >
                    {!diggerOptions.includes(item.primary) && <option value={item.primary}>{item.primary}</option>}
                    {diggerOptions.map((digger) => <option key={digger} value={digger}>{digger}</option>)}
                    <option disabled>──────────</option>
                    <option value="__edit_list__">EDIT LIST…</option>
                  </select>
                  <span aria-hidden="true">⌄</span>
                </div>
              ) : isDiggerControl(item) ? null : (
              <button
                key={item.id}
                type="button"
                className={`magnet magnet-${item.kind} tone-${item.tone}${item.equipmentStatus && item.equipmentStatus !== "available" ? ` equipment-status-${item.equipmentStatus}` : ""}${selectedId === item.id ? " magnet-selected" : ""}${invalidDropId === item.id ? " magnet-drop-invalid" : ""}${linkedMagnetIds.has(item.id) ? " magnet-linked" : ""}${board.lastMovedId === item.id ? " magnet-last-moved" : ""}${remoteActiveMagnetIds.has(item.id) ? " magnet-remote-active" : ""}`}
                data-magnet-id={item.id}
                style={{
                  left: item.x,
                  top: item.y,
                  width: item.width,
                  height: item.height,
                  zIndex: item.z + 10,
                }}
                aria-label={magnetAccessibleText(item)}
                title={magnetTitle(item)}
                onPointerDown={(event) => handlePointerDown(event, item)}
                onPointerMove={handlePointerMove}
                onPointerUp={finishDrag}
                onPointerCancel={cancelPointerDrag}
                onLostPointerCapture={finishDrag}
                onDoubleClick={() => openEditor(item)}
                onContextMenu={(event) => {
                  if (locked || presentation) return;
                  event.preventDefault();
                  event.stopPropagation();
                  openBoardContextMenu(item, event.clientX, event.clientY);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  openBoardContextMenu(item, rect.left, rect.bottom + 4, 0);
                }}
              >
                <MagnetContent magnet={item} />
              </button>
              )
            ))}

            {!locked && !presentation && nextWorkSectionControls.map(({ side, pitRow, assetRow }) => (
              <div key={`add-work-section-controls-${side}`}>
                {pitRow !== null && (
                  <div
                    className="work-area-control empty-work-area-control"
                    style={pitWorkAreaPosition({ x: side === "day" ? 4 : SHIFT_WIDTH + 4, z: 1 }, board.workSectionCount ?? 4, pitRow)}
                  >
                    <select
                      aria-label={`Add pit or work area to ${side} shift section ${pitRow + 1}`}
                      value=""
                      onChange={(event) => {
                        if (event.target.value === "__edit_list__") setPitListOpen(true);
                        else if (event.target.value) addWorkSectionControl(side, pitRow, "location", event.target.value);
                      }}
                    >
                      <option value="">+ ADD PIT / AREA</option>
                      {pitWorkAreaOptions.map((pit) => <option key={pit} value={pit}>{pit}</option>)}
                      <option disabled>──────────</option>
                      <option value="__edit_list__">EDIT LIST…</option>
                    </select>
                  </div>
                )}
                {assetRow !== null && (
                  <div
                    className="digger-control empty-digger-control"
                    style={{
                      ...diggerPosition({ x: side === "day" ? 138 : SHIFT_WIDTH + 138, z: 1 }, board.workSectionCount ?? 4, assetRow),
                      width: 92,
                    }}
                  >
                    <select
                      aria-label={`Add asset to ${side} shift section ${assetRow + 1}`}
                      value=""
                      onChange={(event) => {
                        if (event.target.value === "__edit_list__") setDiggerListOpen(true);
                        else if (event.target.value) addWorkSectionControl(side, assetRow, "excavator", event.target.value);
                      }}
                    >
                      <option value="">+ ADD ASSET</option>
                      {diggerOptions.map((digger) => <option key={digger} value={digger}>{digger}</option>)}
                      <option disabled>──────────</option>
                      <option value="__edit_list__">EDIT LIST…</option>
                    </select>
                    <span aria-hidden="true">⌄</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {presentation && (
        <div className="tv-controls" aria-label="TV view controls">
          <div className="tv-control-label"><span>DISPLAY</span><strong>TV VIEW</strong></div>
          <div className="tv-shift-selector" role="group" aria-label="Displayed shift">
            {(["both", "day", "night"] as TvShiftView[]).map((view) => (
              <button
                key={view}
                className={tvShiftView === view ? "active" : ""}
                type="button"
                aria-pressed={tvShiftView === view}
                onClick={() => setTvShiftView(view)}
              >
                {view === "both" ? "FULL BOARD" : view === "day" ? "DAY SHIFT" : "NIGHT SHIFT"}
              </button>
            ))}
          </div>
          <button className="exit-tv" type="button" onClick={() => setPresentation(false)}>
            EXIT
          </button>
        </div>
      )}

      {editorMagnet && (
        <MagnetEditor
          magnet={editorMagnet}
          isNew={isNewMagnet}
          inventoryMode={Boolean(inventoryEditingTemplate)}
          onClose={() => { setEditorMagnet(null); setInventoryEditingTemplate(null); }}
          onSave={inventoryEditingTemplate ? saveInventoryTemplate : saveMagnet}
          onDelete={deleteMagnet}
          onDuplicate={duplicateMagnet}
          onRemoveFromInventory={inventoryEditingTemplate ? () => {
            const template = inventoryEditingTemplate;
            void removeInventoryTemplate(template).then((removed) => {
              if (!removed) return;
              setEditorMagnet(null);
              setInventoryEditingTemplate(null);
            });
          } : undefined}
        />
      )}

      {shiftEditorOpen && (
        <ShiftSettingsModal
          board={board}
          onClose={() => setShiftEditorOpen(false)}
          onSave={(boardDate, roster, shiftNote) => {
            const note = stateRef.current.magnets.find((magnet) => magnet.id === "shift-note");
            const magnets = note
              ? stateRef.current.magnets.map((magnet) => magnet.id === note.id ? { ...magnet, primary: shiftNote } : magnet)
              : stateRef.current.magnets;
            setShiftEditorOpen(false);
            void commitBoard({ ...stateRef.current, boardDate, roster, magnets });
          }}
        />
      )}

      {copyDialogOpen && (
        <ChoiceModal
          title="COPY SHIFT ALLOCATIONS"
          message="Choose the side to copy. The destination work area will be replaced; park-up lanes and R + R stay unchanged."
          onClose={() => setCopyDialogOpen(false)}
          choices={[
            { label: "DAY → NIGHT", onClick: () => copyShift("day") },
            { label: "NIGHT → DAY", onClick: () => copyShift("night") },
          ]}
        />
      )}

      {crewDialogOpen && (
        <ChoiceModal
          title="QUICK CREW ALLOCATION"
          message="Choose a crew and shift. Imported crew magnets are placed into free positions on that side of the whiteboard, ready to drag onto equipment."
          onClose={() => setCrewDialogOpen(false)}
          choices={(["A", "B", "C"] as CrewCode[]).flatMap((crew) => ([
            { label: `${crew} CREW → DAYS`, onClick: () => allocateCrew(crew, "day") },
            { label: `${crew} CREW → NIGHTS`, onClick: () => allocateCrew(crew, "night") },
          ]))}
        />
      )}

      {handoverOpen && (
        <HandoverModal board={board} onClose={() => setHandoverOpen(false)} onSave={saveHandoverSnapshot} />
      )}

      {readinessOpen && (
        <ReadinessModal
          issues={readinessIssues}
          onClose={() => setReadinessOpen(false)}
          onFocus={(magnetId) => {
            const magnet = stateRef.current.magnets.find((item) => item.id === magnetId);
            setReadinessOpen(false);
            if (magnet) focusMagnet(magnet);
          }}
        />
      )}

      {historyOpen && (
        <HistoryModal board={board} onClose={() => setHistoryOpen(false)} onRestore={restoreHistoryEntry} />
      )}

      {nextShiftOpen && (
        <NextShiftModal board={board} onClose={() => setNextShiftOpen(false)} onPrepare={prepareNextShift} />
      )}

      {warning && (
        <WarningModal warning={warning} onClose={() => setWarning(null)} />
      )}

      {confirmation && (
        <ConfirmationModal prompt={confirmation} onCancel={() => closeConfirmation(false)} onConfirm={() => closeConfirmation(true)} />
      )}

      {pitListOpen && (
        <PitWorkAreaListModal
          options={pitWorkAreaOptions}
          onClose={() => setPitListOpen(false)}
          onSave={(options) => {
            setPitListOpen(false);
            void commitBoard({ ...stateRef.current, pitWorkAreas: options });
          }}
        />
      )}

      {diggerListOpen && (
        <DiggerListModal
          options={diggerOptions}
          onClose={() => setDiggerListOpen(false)}
          onSave={(options) => {
            setDiggerListOpen(false);
            void commitBoard({ ...stateRef.current, diggerOptions: options });
          }}
        />
      )}

      {pitDetailsMagnet && (
        <PitDetailsModal
          magnet={pitDetailsMagnet}
          onClose={() => setPitDetailsMagnet(null)}
          onSave={(secondary, note) => {
            const current = stateRef.current;
            setPitDetailsMagnet(null);
            void commitBoard({
              ...current,
              magnets: current.magnets.map((item) => item.id === pitDetailsMagnet.id ? { ...item, secondary, note } : item),
            }, { movedId: pitDetailsMagnet.id, action: `Updated work-area details for ${pitDetailsMagnet.primary}` });
          }}
        />
      )}
    </main>
  );
}

function equipmentStatusLabel(status?: EquipmentStatus) {
  return EQUIPMENT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "AVAILABLE";
}

function magnetAccessibleText(magnet: Magnet) {
  return [
    magnet.fullName ?? magnet.primary,
    magnet.crew ? `${magnet.crew} Crew` : undefined,
    magnet.competencies?.length ? `passed out in ${magnet.competencies.join(", ")}` : undefined,
    magnet.equipmentStatus && magnet.equipmentStatus !== "available"
      ? `status ${equipmentStatusLabel(magnet.equipmentStatus)}`
      : undefined,
    magnet.note ? `note ${magnet.note}` : undefined,
  ].filter(Boolean).join(", ");
}

function magnetTitle(magnet: Magnet) {
  return [
    magnet.fullName,
    magnet.kind === "person"
      ? magnet.competencies?.length
        ? `Passed out in: ${magnet.competencies.join(", ")}`
        : "Competencies not yet recorded"
      : undefined,
    magnet.equipmentStatus && magnet.equipmentStatus !== "available"
      ? `Status: ${equipmentStatusLabel(magnet.equipmentStatus)}`
      : undefined,
    magnet.note ? `Note: ${magnet.note}` : undefined,
  ].filter(Boolean).join(" · ") || undefined;
}

function AllocationSummary({ snapshot, label }: { snapshot: BoardSnapshot; label: string }) {
  const stats = getAllocationStats(snapshot.state.magnets);
  return (
    <article className="allocation-summary">
      <span>{label}</span>
      <strong>{snapshot.name}</strong>
      <div>
        <p><b>{stats.dayAllocated}</b> DAY ALLOCATED<small>{stats.dayUnallocated} unallocated</small></p>
        <p><b>{stats.nightAllocated}</b> NIGHT ALLOCATED<small>{stats.nightUnallocated} unallocated</small></p>
      </div>
      <time>{formatUpdatedAt(snapshot.createdAt)} · {snapshot.createdBy}</time>
    </article>
  );
}

function HandoverModal({
  board,
  onClose,
  onSave,
}: {
  board: MagneticBoardState;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(`${board.boardDate} · ${board.roster}`);
  const snapshots = [...(board.snapshots ?? [])].reverse();
  const latest = snapshots[0];
  const previous = snapshots[1];
  const comparison = latest && previous ? compareBoardSnapshots(previous, latest) : null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="simple-modal operations-modal handover-modal" role="dialog" aria-modal="true" aria-label="Shift handover snapshots" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>SHIFT HANDOVER</span><h2>SAVE &amp; COMPARE</h2></div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <form onSubmit={(event) => { event.preventDefault(); onSave(name); }}>
          <p className="operations-intro">Save a named, restorable copy of the current board before handover. The two latest saved handovers are compared below.</p>
          <label>HANDOVER NAME<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <footer>
            <button className="secondary-button" type="button" onClick={onClose}>CANCEL</button>
            <button className="save-button" type="submit">SAVE HANDOVER</button>
          </footer>
        </form>
        <div className="operations-content">
          {latest ? (
            <>
              <div className="snapshot-comparison">
                {previous && <AllocationSummary snapshot={previous} label="PREVIOUS" />}
                <AllocationSummary snapshot={latest} label={previous ? "LATEST" : "LATEST SAVED"} />
              </div>
              {comparison && (
                <div className="changed-trucks">
                  <strong>CHANGED TRUCK ALLOCATIONS</strong>
                  <p>{comparison.changedTrucks.length ? comparison.changedTrucks.join(" · ") : "No truck allocation changes between these handovers."}</p>
                </div>
              )}
              <div className="saved-snapshot-list">
                <strong>SAVED HANDOVERS</strong>
                {snapshots.map((snapshot) => (
                  <p key={snapshot.id}><span>{snapshot.name}</span><time>{formatUpdatedAt(snapshot.createdAt)} · {snapshot.createdBy}</time></p>
                ))}
              </div>
            </>
          ) : <div className="operations-empty">No handover has been saved yet.</div>}
        </div>
      </section>
    </div>
  );
}

function ReadinessModal({
  issues,
  onClose,
  onFocus,
}: {
  issues: ReadinessIssue[];
  onClose: () => void;
  onFocus: (magnetId: string) => void;
}) {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="simple-modal operations-modal readiness-modal" role="dialog" aria-modal="true" aria-label="Pre-handover board check" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>PRE-HANDOVER CHECK</span><h2>BOARD READINESS</h2></div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="operations-content">
          {!issues.length ? (
            <div className="readiness-ready"><b>✓</b><strong>BOARD READY FOR HANDOVER</strong><span>No allocation, link, duplicate, overlap, or equipment-status issues found.</span></div>
          ) : (
            <>
              <div className="readiness-totals"><span className="issue-error">{errors} NEED FIXING</span><span className="issue-warning">{warnings} CHECK</span></div>
              <div className="readiness-list">
                {issues.map((issue) => (
                  <button
                    key={issue.id}
                    className={`readiness-issue issue-${issue.severity}`}
                    type="button"
                    disabled={!issue.magnetId}
                    onClick={() => issue.magnetId && onFocus(issue.magnetId)}
                  >
                    <i>{issue.severity === "error" ? "!" : "?"}</i>
                    <span><strong>{issue.title}</strong><small>{issue.detail}</small></span>
                    {issue.magnetId && <em>SHOW</em>}
                  </button>
                ))}
              </div>
            </>
          )}
          <footer className="operations-footer"><button className="save-button" type="button" onClick={onClose}>CLOSE CHECK</button></footer>
        </div>
      </section>
    </div>
  );
}

function HistoryModal({
  board,
  onClose,
  onRestore,
}: {
  board: MagneticBoardState;
  onClose: () => void;
  onRestore: (entry: BoardHistoryEntry) => void;
}) {
  const revisions = [...(board.historyVersions ?? [])].reverse();
  const audit = [...(board.auditLog ?? [])].reverse().slice(0, 30);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="simple-modal operations-modal history-modal" role="dialog" aria-modal="true" aria-label="Board change history" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>CHANGE HISTORY</span><h2>BOARD VERSIONS</h2></div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="operations-content history-columns">
          <section>
            <h3>RESTORABLE VERSIONS</h3>
            <p className="operations-intro">The latest ten saved changes can be restored. Restoring also keeps the current board in history.</p>
            <div className="history-list">
              {revisions.length ? revisions.map((entry) => (
                <article key={entry.id}>
                  <div><strong>{entry.action}</strong><time>{formatUpdatedAt(entry.createdAt)} · {entry.createdBy}</time></div>
                  <button type="button" onClick={() => onRestore(entry)}>RESTORE</button>
                </article>
              )) : <div className="operations-empty">No restorable changes yet.</div>}
            </div>
          </section>
          <section>
            <h3>RECENT ACTIVITY</h3>
            <div className="audit-list">
              {audit.length ? audit.map((entry) => (
                <p key={entry.id}><span>{entry.action}</span><time>{formatUpdatedAt(entry.createdAt)} · {entry.createdBy}</time></p>
              )) : <div className="operations-empty">No activity recorded yet.</div>}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function NextShiftModal({
  board,
  onClose,
  onPrepare,
}: {
  board: MagneticBoardState;
  onClose: () => void;
  onPrepare: (options: { boardDate: string; dayCrew?: CrewCode; nightCrew?: CrewCode; retainShiftNote: boolean }) => void;
}) {
  const [boardDate, setBoardDate] = useState(suggestedNextBoardDate(board.boardDate));
  const [dayCrew, setDayCrew] = useState<CrewCode | "">("");
  const [nightCrew, setNightCrew] = useState<CrewCode | "">("");
  const [retainShiftNote, setRetainShiftNote] = useState(false);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="simple-modal operations-modal next-shift-modal" role="dialog" aria-modal="true" aria-label="Prepare next shift" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>SHIFT SETUP</span><h2>PREPARE NEXT SHIFT</h2></div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <form onSubmit={(event) => {
          event.preventDefault();
          onPrepare({ boardDate, dayCrew: dayCrew || undefined, nightCrew: nightCrew || undefined, retainShiftNote });
        }}>
          <div className="next-shift-notice"><strong>CURRENT BOARD SAVED FIRST</strong><span>Equipment, locations, status and notes stay in place. Existing working-area operators are replaced by the selected crews.</span></div>
          <label>NEW BOARD DATE<input required value={boardDate} onChange={(event) => setBoardDate(event.target.value)} /></label>
          <div className="next-shift-crews">
            <label>DAY CREW<select value={dayCrew} onChange={(event) => setDayCrew(event.target.value as CrewCode | "")}><option value="">NOT SET</option><option value="A">A CREW</option><option value="B">B CREW</option><option value="C">C CREW</option></select></label>
            <label>NIGHT CREW<select value={nightCrew} onChange={(event) => setNightCrew(event.target.value as CrewCode | "")}><option value="">NOT SET</option><option value="A">A CREW</option><option value="B">B CREW</option><option value="C">C CREW</option></select></label>
          </div>
          <label className="retain-note-option"><input type="checkbox" checked={retainShiftNote} onChange={(event) => setRetainShiftNote(event.target.checked)} /><span><b>KEEP CURRENT SHIFT NOTE</b><small>Leave unticked to clear the note for the incoming shift.</small></span></label>
          <footer>
            <button className="secondary-button" type="button" onClick={onClose}>CANCEL</button>
            <button className="save-button" type="submit">PREPARE BOARD</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function PitDetailsModal({ magnet, onClose, onSave }: { magnet: Magnet; onClose: () => void; onSave: (secondary?: string, note?: string) => void }) {
  const oreCartage = isOreCartage(magnet.primary);
  const initial = parseLocationDetails(magnet.secondary);
  const initialOre = parseOreCartageDetails(magnet.secondary);
  const [rl, setRl] = useState(initial.rl);
  const [shot, setShot] = useState(initial.shot);
  const [directOreColour, setDirectOreColour] = useState(initial.directOreColour);
  const [stockpile, setStockpile] = useState(initialOre.stockpile);
  const [colour, setColour] = useState(initialOre.colour);
  const [note, setNote] = useState(magnet.note ?? "");
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="simple-modal pit-details-modal" role="dialog" aria-modal="true" aria-label={oreCartage ? "Edit ore cartage stockpile details" : `Edit RL and shot number for ${magnet.primary}`} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>PIT / WORK AREA</span><h2>{magnet.primary}</h2></div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <form onSubmit={(event) => {
          event.preventDefault();
          onSave((oreCartage ? formatOreCartageDetails(stockpile, colour) : formatLocationDetails(rl, shot, directOreColour)) || undefined, note.trim() || undefined);
        }}>
          {oreCartage ? (
            <>
              <p className="ore-cartage-note">ORE CARTAGE GOING DIRECT TO THE CRUSH PAD</p>
              <div className="pit-details-grid">
                <label>STOCKPILE LOCATION<input autoFocus placeholder="E.G. ROM 2" value={stockpile} onChange={(event) => setStockpile(event.target.value)} /></label>
                <label>COLOUR<input placeholder="E.G. BLUE" value={colour} onChange={(event) => setColour(event.target.value)} /></label>
              </div>
            </>
          ) : (
            <div className="pit-details-grid">
              <label>RL<input autoFocus placeholder="E.G. 219" value={rl} onChange={(event) => setRl(event.target.value)} /></label>
              <label>SHOT NUMBER<input placeholder="E.G. 5405" value={shot} onChange={(event) => setShot(event.target.value)} /></label>
              <label className="pit-detail-wide">DIRECT ORE COLOURS (OPTIONAL)<input placeholder="E.G. GREEN, BLUE" value={directOreColour} onChange={(event) => setDirectOreColour(event.target.value)} /><small>Separate multiple colours with commas.</small></label>
            </div>
          )}
          <label>BOARD NOTE (OPTIONAL)<textarea rows={3} placeholder="E.G. DEWATERING IN PROGRESS" value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <footer>
            <button className="secondary-button" type="button" onClick={onClose}>CANCEL</button>
            <button className="save-button" type="submit">SAVE DETAILS</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function DiggerListModal({ options, onClose, onSave }: { options: string[]; onClose: () => void; onSave: (options: string[]) => void }) {
  const [value, setValue] = useState(options.join("\n"));
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="simple-modal pit-list-modal" role="dialog" aria-modal="true" aria-label="Edit digger list" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>BOARD SETTINGS</span><h2>EDIT DIGGER LIST</h2></div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <form onSubmit={(event) => {
          event.preventDefault();
          const next = [...new Set(value.split(/\r?\n/).map((item) => item.trim().toUpperCase()).filter(Boolean))];
          if (next.length) onSave(next);
        }}>
          <p>Enter one digger number per line. You can add, rename, remove, or reorder entries.</p>
          <label>AVAILABLE DIGGERS<textarea autoFocus rows={12} value={value} onChange={(event) => setValue(event.target.value)} /></label>
          <footer>
            <button className="secondary-button" type="button" onClick={onClose}>CANCEL</button>
            <button className="save-button" type="submit">SAVE LIST</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function PitWorkAreaListModal({ options, onClose, onSave }: { options: string[]; onClose: () => void; onSave: (options: string[]) => void }) {
  const [value, setValue] = useState(options.join("\n"));
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="simple-modal pit-list-modal" role="dialog" aria-modal="true" aria-label="Edit pit and work area list" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>BOARD SETTINGS</span><h2>EDIT PIT / WORK AREA LIST</h2></div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <form onSubmit={(event) => {
          event.preventDefault();
          const next = [...new Set(value.split(/\r?\n/).map((item) => item.trim().toUpperCase()).filter(Boolean))];
          if (next.length) onSave(next);
        }}>
          <p>Enter one pit or work area per line. You can add, rename, remove, or reorder entries.</p>
          <label>AVAILABLE PIT / WORK AREAS<textarea autoFocus rows={14} value={value} onChange={(event) => setValue(event.target.value)} /></label>
          <footer>
            <button className="secondary-button" type="button" onClick={onClose}>CANCEL</button>
            <button className="save-button" type="submit">SAVE LIST</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function ConfirmationModal({ prompt, onCancel, onConfirm }: { prompt: ConfirmationPrompt; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop confirmation-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message" onMouseDown={(event) => event.stopPropagation()}>
        <div className="confirmation-symbol" aria-hidden="true">?</div>
        <div className="confirmation-copy">
          <span>CONFIRM BOARD ACTION</span>
          <h2 id="confirmation-title">{prompt.title}</h2>
          <p id="confirmation-message">{prompt.message}</p>
        </div>
        <button className="warning-close" type="button" onClick={onCancel} aria-label="Cancel action">×</button>
        <footer>
          <button className="secondary-button confirmation-cancel" type="button" onClick={onCancel}>CANCEL</button>
          <button className="confirmation-confirm" type="button" onClick={onConfirm} autoFocus>{prompt.confirmLabel}</button>
        </footer>
      </section>
    </div>
  );
}

function WarningModal({ warning, onClose }: { warning: BoardWarning; onClose: () => void }) {
  return (
    <div className="modal-backdrop warning-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="warning-modal" role="alertdialog" aria-modal="true" aria-labelledby="warning-title" aria-describedby="warning-message" onMouseDown={(event) => event.stopPropagation()}>
        <div className="warning-symbol" aria-hidden="true">!</div>
        <div className="warning-copy">
          <span>SHIFTBOARD WARNING</span>
          <h2 id="warning-title">{warning.title}</h2>
          <p id="warning-message">{warning.message}</p>
        </div>
        <button className="warning-close" type="button" onClick={onClose} aria-label="Close warning">×</button>
        <footer>
          <button className="warning-confirm" type="button" onClick={onClose} autoFocus>UNDERSTOOD</button>
        </footer>
      </section>
    </div>
  );
}

function MagnetContent({ magnet }: { magnet: Magnet }) {
  const indicators = (
    <>
      {magnet.equipmentStatus && magnet.equipmentStatus !== "available" && (
        <i className="magnet-status-dot" aria-hidden="true" />
      )}
      {magnet.note && <i className="magnet-note-indicator" aria-hidden="true">N</i>}
    </>
  );
  if (magnet.kind === "location") {
    return (
      <>
        <strong>{magnet.crew ? magnet.primary.split(" ")[0] : magnet.primary}</strong>
        {magnet.secondary && <span>{magnet.secondary}</span>}
        {indicators}
      </>
    );
  }

  if (magnet.kind === "person") {
    return (
      <>
        {magnet.secondary && <small>{magnet.secondary}</small>}
        <strong>{magnet.primary}</strong>
        {indicators}
      </>
    );
  }

  return <><strong>{magnet.primary}</strong>{indicators}</>;
}

function BoardBackground({
  truckStats,
  parkUpCounts,
  board,
}: {
  truckStats: { dayAllocated: number; dayUnallocated: number; nightAllocated: number; nightUnallocated: number };
  parkUpCounts: Record<string, number>;
  board: MagneticBoardState;
}) {
  return (
    <div className="board-background" aria-hidden="true">
      <header className="main-board-header">
        <Image
          src="/ConsminLogo.png"
          alt="ConsMin"
          width={540}
          height={72}
          priority
          unoptimized
        />
        <div className="main-title">
          <span>WOODIE WOODIE OPERATIONS</span>
          <h1>LOAD AND HAUL SHIFTBOARD</h1>
        </div>
        <div className="allocation-count">
          <div><b>DAY</b><strong>{truckStats.dayAllocated}</strong><span>ALLOC</span><em>{truckStats.dayUnallocated} UNALLOC</em></div>
          <div><b>NIGHT</b><strong>{truckStats.nightAllocated}</strong><span>ALLOC</span><em>{truckStats.nightUnallocated} UNALLOC</em></div>
        </div>
      </header>

      <div className="fixed-notice"><strong>SHIFT NOTE</strong></div>

      <section className="fixed-shift-heading fixed-day-heading">
        <strong>DAY SHIFT</strong>
        <span>TEAM LEADERS</span>
      </section>
      <section className="fixed-shift-heading fixed-night-heading">
        <strong>NIGHT SHIFT</strong>
        <span>TEAM LEADERS</span>
      </section>
      <div className="column-heading day-columns">
        <span>PIT / WORK AREA</span><span>ASSET </span><span>TRUCKS / OPERATORS</span>
      </div>
      <div className="column-heading night-columns">
        <span>PIT / WORK AREA</span><span>ASSET </span><span>TRUCKS / OPERATORS</span>
      </div>

      <div className={`fixed-work-grid day-work-grid work-sections-${board.workSectionCount ?? 4}`} />
      <div className={`fixed-work-grid night-work-grid work-sections-${board.workSectionCount ?? 4}`} />
      <FloorPickupGaps side="day" sectionCount={board.workSectionCount ?? 4} magnets={board.magnets} />
      <FloorPickupGaps side="night" sectionCount={board.workSectionCount ?? 4} magnets={board.magnets} />

      <BoardBands parkUpCounts={parkUpCounts} />

      <footer className="fixed-footer">
        <span>LAST UPDATED {formatUpdatedAt(board.updatedAt)} · {board.updatedBy}</span>
        <span><i /> LIVE · ALL CHANGES SAVED</span>
      </footer>
    </div>
  );
}

function FloorPickupGaps({ side, sectionCount, magnets }: { side: "day" | "night"; sectionCount: WorkSectionCount; magnets: Magnet[] }) {
  const oreCartageSections = new Set(
    magnets
      .filter((magnet) => isPitWorkAreaControl(magnet) && magnetShiftSide(magnet) === side)
      .sort((a, b) => a.y - b.y || a.id.localeCompare(b.id))
      .slice(0, sectionCount)
      .map((magnet, index) => isOreCartage(magnet.primary) ? index : -1)
      .filter((index) => index >= 0),
  );
  return (
    <div className={`floor-pickup-gaps ${side}-floor-pickup-gaps work-sections-${sectionCount}`}>
      {Array.from({ length: sectionCount }, (_, index) => (
        <div className="floor-pickup-row" key={index}>
          {!oreCartageSections.has(index) && <span>END-OF-SHIFT FLOOR PARK-UP · LV PICKUP</span>}
        </div>
      ))}
    </div>
  );
}

function BoardBands({ parkUpCounts }: { parkUpCounts: Record<string, number> }) {
  return (
    <div className="fixed-bands">
      {PARK_UP_ROWS.map((row) => (
        <div
          className="park-up-row"
          key={row.label}
          style={{ gridTemplateColumns: `82px repeat(${row.zones.length}, minmax(0, 1fr))` }}
        >
          <strong className={`band-${row.tone}`}>{row.label}</strong>
          {row.zones.map((zone) => (
            <span className="park-up-zone" key={zone}>
              {zone}<b>{parkUpCounts[zone] ?? 0}</b>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function ShiftSettingsModal({
  board,
  onClose,
  onSave,
}: {
  board: MagneticBoardState;
  onClose: () => void;
  onSave: (boardDate: string, roster: string, shiftNote: string) => void;
}) {
  const [boardDate, setBoardDate] = useState(board.boardDate);
  const [roster, setRoster] = useState(board.roster);
  const [shiftNote, setShiftNote] = useState(
    board.magnets.find((magnet) => magnet.id === "shift-note")?.primary ?? "",
  );

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="simple-modal" role="dialog" aria-modal="true" aria-label="Shift change and note" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>BOARD DETAILS</span><h2>SHIFT CHANGE</h2></div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <form onSubmit={(event) => {
          event.preventDefault();
          onSave(boardDate.trim().toUpperCase(), roster.trim().toUpperCase(), shiftNote.trim());
        }}>
          <label>BOARD DATE<input required value={boardDate} onChange={(event) => setBoardDate(event.target.value)} /></label>
          <label>ROSTER / SHIFT<input required value={roster} onChange={(event) => setRoster(event.target.value)} /></label>
          <label>SHIFT NOTE<textarea rows={3} value={shiftNote} onChange={(event) => setShiftNote(event.target.value)} /></label>
          <footer>
            <button className="secondary-button" type="button" onClick={onClose}>CANCEL</button>
            <button className="save-button" type="submit">SAVE SHIFT</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function ChoiceModal({
  title,
  message,
  choices,
  onClose,
}: {
  title: string;
  message: string;
  choices: Array<{ label: string; onClick: () => void }>;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="simple-modal choice-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>QUICK ACTION</span><h2>{title}</h2></div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="choice-content">
          <p>{message}</p>
          <div>{choices.map((choice) => <button className="save-button" type="button" key={choice.label} onClick={choice.onClick}>{choice.label}</button>)}</div>
        </div>
      </section>
    </div>
  );
}

function MagnetEditor({
  magnet,
  isNew,
  inventoryMode = false,
  onClose,
  onSave,
  onDelete,
  onDuplicate,
  onRemoveFromInventory,
}: {
  magnet: Magnet;
  isNew: boolean;
  inventoryMode?: boolean;
  onClose: () => void;
  onSave: (magnet: Magnet, saveToInventory?: boolean) => void;
  onDelete: (id: string) => void;
  onDuplicate: (magnet: Magnet) => void;
  onRemoveFromInventory?: () => void;
}) {
  const [draft, setDraft] = useState(magnet);
  const [saveToInventory, setSaveToInventory] = useState(false);
  const locationDetails = parseLocationDetails(draft.secondary);
  const oreCartageDetails = parseOreCartageDetails(draft.secondary);
  const simplifiedAsset = attachableMagnetKinds.has(draft.kind);

  const changeKind = (kind: MagnetKind) => {
    const base = newMagnet(kind);
    setDraft({
      ...draft,
      kind,
      tone: base.tone,
      width: base.width,
      height: base.height,
      secondary: kind === "location" || kind === "person" || kind === "note"
        ? draft.secondary
        : undefined,
      attachedTo: undefined,
      crew: kind === "person" ? draft.crew : undefined,
      competencies: kind === "person" ? draft.competencies : undefined,
      fullName: kind === "person" ? draft.fullName : undefined,
      equipmentStatus: attachableMagnetKinds.has(kind) ? draft.equipmentStatus : undefined,
    });
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="magnet-modal"
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? "Add magnet" : `Edit ${magnet.primary}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>MAGNET CONTROL</span>
            <h2>{inventoryMode ? "EDIT SAVED MAGNET" : isNew ? "ADD MAGNET" : "EDIT MAGNET"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave({
              ...draft,
              primary: draft.primary.trim().toUpperCase(),
              secondary: draft.secondary?.trim().toUpperCase() || undefined,
              note: draft.note?.trim() || undefined,
              width: responsiveMagnetWidth(
                draft.kind,
                draft.primary,
                draft.secondary?.trim(),
              ) ?? draft.width,
            }, saveToInventory);
          }}
        >
          <div className="editor-grid">
            <label>
              MAGNET TYPE
              <select value={draft.kind} onChange={(event) => changeKind(event.target.value as MagnetKind)}>
                {(Object.keys(magnetKindLabels) as MagnetKind[]).map((kind) => (
                  <option key={kind} value={kind}>{magnetKindLabels[kind]}</option>
                ))}
              </select>
            </label>
            {draft.kind === "location" ? (
              <>
                <label>
                  PIT / WORK AREA
                  <input required list="pit-work-area-editor-options" value={draft.primary} onChange={(event) => setDraft({ ...draft, primary: event.target.value })} />
                  <datalist id="pit-work-area-editor-options">
                    {PIT_WORK_AREA_OPTIONS.map((pit) => <option key={pit} value={pit} />)}
                  </datalist>
                </label>
                {isOreCartage(draft.primary) ? (
                  <>
                    <label>
                      STOCKPILE LOCATION
                      <input
                        placeholder="E.G. ROM 2"
                        value={oreCartageDetails.stockpile}
                        onChange={(event) => setDraft({ ...draft, secondary: formatOreCartageDetails(event.target.value, oreCartageDetails.colour) })}
                      />
                    </label>
                    <label>
                      COLOUR
                      <input
                        placeholder="E.G. BLUE"
                        value={oreCartageDetails.colour}
                        onChange={(event) => setDraft({ ...draft, secondary: formatOreCartageDetails(oreCartageDetails.stockpile, event.target.value) })}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      RL
                      <input
                        placeholder="E.G. 219"
                        value={locationDetails.rl}
                        onChange={(event) => setDraft({ ...draft, secondary: formatLocationDetails(event.target.value, locationDetails.shot, locationDetails.directOreColour) })}
                      />
                    </label>
                    <label>
                      SHOT NUMBER
                      <input
                        placeholder="E.G. 5405"
                        value={locationDetails.shot}
                        onChange={(event) => setDraft({ ...draft, secondary: formatLocationDetails(locationDetails.rl, event.target.value, locationDetails.directOreColour) })}
                      />
                    </label>
                    <label>
                      DIRECT ORE COLOURS (OPTIONAL)
                      <input
                        placeholder="E.G. GREEN, BLUE"
                        value={locationDetails.directOreColour}
                        onChange={(event) => setDraft({ ...draft, secondary: formatLocationDetails(locationDetails.rl, locationDetails.shot, event.target.value) })}
                      />
                    </label>
                  </>
                )}
              </>
            ) : (
              <>
                <label>
                  MAIN TEXT
                  <input required value={draft.primary} onChange={(event) => setDraft({ ...draft, primary: event.target.value })} />
                </label>
                {!simplifiedAsset && draft.kind !== "person" && (
                  <label className="editor-wide">
                    SECOND LINE / OPERATOR
                    <input value={draft.secondary ?? ""} onChange={(event) => setDraft({ ...draft, secondary: event.target.value })} />
                  </label>
                )}
              </>
            )}
            {draft.kind === "person" && (
              <>
                <label>
                  CREW
                  <select value={draft.crew ?? ""} onChange={(event) => setDraft({ ...draft, crew: (event.target.value || undefined) as CrewCode | undefined })}>
                    <option value="">NOT SET</option>
                    <option value="A">A CREW</option>
                    <option value="B">B CREW</option>
                    <option value="C">C CREW</option>
                  </select>
                </label>
                <label className="editor-wide">
                  PASSED OUT IN / COMPETENCIES
                  <input
                    placeholder="E.G. HAUL TRUCK 777, DOZER, WATER CART"
                    value={draft.competencies?.join(", ") ?? ""}
                    onChange={(event) => setDraft({ ...draft, competencies: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })}
                  />
                </label>
              </>
            )}
            {isNew && (attachableMagnetKinds.has(draft.kind) || draft.kind === "person") && (
              <label className="inventory-save-option editor-wide">
                <input type="checkbox" checked={saveToInventory} onChange={(event) => setSaveToInventory(event.target.checked)} />
                KEEP IN SAVED MAGNET RACK
                <small>Available after reload and included in future reset and crew allocation actions.</small>
              </label>
            )}
            {!inventoryMode && attachableMagnetKinds.has(draft.kind) && (
              <label>
                EQUIPMENT STATUS
                <select
                  value={draft.equipmentStatus ?? "available"}
                  onChange={(event) => setDraft({ ...draft, equipmentStatus: event.target.value as EquipmentStatus })}
                >
                  {EQUIPMENT_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            )}
            {!inventoryMode && (
              <label className="editor-wide">
                BOARD NOTE (OPTIONAL)
                <textarea
                  rows={3}
                  placeholder="E.G. CHANGE-OUT DUE AFTER SMOKO"
                  value={draft.note ?? ""}
                  onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                />
              </label>
            )}
          </div>

          {!simplifiedAsset && (
            <div className="editor-preview">
              <span>PREVIEW</span>
              <div className={`magnet preview-magnet magnet-${draft.kind} tone-${draft.tone}`} style={{ width: draft.width, height: draft.height }}>
                <MagnetContent magnet={draft} />
              </div>
            </div>
          )}

          <footer>
            {!isNew && !inventoryMode && <button className="danger-button" type="button" onClick={() => onDelete(draft.id)}>DELETE</button>}
            {!isNew && !inventoryMode && <button className="secondary-button" type="button" onClick={() => onDuplicate(draft)}>DUPLICATE</button>}
            {inventoryMode && onRemoveFromInventory && <button className="danger-button" type="button" onClick={onRemoveFromInventory}>DELETE PERMANENTLY</button>}
            <span />
            <button className="secondary-button" type="button" onClick={onClose}>CANCEL</button>
            <button className="save-button" type="submit">{inventoryMode ? "SAVE TO RACK" : "SAVE MAGNET"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
