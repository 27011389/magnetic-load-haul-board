import type {
  CrewCode,
  EquipmentStatus,
  Magnet,
  MagneticBoardState,
  MagnetKind,
  MagnetTemplate,
  MagnetTone,
  WorkSectionCount,
} from "./board-data";

const MAGNET_KINDS = new Set<MagnetKind>([
  "truck", "dozer", "grader", "watercart", "excavator", "loader",
  "lightvehicle", "support", "location", "person", "note",
]);
const MAGNET_TONES = new Set<MagnetTone>([
  "white", "dark", "amber", "red", "teal", "blue", "violet", "green", "orange", "slate",
]);
const CREW_CODES = new Set<CrewCode>(["A", "B", "C"]);
const WORK_SECTION_COUNTS = new Set<WorkSectionCount>([1, 2, 3, 4, 5]);
const EQUIPMENT_STATUSES = new Set<EquipmentStatus>([
  "available", "breakdown", "fuel", "workshop", "standby", "awaiting-operator",
]);
const MAX_MAGNETS = 2_000;
const MAX_TEXT_LENGTH = 10_000;
const MAX_DIMENSION = 10_000;
const MAX_COORDINATE = 100_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isText = (value: unknown, allowEmpty = true): value is string =>
  typeof value === "string" && value.length <= MAX_TEXT_LENGTH && (allowEmpty || value.trim().length > 0);

const isOptionalText = (value: unknown) => value === undefined || isText(value);
const isOptionalNonEmptyText = (value: unknown) => value === undefined || isText(value, false);

const isDateText = (value: unknown) =>
  isText(value, false) && Number.isFinite(Date.parse(value));

const isFiniteNumber = (value: unknown, limit = MAX_COORDINATE): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;

const isOptionalStringArray = (value: unknown) =>
  value === undefined || (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((item) => isText(item))
  );

function hasValidMagnetTemplateFields(
  value: unknown,
  allowEmptyPrimary = false,
): value is MagnetTemplate {
  if (!isRecord(value)) return false;
  return (
    MAGNET_KINDS.has(value.kind as MagnetKind) &&
    MAGNET_TONES.has(value.tone as MagnetTone) &&
    isText(value.primary, allowEmptyPrimary) &&
    isFiniteNumber(value.width, MAX_DIMENSION) && value.width > 0 &&
    isFiniteNumber(value.height, MAX_DIMENSION) && value.height > 0 &&
    (value.crew === undefined || CREW_CODES.has(value.crew as CrewCode)) &&
    isOptionalStringArray(value.competencies) &&
    isOptionalText(value.fullName)
  );
}

export function isMagnetTemplate(value: unknown): value is MagnetTemplate {
  return hasValidMagnetTemplateFields(value);
}

function isMagnet(value: unknown): value is Magnet {
  if (!isRecord(value)) return false;
  const fields: Record<string, unknown> = value;
  const isReservedShiftNote = fields.id === "shift-note" && fields.kind === "note";
  if (!hasValidMagnetTemplateFields(value, isReservedShiftNote)) return false;
  return (
    isText(fields.id, false) &&
    isFiniteNumber(fields.x) &&
    isFiniteNumber(fields.y) &&
    isFiniteNumber(fields.z) &&
    isOptionalText(fields.secondary) &&
    isOptionalNonEmptyText(fields.attachedTo) &&
    isOptionalText(fields.note) &&
    (fields.parkedFromShift === undefined || fields.parkedFromShift === "day" || fields.parkedFromShift === "night") &&
    (fields.equipmentStatus === undefined || EQUIPMENT_STATUSES.has(fields.equipmentStatus as EquipmentStatus))
  );
}

const isMagnetArray = (value: unknown) =>
  Array.isArray(value) && value.length <= MAX_MAGNETS && value.every(isMagnet);

const isOptionalTextArray = (value: unknown) =>
  value === undefined || (
    Array.isArray(value) &&
    value.length <= MAX_MAGNETS &&
    value.every((item) => isText(item))
  );

const isOptionalPersonnelNames = (value: unknown) =>
  value === undefined || (
    isRecord(value) &&
    Object.keys(value).length <= MAX_MAGNETS &&
    Object.values(value).every((item) => isText(item))
  );

const isArchiveState = (value: unknown) => {
  if (!isRecord(value)) return false;
  return (
    isMagnetArray(value.magnets) &&
    isText(value.boardDate) &&
    isText(value.roster) &&
    (value.workSectionCount === undefined || WORK_SECTION_COUNTS.has(value.workSectionCount as WorkSectionCount))
  );
};

const isArchiveEntry = (value: unknown, includeName: boolean) => {
  if (!isRecord(value)) return false;
  return (
    isText(value.id, false) &&
    (!includeName || isText(value.name, false)) &&
    (!includeName || value.action === undefined) &&
    (includeName || isText(value.action, false)) &&
    isDateText(value.createdAt) &&
    isText(value.createdBy, false) &&
    isArchiveState(value.state)
  );
};

const isAuditEntry = (value: unknown) => {
  if (!isRecord(value)) return false;
  return isText(value.id, false) && isText(value.action, false) && isDateText(value.createdAt) && isText(value.createdBy, false);
};

const isOptionalBoundedArray = (
  value: unknown,
  maxLength: number,
  validator: (entry: unknown) => boolean,
) => value === undefined || (Array.isArray(value) && value.length <= maxLength && value.every(validator));

export function isBoardState(value: unknown): value is MagneticBoardState {
  if (!isRecord(value)) return false;
  return (
    Number.isInteger(value.layoutVersion) && (value.layoutVersion as number) >= 1 &&
    isMagnetArray(value.magnets) &&
    isText(value.boardDate) &&
    isText(value.roster) &&
    isDateText(value.updatedAt) &&
    isText(value.updatedBy, false) &&
    (value.workSectionCount === undefined || WORK_SECTION_COUNTS.has(value.workSectionCount as WorkSectionCount)) &&
    isOptionalPersonnelNames(value.personnelNames) &&
    isOptionalTextArray(value.pitWorkAreas) &&
    isOptionalTextArray(value.diggerOptions) &&
    (value.customInventory === undefined || (
      Array.isArray(value.customInventory) &&
      value.customInventory.length <= MAX_MAGNETS &&
      value.customInventory.every(isMagnetTemplate)
    )) &&
    isOptionalTextArray(value.removedInventory) &&
    isOptionalBoundedArray(value.snapshots, 12, (entry) => isArchiveEntry(entry, true)) &&
    isOptionalBoundedArray(value.historyVersions, 10, (entry) => isArchiveEntry(entry, false)) &&
    isOptionalBoundedArray(value.auditLog, 100, isAuditEntry) &&
    (value.startingMagnets === undefined || isMagnetArray(value.startingMagnets)) &&
    isOptionalText(value.lastMovedId)
  );
}
