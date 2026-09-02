import type { Magnet } from "./board-data";

const rectangleDistance = (left: Magnet, right: Magnet) => {
  const dx = Math.max(left.x - (right.x + right.width), right.x - (left.x + left.width), 0);
  const dy = Math.max(left.y - (right.y + right.height), right.y - (left.y + left.height), 0);
  return Math.hypot(dx, dy);
};

export function claimUniqueMagnetId(baseId: string, usedIds: Set<string>) {
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }

  let suffix = 2;
  let candidate = `${baseId}-${suffix}`;
  while (usedIds.has(candidate)) {
    suffix += 1;
    candidate = `${baseId}-${suffix}`;
  }
  usedIds.add(candidate);
  return candidate;
}

export function ensureUniqueMagnetIds(magnets: Magnet[]) {
  const usedIds = new Set(magnets.map((magnet) => magnet.id));
  const seenIds = new Set<string>();
  const replacementIds = new Map<number, string>();
  const indicesByOriginalId = new Map<string, number[]>();
  let changed = false;

  magnets.forEach((magnet, index) => {
    const indices = indicesByOriginalId.get(magnet.id) ?? [];
    indices.push(index);
    indicesByOriginalId.set(magnet.id, indices);

    if (!seenIds.has(magnet.id)) {
      seenIds.add(magnet.id);
      replacementIds.set(index, magnet.id);
      return;
    }

    replacementIds.set(index, claimUniqueMagnetId(magnet.id, usedIds));
    changed = true;
  });

  if (!changed) return { magnets, changed };

  return {
    changed,
    magnets: magnets.map((magnet, index) => {
      let attachedTo = magnet.attachedTo;
      const attachmentCandidates = attachedTo ? indicesByOriginalId.get(attachedTo) ?? [] : [];
      if (attachmentCandidates.length > 1) {
        const closestIndex = [...attachmentCandidates]
          .sort((leftIndex, rightIndex) =>
            rectangleDistance(magnet, magnets[leftIndex]) - rectangleDistance(magnet, magnets[rightIndex]),
          )[0];
        attachedTo = replacementIds.get(closestIndex) ?? attachedTo;
      }
      return {
        ...magnet,
        id: replacementIds.get(index) ?? magnet.id,
        attachedTo,
      };
    }),
  };
}
