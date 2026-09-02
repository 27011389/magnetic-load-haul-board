import {
  defaultMagneticBoard,
  type MagneticBoardState,
} from "../../board-data";
import { isBoardState } from "../../board-validation";
import { getBoardWriteCompatibility } from "../../board-sync";
import { getLocalDatabase } from "../../../db/local-database";

const BOARD_ID = 1;
const MAX_BOARD_REQUEST_BYTES = 2_000_000;
const NO_STORE_HEADERS = {
  "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
  pragma: "no-cache",
};
function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  Object.entries(NO_STORE_HEADERS).forEach(([name, value]) => headers.set(name, value));
  return Response.json(body, { ...init, headers });
}

type BoardRow = {
  payload: string;
  version: number;
};

type BoardVersionRow = Pick<BoardRow, "version">;

function getOrCreateBoard() {
  const database = getLocalDatabase();
  const existing = database
    .prepare("SELECT payload, version FROM magnetic_boards WHERE id = ?")
    .get(BOARD_ID) as BoardRow | undefined;
  if (existing) return existing;

  const now = new Date().toISOString();
  const seeded = { ...defaultMagneticBoard, updatedAt: now };
  database
    .prepare(
      "INSERT INTO magnetic_boards (id, payload, version, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(id) DO NOTHING",
    )
    .run(BOARD_ID, JSON.stringify(seeded), now);

  const row = database
    .prepare("SELECT payload, version FROM magnetic_boards WHERE id = ?")
    .get(BOARD_ID) as BoardRow | undefined;
  if (!row) throw new Error("Unable to initialise the magnetic board.");
  return row;
}

export async function GET(request: Request) {
  try {
    const since = Number(new URL(request.url).searchParams.get("since"));
    if (Number.isInteger(since) && since > 0) {
      const current = getLocalDatabase()
        .prepare("SELECT version FROM magnetic_boards WHERE id = ?")
        .get(BOARD_ID) as BoardVersionRow | undefined;
      if (current?.version === since) {
        return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
      }
    }
    const row = getOrCreateBoard();
    const board = JSON.parse(row.payload) as unknown;
    if (!isBoardState(board)) throw new Error("The saved magnetic board is invalid.");
    return jsonResponse({
      board,
      version: row.version,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unable to load the board." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BOARD_REQUEST_BYTES) {
      return jsonResponse({ error: "The magnetic board payload is too large." }, { status: 413 });
    }
    const rawPayload = await request.text();
    if (new TextEncoder().encode(rawPayload).byteLength > MAX_BOARD_REQUEST_BYTES) {
      return jsonResponse({ error: "The magnetic board payload is too large." }, { status: 413 });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      return jsonResponse({ error: "Valid JSON is required." }, { status: 400 });
    }
    const requestedBoard = payload && typeof payload === "object" && "board" in payload ? payload.board : undefined;
    const baseVersion = payload && typeof payload === "object" && "baseVersion" in payload ? payload.baseVersion : undefined;
    const actor = payload && typeof payload === "object" && "actor" in payload && typeof payload.actor === "string"
      ? payload.actor.trim().slice(0, 60)
      : "MINE CONTROL";
    if (!isBoardState(requestedBoard)) {
      return jsonResponse({ error: "A valid magnetic board is required." }, { status: 400 });
    }
    const compatibility = getBoardWriteCompatibility(
      baseVersion,
      requestedBoard.layoutVersion,
      defaultMagneticBoard.layoutVersion,
    );
    if (compatibility === "missing-version") {
      return jsonResponse(
        { error: "Refresh the application before editing the live board." },
        { status: 428 },
      );
    }
    const checkedBaseVersion = baseVersion as number;

    const current = getOrCreateBoard();
    const currentBoard = JSON.parse(current.payload) as unknown;
    if (compatibility === "layout-mismatch") {
      return jsonResponse(
        {
          error: "This screen is running an older application version. Refresh it before editing.",
          board: isBoardState(currentBoard) ? currentBoard : undefined,
          version: current.version,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const board: MagneticBoardState = {
      ...requestedBoard,
      updatedAt: now,
      updatedBy: actor || "MINE CONTROL",
    };

    const database = getLocalDatabase();
    const update = database
      .prepare(`
        UPDATE magnetic_boards
        SET payload = ?, updated_at = ?, version = version + 1
        WHERE id = ?
          AND version = ?
          AND COALESCE(CAST(json_extract(payload, '$.layoutVersion') AS INTEGER), 0) <= ?
      `)
      .run(JSON.stringify(board), now, BOARD_ID, checkedBaseVersion, requestedBoard.layoutVersion);

    if (Number(update.changes) === 0) {
      const latest = database
        .prepare("SELECT payload, version FROM magnetic_boards WHERE id = ?")
        .get(BOARD_ID) as BoardRow | undefined;
      const latestBoard = latest ? JSON.parse(latest.payload) as unknown : null;
      return jsonResponse(
        {
          error: isBoardState(latestBoard) && latestBoard.layoutVersion > requestedBoard.layoutVersion
            ? "A newer application version has updated the board. Refresh this screen before editing."
            : "The board changed on another screen. The latest board has been loaded.",
          board: isBoardState(latestBoard) ? latestBoard : undefined,
          version: latest?.version,
        },
        { status: 409 },
      );
    }

    return jsonResponse({ board, version: checkedBaseVersion + 1 });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unable to save the board." },
      { status: 500 },
    );
  }
}
