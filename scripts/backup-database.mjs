import { mkdirSync } from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const databasePath = path.resolve(
  process.env.SHIFTBOARD_DB_PATH?.trim() || path.join("data", "shiftboard.sqlite"),
);
const backupDirectory = path.resolve(
  process.env.SHIFTBOARD_BACKUP_DIR?.trim() || path.join("data", "backups"),
);
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const backupPath = path.join(backupDirectory, `shiftboard-${timestamp}.sqlite`);

mkdirSync(backupDirectory, { recursive: true });
const database = new DatabaseSync(databasePath, { readOnly: true });
try {
  await backup(database, backupPath);
} finally {
  database.close();
}

console.log(`Created SQLite backup: ${backupPath}`);
