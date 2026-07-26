import { headers } from "next/headers";
import {
  defaultMagneticBoard,
  type MagneticBoardState,
} from "../../board-data";

const BOARD_ID = 1;
let schemaReady: Promise<unknown> | null = null;

async function getDatabase() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("The magnetic board database is unavailable.");
  return env.DB;
}

async function ensureSchema() {
  const database = await getDatabase();
  if (!schemaReady) {
    schemaReady = database.prepare(`
      CREATE TABLE IF NOT EXISTS magnetic_boards (
        id INTEGER PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      )
    `).run();
  }
  await schemaReady;
  return database;
}

type BoardRow = {
  payload: string;
  version: number;
  updated_at: string;
};

function isBoardState(value: unknown): value is MagneticBoardState {
  if (!value || typeof value !== "object") return false;
  const board = value as Partial<MagneticBoardState>;
  return Boolean(
    Array.isArray(board.magnets) &&
      typeof board.boardDate === "string" &&
      typeof board.roster === "string" &&
      board.magnets.every(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.primary === "string" &&
          typeof item.x === "number" &&
          typeof item.y === "number",
      ),
  );
}

async function getOrCreateBoard() {
  const database = await ensureSchema();
  const existing = await database
    .prepare("SELECT payload, version, updated_at FROM magnetic_boards WHERE id = ?")
    .bind(BOARD_ID)
    .first<BoardRow>();
  if (existing) return existing;

  const now = new Date().toISOString();
  const seeded = { ...defaultMagneticBoard, updatedAt: now };
  await database
    .prepare(
      "INSERT INTO magnetic_boards (id, payload, version, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(id) DO NOTHING",
    )
    .bind(BOARD_ID, JSON.stringify(seeded), now)
    .run();

  const row = await database
    .prepare("SELECT payload, version, updated_at FROM magnetic_boards WHERE id = ?")
    .bind(BOARD_ID)
    .first<BoardRow>();
  if (!row) throw new Error("Unable to initialise the magnetic board.");
  return row;
}

function getDisplayName(requestHeaders: Headers) {
  const fullName = requestHeaders.get("oai-authenticated-user-full-name");
  const encoding = requestHeaders.get("oai-authenticated-user-full-name-encoding");
  const email = requestHeaders.get("oai-authenticated-user-email");
  if (fullName) {
    try {
      return encoding === "percent-encoded-utf-8"
        ? decodeURIComponent(fullName).toUpperCase()
        : fullName.toUpperCase();
    } catch {
      return fullName.toUpperCase();
    }
  }
  return email?.split("@")[0]?.replace(/[._-]+/g, " ").toUpperCase() || "MINE CONTROL";
}

export async function GET() {
  try {
    const row = await getOrCreateBoard();
    return Response.json({
      board: JSON.parse(row.payload) as MagneticBoardState,
      version: row.version,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load the board." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as { board?: unknown };
    if (!isBoardState(payload.board)) {
      return Response.json({ error: "A valid magnetic board is required." }, { status: 400 });
    }

    const requestHeaders = await headers();
    const now = new Date().toISOString();
    const board: MagneticBoardState = {
      ...payload.board,
      updatedAt: now,
      updatedBy: getDisplayName(requestHeaders),
    };

    await getOrCreateBoard();
    const database = await ensureSchema();
    await database
      .prepare(
        "UPDATE magnetic_boards SET payload = ?, updated_at = ?, version = version + 1 WHERE id = ?",
      )
      .bind(JSON.stringify(board), now, BOARD_ID)
      .run();

    const versionRow = await database
      .prepare("SELECT version FROM magnetic_boards WHERE id = ?")
      .bind(BOARD_ID)
      .first<{ version: number }>();

    return Response.json({ board, version: versionRow?.version ?? 1 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save the board." },
      { status: 500 },
    );
  }
}
