import { index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const uploadIntentsTable = pgTable(
  "upload_intents",
  {
    objectPath: text("object_path").primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("upload_intents_user_idx").on(table.userId, table.expiresAt)],
);
