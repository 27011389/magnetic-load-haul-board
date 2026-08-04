"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  SHIFT_WIDTH,
  LEGACY_ACTIVE_WIDTH,
  LEGACY_PARK_UP_TOP,
  LEGACY_WORK_ROWS_TOP,
  LEGACY_WORK_ROW_HEIGHT,
  PARK_UP_TOP,
  WORK_ROWS_TOP,
  compactBoardY,
  compactCurrentMagnetWidths,
  compactMagnetHeight,
  compactFiveSectionMagnets,
  expandShiftBoardX,
  spreadFourSectionMagnets,
  crewRosters,
  responsiveMagnetWidth,
  defaultMagneticBoard,
  kindDefaults,
  magnetInventory,
  magnetKindLabels,
  magnetToneOptions,
  type Magnet,
  type CrewCode,
  type MagnetKind,
  type MagnetTemplate,
  type MagneticBoardState,
} from "./board-data";

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
};

type ShiftSide = "day" | "night";
type TvShiftView = "both" | ShiftSide;

const ATTACH_DISTANCE = 36;
const ATTACH_GAP = 4;
const TV_SHARED_HEADER_HEIGHT = 100;
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
const ATTACHABLE_KINDS = new Set<MagnetKind>([
  "truck", "dozer", "grader", "watercart", "excavator",
  "loader", "lightvehicle", "support",
]);

const PARK_UP_ROWS = [
  { label: "GO LINE", tone: "green", zones: ["TOPVAR GO LINE", "RADIO HILL GO LINE", "CHRIS D GO LINE"] },
  { label: "SHUT PAD", tone: "red", zones: ["RADIO HILL SHUT PAD", "CORGAN SHUT PAD", "CHRIS D SHUT PAD", "BIG MACK SHUT PAD"] },
  { label: "WORKSHOP", tone: "orange", zones: ["WORKSHOP GO LINE", "WORKSHOP"] },
  { label: "STANDBY", tone: "slate", zones: ["UNALLOCATED / STANDBY"] },
  { label: "GRAVEYARD", tone: "violet", zones: ["LONG-TERM PARK-UP"] },
] as const;

// Reserve the printed lane-name area at the start of each bottom zone.
const PARK_UP_ZONE_LABEL_CLEARANCE = 150;

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

function countParkUpZones(magnets: Magnet[]) {
  const counts: Record<string, number> = Object.fromEntries(
    PARK_UP_ROWS.flatMap((row) => row.zones.map((zone) => [zone, 0])),
  );
  const equipment = magnets.filter((magnet) => ATTACHABLE_KINDS.has(magnet.kind));
  const innerLeft = 8;
  const innerWidth = BOARD_WIDTH - 16;
  const labelWidth = 82;

  PARK_UP_ROWS.forEach((row, rowIndex) => {
    const rowTop = PARK_UP_TOP + 3 + rowIndex * 22;
    const zoneWidth = (innerWidth - labelWidth - row.zones.length * 3) / row.zones.length;
    row.zones.forEach((zone, zoneIndex) => {
      const zoneLeft = innerLeft + labelWidth + 3 + zoneIndex * (zoneWidth + 3);
      const zoneRight = zoneLeft + zoneWidth;
      counts[zone] = equipment.filter((magnet) => {
        const centreX = magnet.x + magnet.width / 2;
        const centreY = magnet.y + magnet.height / 2;
        return centreX >= zoneLeft && centreX < zoneRight && centreY >= rowTop && centreY < rowTop + 20;
      }).length;
    });
  });

  return counts;
}

function parkUpZoneRects() {
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
}

function snapGroupToParkUpZone(magnets: Magnet[], id: string) {
  const anchor = magnets.find((magnet) => magnet.id === id);
  if (!anchor) return null;
  const centreX = anchor.x + anchor.width / 2;
  const centreY = anchor.y + anchor.height / 2;
  const zone = parkUpZoneRects().find((rect) =>
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

const snapValue = (value: number, enabled: boolean) =>
  enabled ? Math.round(value / 10) * 10 : Math.round(value);

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
      .filter((candidate) => ATTACHABLE_KINDS.has(candidate.kind) && !claimed.has(candidate.id))
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
    ...(anchor && ATTACHABLE_KINDS.has(anchor.kind)
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

function cleanUpTruckMagnets(magnets: Magnet[], sectionCount: 4 | 5) {
  const truckTemplates = magnetInventory.filter((template) => template.kind === "truck");
  const sectionHeight = (PARK_UP_TOP - WORK_ROWS_TOP) / sectionCount;
  const existingTrucks = magnets.filter((magnet) => magnet.kind === "truck");
  const retained = magnets.filter((magnet) => magnet.kind !== "truck");
  const cleanedTrucks: Magnet[] = [];
  const truckPositions = new Map<string, Magnet>();
  let nextZ = Math.max(1, ...magnets.map((magnet) => magnet.z)) + 1;

  (["day", "night"] as ShiftSide[]).forEach((side) => {
    const left = side === "day" ? 0 : SHIFT_WIDTH;
    const sideTrucks = existingTrucks.filter((magnet) => magnet.x >= left && magnet.x < left + SHIFT_WIDTH);
    const byUnit = new Map(sideTrucks.map((magnet) => [magnet.primary.toUpperCase(), magnet]));
    const groups: Magnet[][] = Array.from({ length: sectionCount }, () => []);

    truckTemplates.forEach((template) => {
      const existing = byUnit.get(template.primary.toUpperCase());
      const magnet: Magnet = existing ?? {
        ...template,
        id: `fleet-${side}-${template.primary.toLowerCase()}`,
        x: left + 270,
        y: WORK_ROWS_TOP,
        z: nextZ++,
      };
      if (existing) {
        const row = Math.max(0, Math.min(sectionCount - 1, Math.floor((existing.y - WORK_ROWS_TOP) / sectionHeight)));
        groups[row].push(magnet);
      } else {
        const smallestGroup = groups.reduce((best, group) => group.length < best.length ? group : best, groups[0]);
        smallestGroup.push(magnet);
      }
    });

    groups.forEach((group, row) => {
      group.sort((a, b) => a.primary.localeCompare(b.primary, undefined, { numeric: true }));
      group.forEach((magnet, index) => {
        const stackRow = index % 4;
        const column = Math.floor(index / 4);
        const positioned = {
          ...magnet,
          x: left + 270 + column * 145,
          y: Math.round(WORK_ROWS_TOP + row * sectionHeight + 68 + stackRow * 22),
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

function resetAuxiliaryMagnetsToMiddle(magnets: Magnet[]) {
  const auxiliaryTemplates = magnetInventory.filter((template) =>
    template.kind === "grader" ||
    template.kind === "dozer" ||
    (template.kind === "watercart" && AUX_WATER_UNITS.has(template.primary)) ||
    (template.kind === "support" && template.primary === "WD001"),
  );
  const existingAux = magnets.filter(isAuxiliaryMagnet);
  const existingAuxIds = new Set(existingAux.map((magnet) => magnet.id));
  const retained = magnets.filter((magnet) => !isAuxiliaryMagnet(magnet));
  const cleanedAux: Magnet[] = [];
  const auxPositions = new Map<string, Magnet>();
  let nextZ = Math.max(1, ...magnets.map((magnet) => magnet.z)) + 1;

  (["day", "night"] as ShiftSide[]).forEach((side) => {
    const left = side === "day" ? 0 : SHIFT_WIDTH;
    const sideAux = existingAux.filter((magnet) => magnet.x >= left && magnet.x < left + SHIFT_WIDTH);
    const byUnit = new Map(sideAux.map((magnet) => [canonicalAuxUnit(magnet.primary), magnet]));
    const sideMagnets = auxiliaryTemplates.map((template) => {
      const existing = byUnit.get(template.primary);
      return existing ? { ...existing, kind: template.kind, primary: template.primary, tone: template.tone } : {
        ...template,
        id: `aux-${side}-${template.primary.toLowerCase()}`,
        x: left + SHIFT_WIDTH / 2,
        y: WORK_ROWS_TOP,
        z: nextZ++,
      };
    });

    const byResetUnit = new Map(sideMagnets.map((magnet) => [magnet.primary, magnet]));
    AUX_RESET_COLUMNS.forEach((units, column) => {
      units.forEach((unit, row) => {
        const magnet = byResetUnit.get(unit);
        if (!magnet) return;
        const positioned = {
          ...magnet,
          x: Math.round(left + 600 + column * 64),
          y: WORK_ROWS_TOP + 4 + row * 22,
          height: 20,
          z: nextZ++,
        };
        cleanedAux.push(positioned);
        auxPositions.set(positioned.id, positioned);
      });
    });
  });

  const repositioned = retained.map((magnet) => {
    if (magnet.kind !== "person" || !magnet.attachedTo) return magnet;
    const auxiliary = auxPositions.get(magnet.attachedTo);
    if (auxiliary) return { ...magnet, x: auxiliary.x + auxiliary.width + 4, y: auxiliary.y, z: auxiliary.z + 1 };
    return existingAuxIds.has(magnet.attachedTo) ? { ...magnet, attachedTo: undefined } : magnet;
  });

  return [...repositioned, ...cleanedAux];
}

function attachPersonToNearestEquipment(magnets: Magnet[], personId: string) {
  const person = magnets.find((magnet) => magnet.id === personId && magnet.kind === "person");
  if (!person) return magnets;
  const occupiedTargets = new Set(
    magnets.filter((magnet) => magnet.kind === "person" && magnet.id !== personId && magnet.attachedTo)
      .map((magnet) => magnet.attachedTo as string),
  );
  const targets = magnets
    .filter((magnet) => ATTACHABLE_KINDS.has(magnet.kind) && !occupiedTargets.has(magnet.id))
    .map((target) => ({ target, distance: rectangleDistance(person, target) }))
    .filter(({ target, distance }) =>
      distance <= ATTACH_DISTANCE && person.x + person.width / 2 >= target.x + target.width,
    )
    .sort((a, b) => a.distance - b.distance);

  for (const { target } of targets) {
    const candidate = {
      ...person,
      x: target.x + target.width + ATTACH_GAP,
      y: target.y + (target.height - person.height) / 2,
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

export default function Home() {
  const [board, setBoard] = useState<MagneticBoardState>(defaultMagneticBoard);
  const [locked, setLocked] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [presentation, setPresentation] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [invalidDropId, setInvalidDropId] = useState<string | null>(null);
  const [editorMagnet, setEditorMagnet] = useState<Magnet | null>(null);
  const [isNewMagnet, setIsNewMagnet] = useState(false);
  const [rackOpen, setRackOpen] = useState(false);
  const [rackKind, setRackKind] = useState<MagnetKind | "all">("all");
  const [rackSearch, setRackSearch] = useState("");
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [undoStack, setUndoStack] = useState<MagneticBoardState[]>([]);
  const [shiftEditorOpen, setShiftEditorOpen] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [crewDialogOpen, setCrewDialogOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tvScale, setTvScale] = useState(1);
  const [tvScaleY, setTvScaleY] = useState(1);
  const [tvHeaderScale, setTvHeaderScale] = useState(1);
  const [tvShiftView, setTvShiftView] = useState<TvShiftView>("both");
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const keyboardHistoryRef = useRef<MagneticBoardState | null>(null);
  const stateRef = useRef(board);
  const savingRef = useRef(false);
  const editorOpenRef = useRef(false);

  useEffect(() => {
    if (!presentation) return;

    const fitBoardToScreen = () => {
      const visibleWidth = tvShiftView === "both" ? BOARD_WIDTH : SHIFT_WIDTH;
      if (tvShiftView === "both") {
        const scale = Math.min(
          window.innerWidth / visibleWidth,
          window.innerHeight / BOARD_HEIGHT,
        );
        setTvScale(scale);
        setTvScaleY(scale);
        setTvHeaderScale(scale);
      } else {
        const headerScale = window.innerWidth / BOARD_WIDTH;
        const availableBodyHeight = window.innerHeight - TV_SHARED_HEADER_HEIGHT * headerScale;
        setTvHeaderScale(headerScale);
        setTvScale(window.innerWidth / visibleWidth);
        setTvScaleY(availableBodyHeight / (PARK_UP_TOP - TV_SHARED_HEADER_HEIGHT));
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
    const trucks = board.magnets.filter((item) => item.kind === "truck");
    const allocated = (item: Magnet) => item.y >= WORK_ROWS_TOP && item.y < PARK_UP_TOP;
    return {
      dayAllocated: trucks.filter((item) => item.x < SHIFT_WIDTH && allocated(item)).length,
      dayUnallocated: trucks.filter((item) => item.x < SHIFT_WIDTH && !allocated(item)).length,
      nightAllocated: trucks.filter((item) => item.x >= SHIFT_WIDTH && allocated(item)).length,
      nightUnallocated: trucks.filter((item) => item.x >= SHIFT_WIDTH && !allocated(item)).length,
    };
  }, [board.magnets]);

  const filteredInventory = useMemo(() => {
    const query = rackSearch.trim().toLowerCase();
    return magnetInventory.filter((item) =>
      (rackKind === "all" || item.kind === rackKind) &&
      (item.primary.toLowerCase().includes(query) || item.fullName?.toLowerCase().includes(query)),
    );
  }, [rackKind, rackSearch]);

  const boardSearchResults = useMemo(() => {
    const query = findQuery.trim().toLowerCase();
    if (!query) return [];
    return board.magnets.filter((magnet) =>
      magnet.primary.toLowerCase().includes(query) ||
      magnet.fullName?.toLowerCase().includes(query) ||
      magnet.secondary?.toLowerCase().includes(query),
    );
  }, [board.magnets, findQuery]);

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

  const parkUpCounts = useMemo(() => countParkUpZones(board.magnets), [board.magnets]);
  const totalParked = useMemo(
    () => Object.values(parkUpCounts).reduce((total, count) => total + count, 0),
    [parkUpCounts],
  );

  const updateBoard = useCallback((next: MagneticBoardState) => {
    stateRef.current = next;
    setBoard(next);
  }, []);

  const commitBoard = useCallback(async (next: MagneticBoardState, options: CommitOptions = {}) => {
    if (options.recordHistory !== false) {
      const historyBase = cloneBoard(options.historyBase ?? stateRef.current);
      setUndoStack((history) => [...history.slice(-19), historyBase]);
    }
    const optimistic = {
      ...next,
      lastMovedId: options.movedId ?? next.lastMovedId,
      updatedAt: new Date().toISOString(),
      updatedBy: "MINE CONTROL",
    };
    updateBoard(optimistic);
    savingRef.current = true;
    setSyncState("saving");

    try {
      const response = await fetch("/api/board", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ board: optimistic }),
      });
      if (!response.ok) throw new Error("Unable to save board");
      const payload = (await response.json()) as { board: MagneticBoardState };
      updateBoard(payload.board);
      setSyncState("saved");
    } catch {
      setSyncState("error");
    } finally {
      savingRef.current = false;
    }
  }, [updateBoard]);

  useEffect(() => {
    let active = true;

    const loadBoard = async (quiet = false) => {
      if (savingRef.current || dragRef.current || editorOpenRef.current) return;
      try {
        const response = await fetch("/api/board", { cache: "no-store" });
        if (!response.ok) throw new Error("Unable to load board");
        const payload = (await response.json()) as { board: MagneticBoardState };
        if (active && payload.board) {
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
            }, { recordHistory: false });
            return;
          }
          if (payload.board.layoutVersion === 4) {
            const linked = inferNearbyAttachments(compactBoardLayout(expandFloorRows(payload.board.magnets)));
            void commitBoard({
              ...payload.board,
              layoutVersion: defaultMagneticBoard.layoutVersion,
              magnets: linked.magnets,
            }, { recordHistory: false });
            return;
          }
          if (payload.board.layoutVersion === 5) {
            const linked = inferNearbyAttachments(compactBoardLayout(payload.board.magnets));
            void commitBoard({
              ...payload.board,
              layoutVersion: defaultMagneticBoard.layoutVersion,
              magnets: linked.magnets,
            }, { recordHistory: false });
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
            }, { recordHistory: false });
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
            }, { recordHistory: false });
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
            }, { recordHistory: false });
            return;
          }
          if (payload.board.layoutVersion !== defaultMagneticBoard.layoutVersion) {
            const linked = inferNearbyAttachments(defaultMagneticBoard.magnets);
            void commitBoard(
              { ...defaultMagneticBoard, magnets: linked.magnets },
              { recordHistory: false },
            );
            return;
          }
          const linked = inferNearbyAttachments(payload.board.magnets);
          if (linked.changed) {
            void commitBoard(
              { ...payload.board, magnets: linked.magnets },
              { recordHistory: false },
            );
            return;
          }
          updateBoard(payload.board);
          setSyncState("saved");
        }
      } catch {
        if (active && !quiet) setSyncState("error");
      }
    };

    void loadBoard();
    const interval = window.setInterval(() => void loadBoard(true), 4000);
    return () => {
      active = false;
      window.clearInterval(interval);
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
    void commitBoard(cloneBoard(previous), { recordHistory: false });
  }, [commitBoard, locked, undoStack]);

  const saveStartingLayout = useCallback(() => {
    if (!window.confirm("Save the current magnet layout as the new starting layout?")) return;
    const current = stateRef.current;
    void commitBoard({
      ...current,
      startingMagnets: current.magnets.map((magnet) => ({ ...magnet })),
    });
  }, [commitBoard]);

  const clearPersonnel = useCallback(() => {
    const current = stateRef.current;
    const personnelCount = current.magnets.filter((magnet) => magnet.kind === "person").length;
    if (!personnelCount) {
      window.alert("There are no personnel magnets on the board.");
      return;
    }
    if (!window.confirm(`Remove all ${personnelCount} personnel magnets? Assets, locations and notes will stay in place.`)) return;
    setSelectedId(null);
    void commitBoard({
      ...current,
      magnets: current.magnets.filter((magnet) => magnet.kind !== "person"),
    });
  }, [commitBoard]);

  const cleanUpTrucks = useCallback(() => {
    const current = stateRef.current;
    if (!window.confirm("Display the complete truck fleet on both Day and Night shift and arrange the trucks into clean vertical stacks?")) return;
    setSelectedId(null);
    void commitBoard({
      ...current,
      magnets: cleanUpTruckMagnets(current.magnets, current.workSectionCount ?? 4),
    });
  }, [commitBoard]);

  const resetAuxiliaryToMiddle = useCallback(() => {
    const current = stateRef.current;
    if (!window.confirm("Reset all auxiliary equipment into two columns in the upper-middle of each shift? Excavators and light vehicles will stay where they are.")) return;
    setSelectedId(null);
    void commitBoard({
      ...current,
      magnets: resetAuxiliaryMagnetsToMiddle(current.magnets),
    });
  }, [commitBoard]);

  const toggleFifthSection = useCallback(() => {
    const current = stateRef.current;
    const workSectionCount = (current.workSectionCount ?? 4) === 4 ? 5 : 4;
    const remap = workSectionCount === 4 ? spreadFourSectionMagnets : compactFiveSectionMagnets;
    void commitBoard({
      ...current,
      workSectionCount,
      magnets: remap(current.magnets),
    });
  }, [commitBoard]);

  const copyShift = useCallback((source: ShiftSide) => {
    const destination: ShiftSide = source === "day" ? "night" : "day";
    if (!window.confirm(`Replace the ${destination} work area with a copy of the ${source} work area?`)) return;
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
  }, [commitBoard]);

  const allocateCrew = useCallback((crew: CrewCode, side: ShiftSide) => {
    const sideLabel = side === "day" ? "DAY" : "NIGHT";
    if (!window.confirm(`Place all ${crew} Crew magnets down the right side of ${sideLabel} shift? Only the crew currently on ${sideLabel} shift will be replaced.`)) return;
    const current = stateRef.current;
    const left = side === "day" ? 0 : SHIFT_WIDTH;
    const right = left + SHIFT_WIDTH;
    const isOnTargetSide = (magnet: Magnet) => magnet.x >= left && magnet.x < right;
    const retained = current.magnets.filter((magnet) =>
      !(magnet.kind === "person" && magnet.crew && isOnTargetSide(magnet)),
    );
    const highestZ = Math.max(1, ...retained.map((magnet) => magnet.z));
    const crewRowSpacing = 22;
    const rowsPerColumn = Math.floor((PARK_UP_TOP - WORK_ROWS_TOP - 8) / crewRowSpacing);
    const placed: Magnet[] = crewRosters[crew].map((template, index) => {
      const column = Math.floor(index / rowsPerColumn);
      const row = index % rowsPerColumn;
      return {
        ...template,
        id: `crew-${side}-${crew.toLowerCase()}-${(template.fullName ?? template.primary).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        x: right - 8 - template.width - column * 118,
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
  }, [commitBoard]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      window.alert("Full screen is not available in this browser.");
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
      window.alert("There is no clear space available for another magnet.");
      return;
    }
    setSelectedId(created.id);
    void commitBoard(
      { ...stateRef.current, magnets: [...stateRef.current.magnets, created] },
      { movedId: created.id },
    );
  }, [commitBoard]);

  const dropFromRack = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/x-shiftboard-template");
    if (!raw || !canvasRef.current) return;
    const template = JSON.parse(raw) as MagnetTemplate;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (BOARD_WIDTH / rect.width) - template.width / 2;
    const y = (event.clientY - rect.top) * (BOARD_HEIGHT / rect.height) - template.height / 2;
    addInventoryMagnet(template, snapValue(x, snapToGrid), snapValue(y, snapToGrid));
  };

  useEffect(() => {
    editorOpenRef.current = Boolean(editorMagnet || shiftEditorOpen || copyDialogOpen || crewDialogOpen);
  }, [copyDialogOpen, crewDialogOpen, editorMagnet, shiftEditorOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;

      if (event.key === "Escape") {
        if (editorMagnet) setEditorMagnet(null);
        else if (shiftEditorOpen) setShiftEditorOpen(false);
        else if (copyDialogOpen) setCopyDialogOpen(false);
        else if (presentation) setPresentation(false);
        else setSelectedId(null);
        return;
      }

      if (!selectedId || locked || editorMagnet) return;
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
      if (event.key.startsWith("Arrow") && selectedId && !locked && !editorMagnet) {
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
  }, [commitBoard, copyDialogOpen, editorMagnet, locked, presentation, selectedId, shiftEditorOpen, updateBoard]);

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    magnet: Magnet,
  ) => {
    if (locked || presentation) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
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
    setInvalidDropId(null);
    setSelectedId(magnet.id);

    const maxZ = Math.max(1, ...stateRef.current.magnets.map((item) => item.z));
    const groupIds = new Set([
      magnet.id,
      ...(ATTACHABLE_KINDS.has(magnet.kind)
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
      snapValue(rawX, snapToGrid),
      snapValue(rawY, snapToGrid),
      true,
    );
    if (moved) {
      setInvalidDropId(linkedGroupOverlaps(moved, drag.id) ? drag.id : null);
      updateBoard({ ...current, magnets: moved });
    }
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    const { id: draggedId, historyBase } = dragRef.current;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const currentMagnets = stateRef.current.magnets;
    const snappedMagnets = snapGroupToParkUpZone(currentMagnets, draggedId);
    let dropMagnets = snappedMagnets ?? currentMagnets;
    if (linkedGroupOverlaps(dropMagnets, draggedId)) {
      dropMagnets = moveGroupToNearestOpenPosition(currentMagnets, draggedId) ?? [];
    }
    if (!dropMagnets.length || linkedGroupOverlaps(dropMagnets, draggedId)) {
      setInvalidDropId(null);
      updateBoard(cloneBoard(historyBase));
      return;
    }
    setInvalidDropId(null);
    const dragged = dropMagnets.find((magnet) => magnet.id === draggedId);
    const magnets = dragged?.kind === "person"
      ? attachPersonToNearestEquipment(dropMagnets, draggedId)
      : dropMagnets;
    void commitBoard(
      { ...stateRef.current, magnets },
      { historyBase, movedId: draggedId },
    );
  };

  const openEditor = (magnet: Magnet, isNew = false) => {
    if (locked || presentation) return;
    setSelectedId(magnet.id);
    setIsNewMagnet(isNew);
    setEditorMagnet(magnet);
  };

  const saveMagnet = (magnet: Magnet) => {
    const current = stateRef.current;
    const exists = current.magnets.some((item) => item.id === magnet.id);
    const placed = findOpenPosition(
      magnet,
      current.magnets,
      magnet.x,
      magnet.y,
      exists ? new Set([magnet.id]) : new Set(),
    );
    if (!placed) {
      window.alert("That size would overlap another magnet and no clear space is available.");
      return;
    }
    const nextMagnets = exists
      ? current.magnets.map((item) => {
          if (item.id === magnet.id) return placed;
          if (item.attachedTo === magnet.id && ATTACHABLE_KINDS.has(magnet.kind)) {
            return { ...item, attachedTo: undefined };
          }
          return item;
        })
      : [...current.magnets, placed];
    const next = {
      ...current,
      magnets: nextMagnets,
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
      window.alert("There is no clear space available for a duplicate magnet.");
      return;
    }
    const next = { ...stateRef.current, magnets: [...stateRef.current.magnets, copy] };
    setEditorMagnet(null);
    setSelectedId(copy.id);
    void commitBoard(next, { movedId: copy.id });
  };

  const resetBoard = () => {
    if (!window.confirm("Reset every magnet to the starting layout?")) return;
    const current = stateRef.current;
    const startingMagnets = current.startingMagnets ?? defaultMagneticBoard.magnets;
    setSelectedId(null);
    void commitBoard({
      ...current,
      magnets: inferNearbyAttachments(startingMagnets.map((magnet) => ({ ...magnet }))).magnets,
      updatedAt: new Date().toISOString(),
      updatedBy: "MINE CONTROL",
    });
  };

  return (
    <main className={presentation ? `app presentation${tvShiftView === "both" ? "" : " presentation-single"}` : "app"}>
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
            <span>{board.roster}</span>
            <span>{board.boardDate}</span>
          </div>

          <nav className="board-tools" aria-label="Board tools">
            <label className="snap-control">
              <input
                type="checkbox"
                checked={snapToGrid}
                onChange={(event) => setSnapToGrid(event.target.checked)}
              />
              SNAP 10PX
            </label>
            <button
              className="tool-button"
              type="button"
              onClick={() => setRackOpen((value) => !value)}
              disabled={locked}
            >
              {rackOpen ? "CLOSE RACK" : "+ MAGNET RACK"}
            </button>
            <button className="tool-button" type="button" onClick={() => openEditor(newMagnet("truck"), true)} disabled={locked}>+ CUSTOM</button>
            <button className="tool-button" type="button" onClick={resetBoard} disabled={locked}>
              RESET
            </button>
            <button
              className={locked ? "tool-button tool-primary locked" : "tool-button tool-primary"}
              type="button"
              onClick={() => {
                setLocked((value) => !value);
                setSelectedId(null);
              }}
            >
              {locked ? "BOARD LOCKED" : "LOCK BOARD"}
            </button>
            <button className="tool-button" type="button" onClick={() => setPresentation(true)}>
              TV VIEW
            </button>
          </nav>
        </header>
      )}

      {!presentation && (
        <div className="instruction-bar">
          <strong>{locked ? "BOARD LOCKED" : "MOVE MODE"}</strong>
          <span>
            {locked
              ? "Unlock the board to move or edit magnets."
              : "Move without overlap · Operators snap to nearby equipment · Linked magnets move together"}
          </span>
          {selectedId && <span className="selected-hint">MAGNET SELECTED</span>}
        </div>
      )}

      {!presentation && (
        <section className="quick-actions" aria-label="Quick board actions">
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
          <button
            className={unassignedOperators.length ? "status-chip status-warning" : "status-chip status-ok"}
            type="button"
            onClick={focusNextUnassigned}
            title={unassignedOperators.map((magnet) => magnet.primary).join(", ") || "All working operators are assigned"}
          >
            {unassignedOperators.length ? `⚠ ${unassignedOperators.length} UNASSIGNED` : "✓ ALL ASSIGNED"}
          </button>
          <span className="status-chip">PARKED {totalParked}</span>
          <button className="quick-button" type="button" onClick={() => setShiftEditorOpen(true)} disabled={locked}>SHIFT / NOTE</button>
          <button className="quick-button crew-button" type="button" onClick={() => setCrewDialogOpen(true)} disabled={locked}>ALLOCATE CREW</button>
          <button className="quick-button clear-personnel-button" type="button" onClick={clearPersonnel} disabled={locked}>CLEAR PERSONNEL</button>
          <button className="quick-button cleanup-trucks-button" type="button" onClick={cleanUpTrucks} disabled={locked}>CLEAN UP TRUCKS</button>
          <button className="quick-button cleanup-aux-button" type="button" onClick={resetAuxiliaryToMiddle} disabled={locked}>RESET AUX LAYOUT</button>
          <button className="quick-button" type="button" onClick={toggleFifthSection} disabled={locked}>
            {(board.workSectionCount ?? 4) === 4 ? "+ 5TH SECTION" : "− 5TH SECTION"}
          </button>
          <button className="quick-button" type="button" onClick={saveStartingLayout} disabled={locked}>SAVE START</button>
          <button className="quick-button" type="button" onClick={() => setCopyDialogOpen(true)} disabled={locked}>COPY SHIFT</button>
          <button className="quick-button" type="button" onClick={toggleFullscreen}>{isFullscreen ? "EXIT FULL SCREEN" : "FULL SCREEN"}</button>
        </section>
      )}

      {!presentation && rackOpen && (
        <section className="magnet-rack" aria-label="Magnet rack">
          <header>
            <div><strong>MAGNET RACK</strong><span>{magnetInventory.length} reusable magnets · drag onto the board or click to add</span></div>
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
            {filteredInventory.map((template, index) => (
              <button
                key={`${template.kind}-${template.primary}-${index}`}
                type="button"
                draggable
                className={`rack-magnet magnet-${template.kind} tone-${template.tone}`}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData("application/x-shiftboard-template", JSON.stringify(template));
                }}
                onClick={() => addInventoryMagnet(template)}
              ><strong>{template.kind === "person" && template.crew ? template.primary.split(" ")[0] : template.primary}</strong></button>
            ))}
          </div>
        </section>
      )}

      <div className="board-scroll">
        {presentation && tvShiftView !== "both" && (
          <div
            className="tv-full-header"
            style={{ width: BOARD_WIDTH * tvHeaderScale, height: TV_SHARED_HEADER_HEIGHT * tvHeaderScale }}
          >
            <div
              className="magnet-canvas canvas-locked"
              style={{
                width: BOARD_WIDTH,
                height: BOARD_HEIGHT,
                transform: `scale(${tvHeaderScale})`,
              }}
            >
              <BoardBackground truckStats={truckStats} parkUpCounts={parkUpCounts} board={board} />
              {board.magnets.filter((item) => item.y < TV_SHARED_HEADER_HEIGHT).map((item) => (
                <button
                  key={`tv-header-${item.id}`}
                  type="button"
                  className={`magnet magnet-${item.kind} tone-${item.tone}`}
                  style={{ left: item.x, top: item.y, width: item.width, height: item.height, zIndex: item.z + 10 }}
                  tabIndex={-1}
                >
                  <MagnetContent magnet={item} />
                </button>
              ))}
            </div>
          </div>
        )}
        <div
          className="board-stage"
          style={{
            width: presentation
              ? (tvShiftView === "both" ? BOARD_WIDTH : SHIFT_WIDTH) * tvScale
              : BOARD_WIDTH,
            height: presentation
              ? (tvShiftView === "both" ? BOARD_HEIGHT * tvScaleY : (PARK_UP_TOP - TV_SHARED_HEADER_HEIGHT) * tvScaleY)
              : BOARD_HEIGHT,
            overflow: presentation && tvShiftView !== "both" ? "hidden" : undefined,
            marginTop: presentation && tvShiftView !== "both" ? TV_SHARED_HEADER_HEIGHT * tvHeaderScale : undefined,
          }}
        >
          <div
            ref={canvasRef}
            className={locked ? "magnet-canvas canvas-locked" : "magnet-canvas"}
            style={{
              width: BOARD_WIDTH,
              height: BOARD_HEIGHT,
              transform: presentation
                ? `scale(${tvScale}, ${tvScaleY}) translate(${tvShiftView === "night" ? -SHIFT_WIDTH : 0}px, ${tvShiftView === "both" ? 0 : -TV_SHARED_HEADER_HEIGHT}px)`
                : undefined,
              "--tv-counter-scale": presentation && tvShiftView !== "both" ? tvScaleY / tvScale : 1,
            } as CSSProperties}
            onDragOver={(event) => event.preventDefault()}
            onDrop={dropFromRack}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setSelectedId(null);
            }}
          >
            <BoardBackground truckStats={truckStats} parkUpCounts={parkUpCounts} board={board} />

            {board.magnets.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`magnet magnet-${item.kind} tone-${item.tone}${selectedId === item.id ? " magnet-selected" : ""}${invalidDropId === item.id ? " magnet-drop-invalid" : ""}${linkedMagnetIds.has(item.id) ? " magnet-linked" : ""}${board.lastMovedId === item.id ? " magnet-last-moved" : ""}`}
                data-magnet-id={item.id}
                style={{
                  left: item.x,
                  top: item.y,
                  width: item.width,
                  height: item.height,
                  zIndex: item.z + 10,
                  transform: presentation && tvShiftView !== "both"
                    ? `scaleX(${tvScaleY / tvScale})`
                    : undefined,
                  transformOrigin: "left center",
                }}
                aria-label={`${item.fullName ?? item.primary}${item.crew ? `, ${item.crew} Crew` : ""}${item.competencies?.length ? `, passed out in ${item.competencies.join(", ")}` : ""}`}
                title={item.kind === "person" ? [item.fullName, item.competencies?.length ? `Passed out in: ${item.competencies.join(", ")}` : "Competencies not yet recorded"].filter(Boolean).join(" · ") : undefined}
                onPointerDown={(event) => handlePointerDown(event, item)}
                onPointerMove={handlePointerMove}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                onDoubleClick={() => openEditor(item)}
              >
                <MagnetContent magnet={item} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {presentation && (
        <div className="tv-controls" aria-label="TV view controls">
          <div className="tv-shift-selector" role="group" aria-label="Displayed shift">
            {(["both", "day", "night"] as TvShiftView[]).map((view) => (
              <button
                key={view}
                className={tvShiftView === view ? "active" : ""}
                type="button"
                onClick={() => setTvShiftView(view)}
              >
                {view === "both" ? "BOTH" : view === "day" ? "DAYS" : "NIGHTS"}
              </button>
            ))}
          </div>
          <button className="exit-tv" type="button" onClick={() => setPresentation(false)}>
            EXIT TV VIEW
          </button>
        </div>
      )}

      {editorMagnet && (
        <MagnetEditor
          magnet={editorMagnet}
          isNew={isNewMagnet}
          onClose={() => setEditorMagnet(null)}
          onSave={saveMagnet}
          onDelete={deleteMagnet}
          onDuplicate={duplicateMagnet}
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
    </main>
  );
}

function MagnetContent({ magnet }: { magnet: Magnet }) {
  if (magnet.kind === "location") {
    return (
      <>
        <strong>{magnet.crew ? magnet.primary.split(" ")[0] : magnet.primary}</strong>
        {magnet.secondary && <span>{magnet.secondary}</span>}
      </>
    );
  }

  if (magnet.kind === "person") {
    return (
      <>
        {magnet.secondary && <small>{magnet.secondary}</small>}
        <strong>{magnet.primary}</strong>
      </>
    );
  }

  return <strong>{magnet.primary}</strong>;
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
      <FloorPickupGaps side="day" sectionCount={board.workSectionCount ?? 4} />
      <FloorPickupGaps side="night" sectionCount={board.workSectionCount ?? 4} />

      <BoardBands parkUpCounts={parkUpCounts} />

      <footer className="fixed-footer">
        <span>LAST UPDATED {formatUpdatedAt(board.updatedAt)} · {board.updatedBy}</span>
        <span><i /> LIVE · ALL CHANGES SAVED</span>
      </footer>
    </div>
  );
}

function FloorPickupGaps({ side, sectionCount }: { side: "day" | "night"; sectionCount: 4 | 5 }) {
  return (
    <div className={`floor-pickup-gaps ${side}-floor-pickup-gaps work-sections-${sectionCount}`}>
      {Array.from({ length: sectionCount }, (_, index) => (
        <div className="floor-pickup-row" key={index}>
          <span>END-OF-SHIFT FLOOR PARK-UP · LV PICKUP</span>
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
  onClose,
  onSave,
  onDelete,
  onDuplicate,
}: {
  magnet: Magnet;
  isNew: boolean;
  onClose: () => void;
  onSave: (magnet: Magnet) => void;
  onDelete: (id: string) => void;
  onDuplicate: (magnet: Magnet) => void;
}) {
  const [draft, setDraft] = useState(magnet);

  const changeKind = (kind: MagnetKind) => {
    const base = newMagnet(kind);
    setDraft({
      ...draft,
      kind,
      tone: base.tone,
      width: base.width,
      height: base.height,
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
            <h2>{isNew ? "ADD MAGNET" : "EDIT MAGNET"}</h2>
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
              width: responsiveMagnetWidth(
                draft.kind,
                draft.primary,
                draft.secondary?.trim(),
              ) ?? draft.width,
            });
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
            <label>
              MAIN TEXT
              <input required value={draft.primary} onChange={(event) => setDraft({ ...draft, primary: event.target.value })} />
            </label>
            <label className="editor-wide">
              SECOND LINE / OPERATOR
              <input value={draft.secondary ?? ""} onChange={(event) => setDraft({ ...draft, secondary: event.target.value })} />
            </label>
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
            <label>
              WIDTH
              <input type="number" min="36" max="600" value={draft.width} onChange={(event) => setDraft({ ...draft, width: Number(event.target.value) })} />
            </label>
            <label>
              HEIGHT
              <input type="number" min="20" max="160" value={draft.height} onChange={(event) => setDraft({ ...draft, height: Number(event.target.value) })} />
            </label>
            <fieldset className="tone-picker editor-wide">
              <legend>MAGNET COLOUR</legend>
              {magnetToneOptions.map((tone) => (
                <label key={tone}>
                  <input type="radio" name="tone" checked={draft.tone === tone} onChange={() => setDraft({ ...draft, tone })} />
                  <i className={`tone-swatch tone-${tone}`} />
                  {tone}
                </label>
              ))}
            </fieldset>
          </div>

          <div className="editor-preview">
            <span>PREVIEW</span>
            <div className={`magnet preview-magnet magnet-${draft.kind} tone-${draft.tone}`} style={{ width: draft.width, height: draft.height }}>
              <MagnetContent magnet={draft} />
            </div>
          </div>

          <footer>
            {!isNew && <button className="danger-button" type="button" onClick={() => onDelete(draft.id)}>DELETE</button>}
            {!isNew && <button className="secondary-button" type="button" onClick={() => onDuplicate(draft)}>DUPLICATE</button>}
            <span />
            <button className="secondary-button" type="button" onClick={onClose}>CANCEL</button>
            <button className="save-button" type="submit">SAVE MAGNET</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
