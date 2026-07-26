export const BOARD_WIDTH = 1880;
export const BOARD_HEIGHT = 918;

export const WORK_ROWS_TOP = 170;
export const WORK_ROW_HEIGHT = 126;
export const PARK_UP_TOP = 800;

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
};

export type MagnetTemplate = Pick<Magnet, "kind" | "primary" | "tone" | "width" | "height">;

export type MagneticBoardState = {
  layoutVersion: number;
  magnets: Magnet[];
  startingMagnets?: Magnet[];
  lastMovedId?: string;
  boardDate: string;
  roster: string;
  updatedAt: string;
  updatedBy: string;
};

export const kindDefaults: Record<MagnetKind, { width: number; height: number; tone: MagnetTone }> = {
  truck: { width: 64, height: 22, tone: "white" },
  dozer: { width: 64, height: 22, tone: "amber" },
  grader: { width: 64, height: 22, tone: "orange" },
  watercart: { width: 68, height: 22, tone: "blue" },
  excavator: { width: 64, height: 22, tone: "dark" },
  loader: { width: 64, height: 22, tone: "green" },
  lightvehicle: { width: 68, height: 22, tone: "slate" },
  support: { width: 68, height: 22, tone: "teal" },
  location: { width: 150, height: 26, tone: "red" },
  person: { width: 92, height: 22, tone: "white" },
  note: { width: 360, height: 20, tone: "white" },
};

export function compactMagnetHeight(kind: MagnetKind, height: number) {
  const legacyCeiling = kind === "person" ? 29 : kind === "location" || kind === "note" ? 28 : 24;
  return height <= legacyCeiling ? Math.min(height, kindDefaults[kind].height) : height;
}

const item = (
  id: string, kind: MagnetKind, primary: string, x: number, y: number,
  width = kindDefaults[kind].width, height = kindDefaults[kind].height,
  tone = kindDefaults[kind].tone, secondary?: string,
): Magnet => ({
  id,
  kind,
  primary,
  secondary,
  x,
  y: compactBoardY(y, x),
  width,
  height: compactMagnetHeight(kind, height),
  tone,
  z: 1,
});

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

export const defaultMagneticBoard: MagneticBoardState = {
  layoutVersion: 6,
  boardDate: "20 JUL 2026",
  roster: "CREW B · NIGHT 4 OF 7",
  updatedAt: "2026-07-20T09:30:00+08:00",
  updatedBy: "MINE CONTROL",
  magnets: [
    item("shift-note", "note", "Confirm fuel and park-up locations with Mine Control before end of shift.", 92, 95, 520, 23),
    item("day-supervisor", "person", "PAUL T", 18, 149, 100, 27, "white", "SUPERVISOR"),
    item("day-leaders", "person", "MATT · JOHN C", 722, 149, 132, 27, "white", "TEAM LEADERS"),
    item("night-supervisor", "person", "BEVAN", 884, 149, 100, 27, "white", "SUPERVISOR"),
    item("night-leaders", "person", "RON · BRETT · NEV", 1566, 149, 156, 27, "white", "TEAM LEADERS"),

    item("d-radio", "location", "RADIO HILL", 10, 224, 118, 28, "amber", "RL 219 · SHOT 5405"),
    ...equipment("d-radio-assets", "excavator", ["EX30"], 142, 224),
    ...people("d-radio-assets-p", ["RICKY M"], 210, 224),
    ...equipment("d-radio-dozers", "dozer", ["DZ17"], 142, 254),
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
    ...floorTruckPairs("d-corgan-trucks", "d-corgan-people", ["DT69", "DT71", "DT74", "DT75"], ["SUZETTE", "KARENE", "CHRIS", "TRAVIS"], 510),

    item("d-palo", "location", "PALO", 10, 662, 118, 28, "blue", "RL 246 · SHOT 5606"),
    ...equipment("d-palo-assets", "excavator", ["EX31"], 142, 662),
    ...people("d-palo-assets-p", ["MAX"], 210, 662),
    item("d-palo-dozers-dz019", "dozer", "DZ019", 142, 692),
    { ...item("d-palo-dozers-p-huna", "person", "HUNA", 210, 692), attachedTo: "d-palo-dozers-dz019" },
    item("d-palo-dozers-wd14", "dozer", "WD14", 142, 744),
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
    ...equipment("n-radio-dozers", "dozer", ["DZ17"], 1008, 254),
    ...people("n-radio-dozers-p", ["KAIDEN"], 1076, 254),
    ...floorTruckPairs("n-radio-trucks", "n-radio-people", ["DT217", "DT218", "DT221", "DT222"], ["SEPH", "DAVID S", "REHAN", "REN"], 218).map((magnet) => ({ ...magnet, x: magnet.x + 870 })),

    item("n-corgan", "location", "CORGAN", 878, 370, 118, 28, "teal", "RL 273 · SHOT 8901"),
    ...equipment("n-corgan-assets", "excavator", ["EX29"], 1008, 370),
    ...people("n-corgan-assets-p", ["KINGI"], 1076, 370),
    ...equipment("n-corgan-dozer", "dozer", ["DZ018"], 1008, 400),
    ...people("n-corgan-dozer-p", ["BOSTON"], 1076, 400),
    ...floorTruckPairs("n-corgan-trucks", "n-corgan-people", ["DT69", "DT71", "DT73", "DT74", "DT75"], ["COLIN", "ANNETTE", "IZAAC", "TWO SHOES", "TEAU"], 364).map((magnet) => ({ ...magnet, x: magnet.x + 870 })),

    item("n-palo", "location", "PALO", 878, 516, 118, 28, "blue", "RL 246 · SHOT 5606"),
    ...equipment("n-palo-assets", "excavator", ["EX31"], 1008, 516),
    ...people("n-palo-assets-p", ["SAMSON"], 1076, 516),
    ...equipment("n-palo-dozer", "dozer", ["WD14"], 1008, 546),
    ...people("n-palo-dozer-p", ["CAMERON"], 1076, 546),
    ...floorTruckPairs("n-palo-trucks", "n-palo-people", ["DT216", "DT219", "DT223", "DT224", "DT226"], ["MAJELLA", "NICK", "JEREMY", "ANDREW", "NAE"], 510).map((magnet) => ({ ...magnet, x: magnet.x + 870 })),

    item("n-hotseat", "location", "RADIO HILL HOT SEAT", 1400, 662, 174, 26, "red"),
    ...equipment("n-hotseat-support", "support", ["WD001"], 1400, 692),
    ...people("n-hotseat-support-p", ["TROY"], 1472, 692),
    ...equipment("n-hotseat-grader", "grader", ["GR013"], 1400, 744),
    ...people("n-hotseat-grader-p", ["BALLIF"], 1472, 744),
    ...equipment("n-hotseat-water", "watercart", ["WC018"], 1400, 772),
    ...people("n-hotseat-water-p", ["YD"], 1472, 772),

    ...people("rr", ["MIKE S", "MATTHEW", "MITCHELL", "ROWAN", "STU", "ROO", "ANTHONY H", "AYDEN", "MICK C", "CONNOR", "ETHAN A", "PAUL H", "GLEN", "COREY", "ZAC R", "REUBEN", "SUSIE", "WAYNE", "BEN", "TREVOR", "MICHELLE"], 1740, 212),
  ],
};

const templates = (kind: MagnetKind, labels: string[]): MagnetTemplate[] =>
  labels.map((primary) => ({ kind, primary, ...kindDefaults[kind] }));

export const magnetInventory: MagnetTemplate[] = [
  ...templates("truck", ["DT62", "DT63", "DT64", "DT65", "DT66", "DT67", "DT68", "DT69", "DT70", "DT71", "DT72", "DT73", "DT74", "DT75", "DT76", "DT77", "DT214", "DT215", "DT216", "DT217", "DT218", "DT219", "DT221", "DT222", "DT223", "DT224", "DT225", "DT226"]),
  ...templates("dozer", ["DZ17", "DZ018", "DZ019", "WD14"]),
  ...templates("grader", ["GR012", "GR013", "GR014"]),
  ...templates("watercart", ["WC012", "WC018", "WC019", "WC20", "WC201"]),
  ...templates("excavator", ["EX25", "EX27", "EX28", "EX29", "EX30", "EX31", "EX32"]),
  ...templates("loader", ["WL34", "WL35", "WL36"]),
  ...templates("lightvehicle", ["LV232", "LV258", "LV265", "LV297", "LV298", "LV304", "LV308"]),
  ...templates("support", ["BUS10", "BUS11", "BUS12", "BUS13", "IT15", "IT19", "V304", "WD001"]),
  ...templates("person", ["PAUL T", "MATT", "JOHN C", "BEVAN", "RON", "BRETT", "NEV", "RICKY M", "WILLIAM", "JENNA", "KIERAN", "HOLLY", "RED", "CHAD H", "JASON H", "SUITS", "MICHAELA", "SHANE", "DAVE W", "BEAU", "KANE", "PETER", "SUZETTE", "KARENE", "CHRIS", "MAX", "WILL", "DAVID B", "EMILY", "TOM", "BLAYN", "EVE", "DAVE", "ADO", "KAIDEN", "SEPH", "DAVID S", "REHAN", "REN", "KINGI", "BOSTON", "COLIN", "ANNETTE", "IZAAC", "TWO SHOES", "TEAU", "SAMSON", "CAMERON", "MAJELLA", "NICK", "JEREMY", "ANDREW", "NAE", "REUBS", "EUGENE", "TROY", "BALLIF", "YD", "ROBBO", "JACKSON", "BRENDON", "JEAN", "NASH", "LIN", "LESS", "ANT", "RAF", "MIKE S", "RICK", "MATTHEW", "MITCHELL", "CAZ", "COOKIE", "SHANE M", "ROWAN", "AARON", "STU", "ROO", "PHILLIP N", "BENJI", "ANTHONY H", "AYDEN", "MICK C", "JURNEE", "CONNOR", "ARAZ", "KASMALI", "ETHAN A", "PAUL H", "GLEN", "COREY", "SHANE T", "HELEN", "JOHNNO", "SAM H", "ZAC R", "WAYEN", "FARMER", "LUKUDU", "SUN", "REUBEN", "SUSIE", "WAYNE", "BEN", "MAREE", "TREVOR", "FRIDGE", "MICHELLE", "GEORGE", "JASON", "ETHAN C", "JOHN M", "LEE", "JOSHUA", "TIM S", "LAONA", "ETHAN", "MALCOM", "SONYA", "ABEL", "JULIAN", "TRAC", "TATIANA"]),
  ...templates("location", ["CHRIS D PIT", "RADIO HILL", "CORGAN", "PALO", "BIG MACK", "RHODES ROM", "DIRECT CART", "RADIO HILL HOT SEAT", "CHRIS/D HOTSEAT", "CHRIS D HOTSEAT BAY", "CORGAN HOT SEAT BAY", "BIG MACK HOTSEAT BAY", "CRIB-HUT GO-LINE", "WORKSHOP DEAD LINE", "GRAVEYARD", "ORE CARTAGE", "CAMP", "MILL", "TRAINING", "U/S", "ON LEAVE / SICK"]),
];

export const magnetKindLabels: Record<MagnetKind, string> = {
  truck: "Truck", dozer: "Dozer", grader: "Grader", watercart: "Water cart",
  excavator: "Excavator", loader: "Loader", lightvehicle: "Light vehicle",
  support: "Support vehicle", location: "Location / status", person: "Person", note: "Note",
};

export const magnetToneOptions: MagnetTone[] = [
  "white", "dark", "amber", "red", "teal", "blue", "violet", "green", "orange", "slate",
];
