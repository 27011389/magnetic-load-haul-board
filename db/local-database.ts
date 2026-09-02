import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DATABASE_FILE = process.env.NODE_ENV === "development"
  ? "shiftboard-development.sqlite"
  : "shiftboard.sqlite";
const DEFAULT_DATABASE_PATH = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "data",
  DEFAULT_DATABASE_FILE,
);

type DatabaseGlobal = typeof globalThis & {
  shiftboardDatabase?: DatabaseSync;
  shiftboardDatabasePath?: string;
};

const databaseGlobal = globalThis as DatabaseGlobal;

function getDatabasePath() {
  const configuredPath = process.env.SHIFTBOARD_DB_PATH?.trim();
  return configuredPath
    ? path.resolve(/* turbopackIgnore: true */ configuredPath)
    : DEFAULT_DATABASE_PATH;
}

export function getLocalDatabase() {
  const databasePath = getDatabasePath();
  if (databaseGlobal.shiftboardDatabase && databaseGlobal.shiftboardDatabasePath === databasePath) {
    return databaseGlobal.shiftboardDatabase;
  }

  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS magnetic_boards (
      id INTEGER PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS magnetic_board_presence (
      session_id TEXT PRIMARY KEY NOT NULL,
      display_name TEXT NOT NULL,
      active_magnet_id TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  databaseGlobal.shiftboardDatabase?.close();
  databaseGlobal.shiftboardDatabase = database;
  databaseGlobal.shiftboardDatabasePath = databasePath;
  return database;
}
