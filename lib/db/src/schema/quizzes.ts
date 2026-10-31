import { index, integer, jsonb, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";

export interface StoredQuizQuestion {
  id: string;
  prompt: string;
  type: "multiple-choice" | "true-false" | "open-ended";
  choices: string[];
  topic: string;
  correctAnswer: string;
  explanation: string;
  userAnswer: string | null;
  isCorrect: boolean | null;
}

export const quizzesTable = pgTable(
  "quiz_sessions",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    subject: varchar("subject", { length: 80 }).notNull(),
    difficulty: varchar("difficulty", { length: 16 }).notNull(),
    questionCount: integer("question_count").notNull(),
    questions: jsonb("questions").$type<StoredQuizQuestion[]>().notNull(),
    scorePercentage: integer("score_percentage"),
    correctCount: integer("correct_count").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("quiz_sessions_user_created_idx").on(table.userId, table.createdAt)],
);

export type QuizSession = typeof quizzesTable.$inferSelect;
