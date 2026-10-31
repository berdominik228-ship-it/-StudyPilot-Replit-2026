import { index, date, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";

export const examsTable = pgTable(
  "upcoming_exams",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    subject: varchar("subject", { length: 80 }).notNull(),
    examDate: date("exam_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("upcoming_exams_user_date_idx").on(table.userId, table.examDate)],
);

export type Exam = typeof examsTable.$inferSelect;
