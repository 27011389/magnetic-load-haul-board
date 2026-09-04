export const BOARD_WIDTH = 1880;
export const BOARD_HEIGHT = 940;
export const SHIFT_WIDTH = BOARD_WIDTH / 2;
const LEGACY_SHIFT_WIDTH = 866;
export const LEGACY_ACTIVE_WIDTH = LEGACY_SHIFT_WIDTH * 2;

export function expandShiftBoardX(x: number) {
  if (x >= LEGACY_ACTIVE_WIDTH) return x;
  if (x >= LEGACY_SHIFT_WIDTH) {
    return SHIFT_WIDTH + Math.round(((x - LEGACY_SHIFT_WIDTH) * SHIFT_WIDTH) / LEGACY_SHIFT_WIDTH);
  }
  return Math.round((x * SHIFT_WIDTH) / LEGACY_SHIFT_WIDTH);
}

export const WORK_ROWS_TOP = 170;
const WORK_ROW_HEIGHT = 126;
export const PARK_UP_TOP = 800;
export const ALLOCATION_LANE_LEFT = 272;
export const ALLOCATION_LANE_RIGHT = 520;

const PREVIOUS_ALLOCATION_LANE_LEFT = 252;
const PREVIOUS_ALLOCATION_LANE_RIGHT = 500;
const ALLOCATION_LANE_SHIFT = ALLOCATION_LANE_LEFT - PREVIOUS_ALLOCATION_LANE_LEFT;

export const LEGACY_WORK_ROWS_TOP = 218;
export const LEGACY_WORK_ROW_HEIGHT = 146;
export const LEGACY_PARK_UP_TOP = 948;
const LEGACY_RR_TOP = 204;
const LEGACY_RR_BOTTOM = 1066;
const COMPACT_RR_TOP = 170;
const COMPACT_RR_BOTTOM = 892;

export function compactBoardY(y: number, x = 0) {
  if (x >= 1732 && y >= LEGACY_RR_TOP && y < LEGACY_RR_BOTTOM) {
    return COMPACT_RR_TOP + Math.round(
      ((y - LEGACY_RR_TOP) * (COMPACT_RR_BOTTOM - COMPACT_RR_TOP)) /
      (LEGACY_RR_BOTTOM - LEGACY_RR_TOP),
    );
  }
  if (y < 88) return Math.round((y * 72) / 88);
  if (y < 124) return 72 + Math.round(((y - 88) * 28) / 36);
  if (y < LEGACY_WORK_ROWS_TOP) {
    return 100 + Math.round(((y - 124) * 70) / 94);
  }
  if (y < LEGACY_PARK_UP_TOP) {
    const row = Math.min(4, Math.floor((y - LEGACY_WORK_ROWS_TOP) / LEGACY_WORK_ROW_HEIGHT));
    const offset = y - (LEGACY_WORK_ROWS_TOP + row * LEGACY_WORK_ROW_HEIGHT);
    return WORK_ROWS_TOP + row * WORK_ROW_HEIGHT + Math.round((offset * WORK_ROW_HEIGHT) / LEGACY_WORK_ROW_HEIGHT);
  }
  if (y < 1060) {
    return PARK_UP_TOP + Math.round(((y - LEGACY_PARK_UP_TOP) * 92) / 112);
  }
  return 892 + Math.round(((y - 1060) * 26) / 40);
}

export type MagnetKind =
  | "truck"
  | "dozer"
  | "grader"
  | "watercart"
  | "excavator"
  | "loader"
  | "lightvehicle"
  | "support"
  | "location"
  | "person"
  | "note";

export type MagnetTone =
  | "white" | "dark" | "amber" | "red" | "teal"
  | "blue" | "violet" | "green" | "orange" | "slate";

export type EquipmentStatus =
  | "available"
  | "breakdown"
  | "fuel"
  | "workshop"
  | "standby"
  | "awaiting-operator";

export type Magnet = {
  id: string;
  kind: MagnetKind;
  primary: string;
  secondary?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  tone: MagnetTone;
  attachedTo?: string;
  crew?: CrewCode;
  competencies?: string[];
  fullName?: string;
  equipmentStatus?: EquipmentStatus;
  parkedFromShift?: "day" | "night";
  note?: string;
};

export type CrewCode = "A" | "B" | "C";
export type WorkSectionCount = 1 | 2 | 3 | 4 | 5;

export const attachableMagnetKinds = new Set<MagnetKind>([
  "truck", "dozer", "grader", "watercart", "excavator",
  "loader", "lightvehicle", "support",
]);

export const magnetShiftSide = (magnet: Pick<Magnet, "x">): "day" | "night" =>
  magnet.x < SHIFT_WIDTH ? "day" : "night";

const localMagnetX = (magnet: Pick<Magnet, "x">) =>
  magnet.x < SHIFT_WIDTH ? magnet.x : magnet.x - SHIFT_WIDTH;

export const isPitWorkAreaControl = (magnet: Magnet) =>
  magnet.kind === "location" &&
  magnet.y >= WORK_ROWS_TOP && magnet.y < PARK_UP_TOP &&
  localMagnetX(magnet) >= 0 && localMagnetX(magnet) < 130;

export const isDiggerControl = (magnet: Magnet) =>
  magnet.kind === "excavator" &&
  magnet.y >= WORK_ROWS_TOP && magnet.y < PARK_UP_TOP &&
  localMagnetX(magnet) >= 130 && localMagnetX(magnet) < ALLOCATION_LANE_LEFT;

export function getWorkControlRows(
  magnets: Magnet[],
  sectionCount: number,
  predicate: (magnet: Magnet) => boolean,
) {
  const rows = new Map<string, number>();
  (["day", "night"] as const).forEach((side) => {
    magnets
      .filter((magnet) => predicate(magnet) && magnetShiftSide(magnet) === side)
      .sort((left, right) => left.y - right.y || left.id.localeCompare(right.id))
      .slice(0, sectionCount)
      .forEach((magnet, rowIndex) => rows.set(magnet.id, rowIndex));
  });
  return rows;
}

export function pruneHiddenWorkSectionControls(
  magnets: Magnet[],
  sectionCount: WorkSectionCount,
) {
  const removedIds = new Set<string>();
  (["day", "night"] as const).forEach((side) => {
    [isPitWorkAreaControl, isDiggerControl].forEach((predicate) => {
      magnets
        .filter((magnet) => magnetShiftSide(magnet) === side && predicate(magnet))
        .sort((left, right) => left.y - right.y || left.id.localeCompare(right.id))
        .slice(sectionCount)
        .forEach((magnet) => removedIds.add(magnet.id));
    });
  });
  if (!removedIds.size) return { magnets, changed: false };
  return {
    magnets: magnets
      .filter((magnet) => !removedIds.has(magnet.id))
      .map((magnet) =>
        magnet.attachedTo && removedIds.has(magnet.attachedTo)
          ? { ...magnet, attachedTo: undefined }
          : magnet,
      ),
    changed: true,
  };
}

export function moveAllocatedTruckGroupsIntoWiderLane(magnets: Magnet[]) {
  const allocatedTruckIds = new Set(
    magnets
      .filter((magnet) => {
        if (magnet.kind !== "truck" || magnet.y < WORK_ROWS_TOP || magnet.y >= PARK_UP_TOP) return false;
        const sideLeft = magnet.x < SHIFT_WIDTH ? 0 : SHIFT_WIDTH;
        const centreX = magnet.x + magnet.width / 2 - sideLeft;
        return centreX >= PREVIOUS_ALLOCATION_LANE_LEFT && centreX < PREVIOUS_ALLOCATION_LANE_RIGHT;
      })
      .map((magnet) => magnet.id),
  );

  return magnets.map((magnet) => {
    if (!allocatedTruckIds.has(magnet.id) && (!magnet.attachedTo || !allocatedTruckIds.has(magnet.attachedTo))) {
      return magnet;
    }
    const sideLeft = magnet.x < SHIFT_WIDTH ? 0 : SHIFT_WIDTH;
    return {
      ...magnet,
      x: Math.min(magnet.x + ALLOCATION_LANE_SHIFT, sideLeft + SHIFT_WIDTH - magnet.width),
    };
  });
}

const FOUR_SECTION_HEIGHT = (PARK_UP_TOP - WORK_ROWS_TOP) / 4;

export function spreadFourSectionMagnets(magnets: Magnet[]) {
  return magnets.map((magnet) => {
    if (magnet.crew || magnet.y < WORK_ROWS_TOP || magnet.y >= WORK_ROWS_TOP + WORK_ROW_HEIGHT * 4) return magnet;
    const row = Math.floor((magnet.y - WORK_ROWS_TOP) / WORK_ROW_HEIGHT);
    const offset = magnet.y - (WORK_ROWS_TOP + row * WORK_ROW_HEIGHT);
    return {
      ...magnet,
      y: Math.round(WORK_ROWS_TOP + row * FOUR_SECTION_HEIGHT + (offset * FOUR_SECTION_HEIGHT) / WORK_ROW_HEIGHT),
    };
  });
}

export function resizeWorkSections(
  magnets: Magnet[],
  fromCount: WorkSectionCount,
  toCount: WorkSectionCount,
) {
  const oldHeight = (PARK_UP_TOP - WORK_ROWS_TOP) / fromCount;
  const newHeight = (PARK_UP_TOP - WORK_ROWS_TOP) / toCount;
  const visibleMagnets = pruneHiddenWorkSectionControls(magnets, toCount).magnets;

  return visibleMagnets.map((magnet) => {
    if (magnet.crew || magnet.y < WORK_ROWS_TOP || magnet.y >= PARK_UP_TOP) return magnet;
    const oldRow = Math.min(fromCount - 1, Math.floor((magnet.y - WORK_ROWS_TOP) / oldHeight));
    const rowOffset = (magnet.y - (WORK_ROWS_TOP + oldRow * oldHeight)) / oldHeight;
    const newRow = Math.min(oldRow, toCount - 1);
    return {
      ...magnet,
      y: Math.round(WORK_ROWS_TOP + newRow * newHeight + rowOffset * newHeight),
    };
  });
}

export type MagnetTemplate = Pick<Magnet, "kind" | "primary" | "tone" | "width" | "height" | "crew" | "competencies" | "fullName">;

export const magnetInventoryKey = (
  template: Pick<MagnetTemplate, "kind" | "primary" | "crew" | "fullName">,
) => [template.kind, template.crew ?? "", template.fullName ?? template.primary]
  .map((part) => part.trim().toUpperCase())
  .join(":");

export type BoardArchiveState = {
  magnets: Magnet[];
  boardDate: string;
  roster: string;
  workSectionCount?: WorkSectionCount;
};

export type BoardSnapshot = {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  state: BoardArchiveState;
};

export type BoardHistoryEntry = {
  id: string;
  action: string;
  createdAt: string;
  createdBy: string;
  state: BoardArchiveState;
};

export type BoardAuditEntry = {
  id: string;
  action: string;
  createdAt: string;
  createdBy: string;
};

export type MagneticBoardState = {
  layoutVersion: number;
  magnets: Magnet[];
  personnelNames?: Record<string, string>;
  pitWorkAreas?: string[];
  diggerOptions?: string[];
  customInventory?: MagnetTemplate[];
  removedInventory?: string[];
  snapshots?: BoardSnapshot[];
  historyVersions?: BoardHistoryEntry[];
  auditLog?: BoardAuditEntry[];
  startingMagnets?: Magnet[];
  lastMovedId?: string;
  boardDate: string;
  roster: string;
  updatedAt: string;
  updatedBy: string;
  workSectionCount?: WorkSectionCount;
};

export const kindDefaults: Record<MagnetKind, { width: number; height: number; tone: MagnetTone }> = {
  truck: { width: 64, height: 20, tone: "white" },
  dozer: { width: 64, height: 20, tone: "amber" },
  grader: { width: 64, height: 20, tone: "orange" },
  watercart: { width: 68, height: 20, tone: "blue" },
  excavator: { width: 64, height: 20, tone: "dark" },
  loader: { width: 64, height: 20, tone: "green" },
  lightvehicle: { width: 68, height: 20, tone: "slate" },
  support: { width: 68, height: 20, tone: "teal" },
  location: { width: 150, height: 26, tone: "red" },
  person: { width: 52, height: 20, tone: "white" },
  note: { width: 360, height: 20, tone: "white" },
};

const responsiveWidthKinds = new Set<MagnetKind>([
  "truck", "dozer", "grader", "watercart", "excavator",
  "loader", "lightvehicle", "support", "person",
]);

const magnetCharacterWidth = (character: string) => {
  if (character === " ") return 3.6;
  if ("MW".includes(character)) return 7.2;
  if ("IJL1".includes(character)) return 3.8;
  return 5.4;
};

export function responsiveMagnetWidth(kind: MagnetKind, primary: string, secondary?: string) {
  if (secondary || !responsiveWidthKinds.has(kind)) return undefined;
  const textWidth = [...primary.trim().toUpperCase()]
    .reduce((total, character) => total + magnetCharacterWidth(character), 0);

  return Math.ceil(kind === "person"
    ? Math.max(46, textWidth + 20)
    : kind === "truck"
      ? Math.max(46, textWidth + 16)
      : Math.max(58, textWidth + 16));
}

export function compactCurrentMagnetWidths(magnets: Magnet[]) {
  return magnets.map((magnet) => {
    const width = responsiveMagnetWidth(magnet.kind, magnet.primary, magnet.secondary);
    return width ? { ...magnet, width } : magnet;
  });
}

export function compactMagnetHeight(kind: MagnetKind, height: number) {
  if (responsiveWidthKinds.has(kind)) return 20;
  return height <= 28 ? Math.min(height, kindDefaults[kind].height) : height;
}

const item = (
  id: string, kind: MagnetKind, primary: string, x: number, y: number,
  width = kindDefaults[kind].width, height = kindDefaults[kind].height,
  tone = kindDefaults[kind].tone, secondary?: string,
): Magnet => {
  const responsiveWidth = width === kindDefaults[kind].width
    ? responsiveMagnetWidth(kind, primary, secondary)
    : undefined;

  return {
    id,
    kind,
    primary,
    secondary,
    x: Math.min(expandShiftBoardX(x), BOARD_WIDTH - (responsiveWidth ?? width)),
    y: compactBoardY(y, x),
    width: responsiveWidth ?? width,
    height: compactMagnetHeight(kind, height),
    tone,
    z: 1,
  };
};

const equipment = (
  prefix: string, kind: MagnetKind, labels: string[], x: number, y: number,
): Magnet[] => labels.map((label, index) => item(`${prefix}-${label.toLowerCase()}`, kind, label, x, y + index * 28));

const people = (
  prefix: string, labels: string[], x: number, y: number,
): Magnet[] => labels.map((label, index) => item(`${prefix}-${label.toLowerCase().replace(/\s+/g, "-")}`, "person", label, x, y + index * 28));

const floorTruckPairs = (
  equipmentPrefix: string,
  peoplePrefix: string,
  labels: string[],
  operators: string[],
  rowTop: number,
): Magnet[] => labels.flatMap((label, index) => {
  const equipmentId = `${equipmentPrefix}-${label.toLowerCase()}`;
  const lowerIndex = index - 1;
  const x = index === 0 ? 310 : 310 + (lowerIndex % 3) * 170;
  const y = index === 0 ? rowTop + 6 : rowTop + 88 + Math.floor(lowerIndex / 3) * 28;
  const operator = operators[index];
  const truck = item(equipmentId, "truck", label, x, y);
  if (!operator) return [truck];
  const person = {
    ...item(`${peoplePrefix}-${operator.toLowerCase().replace(/\s+/g, "-")}`, "person", operator, x + 68, y),
    attachedTo: equipmentId,
  };
  return [truck, person];
});

const mineHeaderMagnets: Magnet[] = [
  { id: "day-header-mine-2", kind: "location", primary: "MINE 2", x: 280, y: 119, width: 100, height: 20, z: 1, tone: "white" },
  { id: "day-header-mine-3", kind: "location", primary: "MINE 3", x: 500, y: 119, width: 100, height: 20, z: 1, tone: "white" },
  { id: "night-header-mine-2", kind: "location", primary: "MINE 2", x: SHIFT_WIDTH + 280, y: 119, width: 100, height: 20, z: 1, tone: "white" },
  { id: "night-header-mine-3", kind: "location", primary: "MINE 3", x: SHIFT_WIDTH + 500, y: 119, width: 100, height: 20, z: 1, tone: "white" },
];

export function restoreMineHeaderMagnets(magnets: Magnet[]) {
  const hasHeaderMagnet = (candidate: Magnet) => magnets.some((magnet) =>
    magnet.kind === "location" &&
    magnet.primary.trim().toUpperCase() === candidate.primary &&
    magnet.y >= 100 && magnet.y < WORK_ROWS_TOP &&
    (magnet.x < SHIFT_WIDTH) === (candidate.x < SHIFT_WIDTH),
  );

  return [
    ...magnets,
    ...mineHeaderMagnets
      .filter((candidate) => !hasHeaderMagnet(candidate))
      .map((candidate) => ({ ...candidate })),
  ];
}

export const defaultMagneticBoard: MagneticBoardState = {
  layoutVersion: 16,
  boardDate: "20 JUL 2026",
  roster: "CREW B · NIGHT 4 OF 7",
  updatedAt: "2026-07-20T09:30:00+08:00",
  updatedBy: "MINE CONTROL",
  workSectionCount: 4,
  magnets: restoreMineHeaderMagnets(spreadFourSectionMagnets([
    item("shift-note", "note", "Confirm fuel and park-up locations with Mine Control before end of shift.", 92, 95, 520, 23),
    item("day-supervisor", "person", "PAUL", 18, 149, 100, 27, "white", "SUPERVISOR"),
    item("day-leaders", "person", "MATT · JOHN", 722, 149, 132, 27, "white", "TEAM LEADERS"),
    item("night-supervisor", "person", "BEVAN", 884, 149, 100, 27, "white", "SUPERVISOR"),
    item("night-leaders", "person", "RON · BRETT · NEV", 1566, 149, 156, 27, "white", "TEAM LEADERS"),

    item("d-radio", "location", "RADIO HILL", 10, 224, 118, 28, "amber", "RL 219 · SHOT 5405"),
    ...equipment("d-radio-assets", "excavator", ["EX30"], 142, 224),
    ...people("d-radio-assets-p", ["RICKY"], 210, 224),
    ...equipment("d-radio-dozers", "dozer", ["DZ017"], 142, 254),
    ...people("d-radio-dozers-p", ["WILLIAM"], 210, 254),
    ...floorTruckPairs("d-radio-trucks", "d-radio-people", ["DT215", "DT217", "DT218", "DT221"], ["JENNA", "KIERAN", "HOLLY", "JOSH"], 218),
    item("d-radio-pickup-lv298", "lightvehicle", "LV298", 480, 224),
    ...equipment("d-radio-grader", "grader", ["GR012"], 142, 306),
    ...people("d-radio-grader-p", ["CHAD H"], 210, 306),
    item("d-radio-water-wc019", "watercart", "WC019", 480, 334),
    { ...item("d-radio-water-p-jason-h", "person", "JASON H", 552, 334), attachedTo: "d-radio-water-wc019" },
    item("d-radio-water-wd001", "watercart", "WD001", 650, 334),
    { ...item("d-radio-water-p-suits", "person", "SUITS", 722, 334), attachedTo: "d-radio-water-wd001" },

    item("d-big", "location", "BIG MACK", 10, 370, 118, 28, "red"),
    ...equipment("d-big-assets", "excavator", ["EX32"], 142, 370),
    ...people("d-big-p", ["BEAU"], 210, 370),
    ...floorTruckPairs("d-big-trucks", "d-big-people", ["DT62", "DT68", "DT71", "DT73", "DT75"], ["PETER", "SUZETTE", "KARENE", "CHRIS", "TRAVIS"], 364),

    item("d-corgan", "location", "CORGAN", 10, 516, 118, 28, "teal", "RL 276 · SHOT 8901"),
    ...equipment("d-corgan-assets", "excavator", ["EX29"], 142, 516),
    ...people("d-corgan-p", ["BEAU"], 210, 516),
    ...equipment("d-corgan-dozers", "dozer", ["DZ018"], 142, 546),
    ...people("d-corgan-dozers-p", ["KANE"], 210, 546),
    ...floorTruckPairs("d-corgan-trucks", "d-corgan-people", ["DT63", "DT64", "DT69", "DT74"], ["SUZETTE", "KARENE", "CHRIS", "TRAVIS"], 510),

    item("d-palo", "location", "PALO", 10, 662, 118, 28, "blue", "RL 246 · SHOT 5606"),
    ...equipment("d-palo-assets", "excavator", ["EX31"], 142, 662),
    ...people("d-palo-assets-p", ["MAX"], 210, 662),
    item("d-palo-dozers-dz019", "dozer", "DZ019", 142, 692),
    { ...item("d-palo-dozers-p-huna", "person", "HUNA", 210, 692), attachedTo: "d-palo-dozers-dz019" },
    item("d-palo-dozers-wd14", "dozer", "DZ014", 142, 744),
    { ...item("d-palo-dozers-p-will", "person", "WILL", 210, 744), attachedTo: "d-palo-dozers-wd14" },
    ...floorTruckPairs("d-palo-trucks", "d-palo-people", ["DT219", "DT222", "DT223", "DT224", "DT225", "DT226"], ["DAVID B", "EMILY", "TOM", "BLAYN", "EVE", "DAVE"], 656),

    item("d-spare", "location", "CHRIS D PIT", 10, 808, 118, 28, "violet", "RL 112 · SHOT 1350"),
    item("d-hotseat", "location", "CHRIS/D HOTSEAT", 510, 808, 160, 26, "red"),
    ...equipment("d-hotseat-water", "watercart", ["WC018"], 510, 838),
    ...people("d-hotseat-p", ["NIC"], 582, 838),
    ...equipment("d-hotseat-grader", "grader", ["GR014"], 510, 890),
    ...people("d-hotseat-grader-p", ["DAVE W"], 582, 890),

    item("n-radio", "location", "RADIO HILL", 878, 224, 118, 28, "amber", "RL 219 · SHOT 5401"),
    ...equipment("n-radio-assets", "excavator", ["EX30"], 1008, 224),
    ...people("n-radio-assets-p", ["ADO"], 1076, 224),
    ...equipment("n-radio-dozers", "dozer", ["DZ017"], 1008, 254),
    ...people("n-radio-dozers-p", ["KAIDEN"], 1076, 254),
    ...floorTruckPairs("n-radio-trucks", "n-radio-people", ["DT217", "DT218", "DT221", "DT222"], ["SEPH", "DAVID", "REHAN", "REN"], 218).map((magnet) => ({ ...magnet, x: magnet.x + SHIFT_WIDTH })),

    item("n-corgan", "location", "CORGAN", 878, 370, 118, 28, "teal", "RL 273 · SHOT 8901"),
    ...equipment("n-corgan-assets", "excavator", ["EX29"], 1008, 370),
    ...people("n-corgan-assets-p", ["KINGI"], 1076, 370),
    ...equipment("n-corgan-dozer", "dozer", ["DZ018"], 1008, 400),
    ...people("n-corgan-dozer-p", ["BOSTON"], 1076, 400),
    ...floorTruckPairs("n-corgan-trucks", "n-corgan-people", ["DT69", "DT71", "DT73", "DT74", "DT75"], ["COLIN", "ANNETTE", "IZAAC", "TWO SHOES", "TEAU"], 364).map((magnet) => ({ ...magnet, x: magnet.x + SHIFT_WIDTH })),

    item("n-palo", "location", "PALO", 878, 516, 118, 28, "blue", "RL 246 · SHOT 5606"),
    ...equipment("n-palo-assets", "excavator", ["EX31"], 1008, 516),
    ...people("n-palo-assets-p", ["SAMSON"], 1076, 516),
    ...equipment("n-palo-dozer", "dozer", ["DZ014"], 1008, 546),
    ...people("n-palo-dozer-p", ["CAMERON"], 1076, 546),
    ...floorTruckPairs("n-palo-trucks", "n-palo-people", ["DT216", "DT219", "DT223", "DT224", "DT226"], ["MAJELLA", "NICK", "JEREMY", "ANDREW", "NAE"], 510).map((magnet) => ({ ...magnet, x: magnet.x + SHIFT_WIDTH })),

    item("n-hotseat", "location", "RADIO HILL HOT SEAT", 1400, 662, 174, 26, "red"),
    ...equipment("n-hotseat-support", "support", ["WD001"], 1400, 692),
    ...people("n-hotseat-support-p", ["TROY"], 1472, 692),
    ...equipment("n-hotseat-grader", "grader", ["GR013"], 1400, 744),
    ...people("n-hotseat-grader-p", ["BALLIF"], 1472, 744),
    ...equipment("n-hotseat-water", "watercart", ["WC018"], 1400, 772),
    ...people("n-hotseat-water-p", ["YD"], 1472, 772),

  ])),
};

const templates = (kind: MagnetKind, labels: string[]): MagnetTemplate[] =>
  labels.map((primary) => ({
    kind,
    primary,
    ...kindDefaults[kind],
    width: responsiveMagnetWidth(kind, primary) ?? kindDefaults[kind].width,
  }));

const crewPeople = (crew: CrewCode, names: string[]): MagnetTemplate[] => names.map((fullName) => {
  const primary = fullName.split(" ")[0];
  return {
    kind: "person",
    primary,
    fullName,
    crew,
    competencies: [],
    ...kindDefaults.person,
    width: responsiveMagnetWidth("person", primary) ?? kindDefaults.person.width,
  };
});

// Repeated first names use numbered labels so each saved magnet remains unique.
const crewRosters: Record<CrewCode, MagnetTemplate[]> = {
  A: crewPeople("A", [
    "SONYA", "COLIN", "LEONARD", "ANDREW 1", "DAVID 1", "ANDREW 2", "MALCOLM",
    "NEVILLE", "IZAAC", "JEAN", "SAMMIE", "BRENDON", "TEAU", "YINGWEI", "KAIDEN",
    "RONALD", "JEREMY", "ADRIAN", "REUBEN", "THOMAS", "ANTHONY", "NICHOLAS",
    "MUNASHE", "JOSEPH", "LUKUDU", "KINGI", "REHAN", "MAJELLA", "AARON 1",
    "ANNETTE", "CAMERON", "BOSTON", "SCOTT 1", "SAMSON", "DAVID 2", "JAKSON",
    "SCOTT 2", "BALLIF", "AARON 2", "RENATA", "BENJAMIN", "TROY", "BRETT", "EUGENE",
  ]),
  B: crewPeople("B", [
    "JOSHUA", "ABEL", "HOLLY", "SHANE", "JOHN", "MAREE 1", "SUZETTE", "WAYNE",
    "JOSEPH", "PAUL 1", "CHAD", "JASON", "TYRONE", "CHRISTOPHER", "BRADLEY",
    "WILLIAM", "HUNA", "RYAN", "EMILY", "RICKY", "EVE", "TRAVIS", "MATTHEW",
    "DAVID 1", "MICHAELA", "BLAYN", "KARENE", "MAREE 2", "DYLAN", "WIRIMU",
    "KIERAN", "PAUL 2", "HELEN", "SUN", "MAXWELL", "REUBEN", "GREGORY", "KEVIN",
    "JENNA", "NICHOLAS", "DAVID 2", "PETER", "SUSANNAH",
  ]),
  C: crewPeople("C", [
    "ETHAN 1", "WAYNE", "RAFAEL", "FRANCIS", "MICHAEL 1", "JOSHUA", "COREY",
    "JULIA", "TRAC", "MITCHELL", "STUART", "ANTHONY", "SAMUEL", "CASEY", "JURNEE",
    "AYDEN", "TATIANA", "CHIA-YU", "ETHAN 2", "JOHN 1", "DYLAN", "SHANE 1",
    "LAONA", "PHILLIP", "JOHN 2", "JADE", "GLEN", "ARAPERE", "BENJAMIN", "ZAC",
    "CONNOR", "TIMOTHY", "AARON", "MICHAEL 2", "KASMALI", "MATHEW", "SHANE 2",
    "JOHN 3", "ROWAN", "ALESSIA",
  ]),
};

export const magnetInventory: MagnetTemplate[] = [
  ...templates("truck", ["DT62", "DT63", "DT64", "DT65", "DT66", "DT67", "DT68", "DT69", "DT70", "DT71", "DT72", "DT73", "DT74", "DT75", "DT76", "DT77", "DT214", "DT215", "DT216", "DT217", "DT218", "DT219", "DT221", "DT222", "DT223", "DT224", "DT225", "DT226"]),
  ...templates("dozer", ["DZ014", "DZ017", "DZ018", "DZ019"]),
  ...templates("grader", ["GR012", "GR013", "GR014"]),
  ...templates("watercart", ["WC012", "WC018", "WC019", "WC20", "WC201"]),
  ...templates("excavator", ["EX25", "EX27", "EX28", "EX29", "EX30", "EX31", "EX32"]),
  ...templates("loader", ["WL34", "WL35", "WL36"]),
  ...templates("lightvehicle", ["LV232", "LV258", "LV265", "LV297", "LV298", "LV304", "LV308"]),
  ...templates("support", ["BUS10", "BUS11", "BUS12", "BUS13", "IT15", "IT19", "V304", "WD001"]),
  ...crewRosters.A,
  ...crewRosters.B,
  ...crewRosters.C,
  ...templates("location", ["CHRIS D PIT", "RADIO HILL", "CORGAN", "PALO", "BIG MACK", "RHODES ROM", "DIRECT CART", "RADIO HILL HOT SEAT", "CHRIS/D HOTSEAT", "CHRIS D HOTSEAT BAY", "CORGAN HOT SEAT BAY", "BIG MACK HOTSEAT BAY", "CRIB-HUT GO-LINE", "WORKSHOP DEAD LINE", "GRAVEYARD", "ORE CARTAGE", "CAMP", "MILL", "TRAINING", "U/S", "D&A", "TRAMMING", "ON LEAVE / SICK"]),
];

export const magnetKindLabels: Record<MagnetKind, string> = {
  truck: "Truck", dozer: "Dozer", grader: "Grader", watercart: "Water cart",
  excavator: "Excavator", loader: "Loader", lightvehicle: "Light vehicle",
  support: "Support vehicle", location: "Location / status", person: "Person", note: "Note",
};
