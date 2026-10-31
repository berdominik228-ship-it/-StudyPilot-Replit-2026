import { index, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const materialsTable = pgTable(
  "study_materials",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    subject: varchar("subject", { length: 80 }).notNull(),
    fileName: text("file_name"),
    contentType: varchar("content_type", { length: 160 }),
    objectPath: text("object_path"),
    contentText: text("content_text"),
    notes: text("notes"),
    summary: text("summary"),
    keyTopics: text("key_topics").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("study_materials_user_created_idx").on(table.userId, table.createdAt)],
);

export type StudyMaterial = typeof materialsTable.$inferSelect;
