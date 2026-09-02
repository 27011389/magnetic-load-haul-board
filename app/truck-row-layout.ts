import type { Magnet } from "./board-data";

type TruckRowLayoutOptions = {
  magnets: Magnet[];
  truckIds: string[];
  lineY: number;
  laneLeft: number;
  laneRight: number;
  boardWidth: number;
  boardHeight: number;
  operatorGap: number;
  groupGap: number;
};

const overlaps = (left: Magnet, right: Magnet) =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

export const isCloseToAllocationLine = (magnetY: number, lineY: number, snapDistance: number) =>
  Math.abs(magnetY - lineY) <= snapDistance;

export function packTruckAllocationRow({
  magnets,
  truckIds,
  lineY,
  laneLeft,
  laneRight,
  boardWidth,
  boardHeight,
  operatorGap,
  groupGap,
}: TruckRowLayoutOptions) {
  const trucks = truckIds
    .map((id) => magnets.find((magnet) => magnet.id === id && magnet.kind === "truck"))
    .filter((magnet): magnet is Magnet => Boolean(magnet));
  if (!trucks.length) return null;

  const movingIds = new Set(trucks.flatMap((truck) => [
    truck.id,
    ...magnets.filter((magnet) => magnet.attachedTo === truck.id).map((magnet) => magnet.id),
  ]));
  const positioned = new Map<string, Magnet>();
  let cursorX = laneLeft;

  for (const truck of trucks) {
    const operators = magnets
      .filter((magnet) => magnet.kind === "person" && magnet.attachedTo === truck.id)
      .sort((left, right) => left.x - right.x || left.id.localeCompare(right.id));
    let groupRight = cursorX + truck.width;

    positioned.set(truck.id, { ...truck, x: cursorX, y: lineY });
    let operatorX = cursorX + truck.width + operatorGap;
    operators.forEach((operator) => {
      const placed = {
        ...operator,
        x: operatorX,
        y: Math.round(lineY + (truck.height - operator.height) / 2),
        z: Math.max(operator.z, truck.z + 1),
      };
      positioned.set(operator.id, placed);
      operatorX += operator.width + operatorGap;
      groupRight = Math.max(groupRight, placed.x + placed.width);
    });

    if (groupRight > laneRight) return null;
    cursorX = groupRight + groupGap;
  }

  const next = magnets.map((magnet) => positioned.get(magnet.id) ?? magnet);
  const moved = [...positioned.values()];
  const outsideBoard = moved.some((magnet) =>
    magnet.x < 0 || magnet.y < 0 ||
    magnet.x + magnet.width > boardWidth ||
    magnet.y + magnet.height > boardHeight,
  );
  const collides = moved.some((magnet) =>
    next.some((other) => other.id !== magnet.id && !movingIds.has(other.id) && overlaps(magnet, other)),
  );
  return outsideBoard || collides ? null : next;
}
