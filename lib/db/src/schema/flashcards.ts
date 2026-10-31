import { index, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { materialsTable } from "./materials";

export const flashcardsTable = pgTable(
  "study_flashcards",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    materialId: integer("material_id")
      .notNull()
      .references(() => materialsTable.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    difficulty: varchar("difficulty", { length: 16 }).notNull().default("new"),
    reviewCount: integer("review_count").notNull().default(0),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("study_flashcards_user_due_idx").on(table.userId, table.dueAt)],
);

export type Flashcard = typeof flashcardsTable.$inferSelect;
