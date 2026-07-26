"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  LEGACY_PARK_UP_TOP,
  LEGACY_WORK_ROWS_TOP,
  LEGACY_WORK_ROW_HEIGHT,
  PARK_UP_TOP,
  WORK_ROWS_TOP,
  compactBoardY,
  compactMagnetHeight,
  defaultMagneticBoard,
  kindDefaults,
  magnetInventory,
  magnetKindLabels,
  magnetToneOptions,
  type Magnet,
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

const ATTACH_DISTANCE = 36;
const ATTACH_GAP = 4;
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
] as const;

const cloneBoard = (board: MagneticBoardState): MagneticBoardState => ({
  ...board,
  magnets: board.magnets.map((magnet) => ({ ...magnet })),
  startingMagnets: board.startingMagnets?.map((magnet) => ({ ...magnet })),
});

const isWorkingOperator = (magnet: Magnet) =>
  magnet.kind === "person" &&
  magnet.x < 1732 &&
  magnet.y >= WORK_ROWS_TOP &&
  magnet.y < PARK_UP_TOP;

function countParkUpZones(magnets: Magnet[]) {
  const counts: Record<string, number> = Object.fromEntries(
    PARK_UP_ROWS.flatMap((row) => row.zones.map((zone) => [zone, 0])),
  );
  const equipment = magnets.filter((magnet) => ATTACHABLE_KINDS.has(magnet.kind));
  const innerLeft = 8;
  const innerWidth = 1716;
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
  return magnets.map((magnet) => ({
    ...magnet,
    y: compactBoardY(magnet.y, magnet.x),
    height: compactMagnetHeight(magnet.kind, magnet.height),
  }));
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
      .filter(({ distance }) => distance <= 8)
      .sort((a, b) => a.distance - b.distance)[0]?.candidate;
    if (!target) return magnet;
    claimed.add(target.id);
    changed = true;
    return { ...magnet, attachedTo: target.id };
  });
  return { magnets: next, changed };
}

function moveLinkedGroup(magnets: Magnet[], id: string, requestedX: number, requestedY: number) {
  const anchor = magnets.find((magnet) => magnet.id === id);
  if (!anchor) return null;
  const groupIds = new Set([
    id,
    ...(ATTACHABLE_KINDS.has(anchor.kind)
      ? magnets.filter((magnet) => magnet.attachedTo === id).map((magnet) => magnet.id)
      : []),
  ]);
  const group = magnets.filter((magnet) => groupIds.has(magnet.id));
  const minDx = Math.max(...group.map((magnet) => -magnet.x));
  const maxDx = Math.min(...group.map((magnet) => BOARD_WIDTH - magnet.x - magnet.width));
  const minDy = Math.max(...group.map((magnet) => -magnet.y));
  const maxDy = Math.min(...group.map((magnet) => BOARD_HEIGHT - magnet.y - magnet.height));
  const dx = clamp(requestedX - anchor.x, minDx, maxDx);
  const dy = clamp(requestedY - anchor.y, minDy, maxDy);
  const moved = group.map((magnet) => ({ ...magnet, x: magnet.x + dx, y: magnet.y + dy }));
  if (moved.some((magnet) => collidesWithOthers(magnet, magnets, groupIds))) return null;
  const movedById = new Map(moved.map((magnet) => [magnet.id, magnet]));
  return magnets.map((magnet) => movedById.get(magnet.id) ?? magnet);
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
    .filter(({ distance }) => distance <= ATTACH_DISTANCE)
    .sort((a, b) => a.distance - b.distance);

  for (const { target } of targets) {
    const candidates = [
      { x: target.x + target.width + ATTACH_GAP, y: target.y + (target.height - person.height) / 2 },
      { x: target.x - person.width - ATTACH_GAP, y: target.y + (target.height - person.height) / 2 },
      { x: target.x + (target.width - person.width) / 2, y: target.y + target.height + ATTACH_GAP },
      { x: target.x + (target.width - person.width) / 2, y: target.y - person.height - ATTACH_GAP },
    ].sort((a, b) =>
      Math.hypot(a.x - person.x, a.y - person.y) - Math.hypot(b.x - person.x, b.y - person.y),
    );
    for (const position of candidates) {
      const candidate = { ...person, ...position, attachedTo: target.id, z: target.z + 1 };
      if (!isInsideBoard(candidate)) continue;
      if (collidesWithOthers(candidate, magnets, new Set([person.id]))) continue;
      return magnets.map((magnet) => magnet.id === person.id ? candidate : magnet);
    }
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tvScale, setTvScale] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const keyboardHistoryRef = useRef<MagneticBoardState | null>(null);
  const stateRef = useRef(board);
  const savingRef = useRef(false);
  const editorOpenRef = useRef(false);

  useEffect(() => {
    if (!presentation) return;

    const fitBoardToScreen = () => {
      setTvScale(Math.min(
        window.innerWidth / BOARD_WIDTH,
        window.innerHeight / BOARD_HEIGHT,
      ));
    };

    fitBoardToScreen();
    window.addEventListener("resize", fitBoardToScreen);
    return () => window.removeEventListener("resize", fitBoardToScreen);
  }, [presentation]);

  useEffect(() => {
    const updateFullscreenState = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => document.removeEventListener("fullscreenchange", updateFullscreenState);
  }, []);

  const truckStats = useMemo(() => {
    const trucks = board.magnets.filter((item) => item.kind === "truck");
    const allocated = (item: Magnet) => item.y >= WORK_ROWS_TOP && item.y < PARK_UP_TOP;
    return {
      dayAllocated: trucks.filter((item) => item.x < 866 && allocated(item)).length,
      dayUnallocated: trucks.filter((item) => item.x < 866 && !allocated(item)).length,
      nightAllocated: trucks.filter((item) => item.x >= 866 && item.x < 1732 && allocated(item)).length,
      nightUnallocated: trucks.filter((item) => item.x >= 866 && item.x < 1732 && !allocated(item)).length,
    };
  }, [board.magnets]);

  const filteredInventory = useMemo(() => magnetInventory.filter((item) =>
    (rackKind === "all" || item.kind === rackKind) &&
    item.primary.toLowerCase().includes(rackSearch.trim().toLowerCase()),
  ), [rackKind, rackSearch]);

  const boardSearchResults = useMemo(() => {
    const query = findQuery.trim().toLowerCase();
    if (!query) return [];
    return board.magnets.filter((magnet) =>
      magnet.primary.toLowerCase().includes(query) ||
      magnet.secondary?.toLowerCase().includes(query),
    );
  }, [board.magnets, findQuery]);

  const unassignedOperators = useMemo(() => board.magnets.filter((magnet) =>
    isWorkingOperator(magnet) && !magnet.attachedTo,
  ), [board.magnets]);

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

  const copyShift = useCallback((source: ShiftSide) => {
    const destination: ShiftSide = source === "day" ? "night" : "day";
    if (!window.confirm(`Replace the ${destination} work area with a copy of the ${source} work area?`)) return;
    const current = stateRef.current;
    const sourceLeft = source === "day" ? 0 : 866;
    const destinationLeft = destination === "day" ? 0 : 866;
    const inSide = (magnet: Magnet, left: number) =>
      magnet.x >= left && magnet.x < left + 866 &&
      magnet.y >= WORK_ROWS_TOP && magnet.y < PARK_UP_TOP;
    const sourceMagnets = current.magnets.filter((magnet) => inSide(magnet, sourceLeft));
    const idMap = new Map(sourceMagnets.map((magnet, index) => [
      magnet.id,
      `copy-${destination}-${Date.now()}-${index}`,
    ]));
    const copiedMagnets = sourceMagnets.map((magnet, index) => ({
      ...magnet,
      id: idMap.get(magnet.id) as string,
      x: magnet.x + destinationLeft - sourceLeft,
      z: Math.max(1, ...current.magnets.map((item) => item.z)) + index + 1,
      attachedTo: magnet.attachedTo ? idMap.get(magnet.attachedTo) : undefined,
    }));
    const retained = current.magnets.filter((magnet) => !inSide(magnet, destinationLeft));
    void commitBoard({ ...current, magnets: [...retained, ...copiedMagnets] });
    setCopyDialogOpen(false);
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
    editorOpenRef.current = Boolean(editorMagnet || shiftEditorOpen || copyDialogOpen);
  }, [copyDialogOpen, editorMagnet, shiftEditorOpen]);

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
    );
    if (moved) updateBoard({ ...current, magnets: moved });
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    const { id: draggedId, historyBase } = dragRef.current;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const dragged = stateRef.current.magnets.find((magnet) => magnet.id === draggedId);
    const magnets = dragged?.kind === "person"
      ? attachPersonToNearestEquipment(stateRef.current.magnets, draggedId)
      : stateRef.current.magnets;
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
    <main className={presentation ? "app presentation" : "app"}>
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
              ><strong>{template.primary}</strong></button>
            ))}
          </div>
        </section>
      )}

      <div className="board-scroll">
        <div
          className="board-stage"
          style={{
            width: presentation ? BOARD_WIDTH * tvScale : BOARD_WIDTH,
            height: presentation ? BOARD_HEIGHT * tvScale : BOARD_HEIGHT,
          }}
        >
          <div
            ref={canvasRef}
            className={locked ? "magnet-canvas canvas-locked" : "magnet-canvas"}
            style={{
              width: BOARD_WIDTH,
              height: BOARD_HEIGHT,
              transform: presentation ? `scale(${tvScale})` : undefined,
            }}
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
                className={`magnet magnet-${item.kind} tone-${item.tone}${selectedId === item.id ? " magnet-selected" : ""}${item.attachedTo || board.magnets.some((magnet) => magnet.attachedTo === item.id) ? " magnet-linked" : ""}${board.lastMovedId === item.id ? " magnet-last-moved" : ""}`}
                data-magnet-id={item.id}
                style={{
                  left: item.x,
                  top: item.y,
                  width: item.width,
                  height: item.height,
                  zIndex: item.z + 10,
                }}
                aria-label={`${item.primary}${item.secondary ? `, ${item.secondary}` : ""}`}
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
        <button className="exit-tv" type="button" onClick={() => setPresentation(false)}>
          EXIT TV VIEW
        </button>
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
    </main>
  );
}

function MagnetContent({ magnet }: { magnet: Magnet }) {
  if (magnet.kind === "location") {
    return (
      <>
        <strong>{magnet.primary}</strong>
        {magnet.secondary && <span>{magnet.secondary}</span>}
      </>
    );
  }

  if (magnet.kind === "person" && magnet.secondary) {
    return (
      <>
        <small>{magnet.secondary}</small>
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
        <img src="/ConsminLogo.png?v=20260722" alt="" />
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
      <aside className="fixed-rr-heading">
        <strong>R + R</strong>
        <span>11</span>
      </aside>

      <div className="column-heading day-columns">
        <span>PIT / WORK AREA</span><span>ASSET / SUPERVISOR</span><span>TRUCKS / OPERATORS</span>
      </div>
      <div className="column-heading night-columns">
        <span>PIT / WORK AREA</span><span>ASSET / SUPERVISOR</span><span>TRUCKS / OPERATORS</span>
      </div>

      <div className="fixed-work-grid day-work-grid" />
      <div className="fixed-work-grid night-work-grid" />
      <FloorPickupGaps side="day" />
      <FloorPickupGaps side="night" />
      <div className="fixed-rr-grid" />

      <BoardBands parkUpCounts={parkUpCounts} />

      <footer className="fixed-footer">
        <span>LAST UPDATED {formatUpdatedAt(board.updatedAt)} · {board.updatedBy}</span>
        <span><i /> LIVE · ALL CHANGES SAVED</span>
      </footer>
    </div>
  );
}

function FloorPickupGaps({ side }: { side: "day" | "night" }) {
  return (
    <div className={`floor-pickup-gaps ${side}-floor-pickup-gaps`}>
      {Array.from({ length: 5 }, (_, index) => (
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
