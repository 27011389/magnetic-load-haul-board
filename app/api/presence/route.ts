import { getLocalDatabase } from "../../../db/local-database";

const MAX_PRESENCE_REQUEST_BYTES = 4_000;
const PRESENCE_TTL_MS = 20_000;
const NO_STORE_HEADERS = {
  "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
  pragma: "no-cache",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  Object.entries(NO_STORE_HEADERS).forEach(([name, value]) => headers.set(name, value));
  return Response.json(body, { ...init, headers });
}

type PresenceRow = {
  session_id: string;
  display_name: string;
  active_magnet_id: string | null;
  updated_at: string;
};

const isSessionId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(value);

const isDisplayName = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= 60;

function readPresence() {
  const database = getLocalDatabase();
  const cutoff = new Date(Date.now() - PRESENCE_TTL_MS).toISOString();
  database.prepare("DELETE FROM magnetic_board_presence WHERE updated_at < ?").run(cutoff);
  const rows = database
    .prepare("SELECT session_id, display_name, active_magnet_id, updated_at FROM magnetic_board_presence ORDER BY updated_at DESC")
    .all() as unknown as PresenceRow[];
  return rows.map((row) => ({
    sessionId: row.session_id,
    displayName: row.display_name,
    activeMagnetId: row.active_magnet_id ?? undefined,
    updatedAt: row.updated_at,
  }));
}

export async function GET() {
  try {
    return jsonResponse({ users: readPresence() });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unable to load board presence." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_PRESENCE_REQUEST_BYTES) {
      return jsonResponse({ error: "The presence payload is too large." }, { status: 413 });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return jsonResponse({ error: "Valid JSON is required." }, { status: 400 });
    }
    if (!payload || typeof payload !== "object") {
      return jsonResponse({ error: "Valid presence details are required." }, { status: 400 });
    }
    const sessionId = "sessionId" in payload ? payload.sessionId : undefined;
    const displayName = "displayName" in payload ? payload.displayName : undefined;
    const activeMagnetId = "activeMagnetId" in payload ? payload.activeMagnetId : undefined;
    if (
      !isSessionId(sessionId) ||
      !isDisplayName(displayName) ||
      (activeMagnetId !== undefined && activeMagnetId !== null && (typeof activeMagnetId !== "string" || activeMagnetId.length > 200))
    ) {
      return jsonResponse({ error: "Valid presence details are required." }, { status: 400 });
    }
    const database = getLocalDatabase();
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO magnetic_board_presence (session_id, display_name, active_magnet_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        display_name = excluded.display_name,
        active_magnet_id = excluded.active_magnet_id,
        updated_at = excluded.updated_at
    `).run(sessionId, displayName.trim(), activeMagnetId || null, now);
    return jsonResponse({ users: readPresence() });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unable to update board presence." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = (await request.json()) as { sessionId?: unknown };
    if (!isSessionId(payload.sessionId)) {
      return jsonResponse({ error: "A valid session ID is required." }, { status: 400 });
    }
    const database = getLocalDatabase();
    database.prepare("DELETE FROM magnetic_board_presence WHERE session_id = ?").run(payload.sessionId);
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unable to clear board presence." },
      { status: 500 },
    );
  }
}
