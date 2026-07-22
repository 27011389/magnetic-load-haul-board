import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const magneticBoards = sqliteTable("magnetic_boards", {
  id: integer("id").primaryKey(),
  payload: text("payload").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});
