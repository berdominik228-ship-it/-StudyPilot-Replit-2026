import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { materialsTable } from "./materials";

export type TutorLanguage = "en" | "et" | "ru";
export type TutorLevel = "beginner" | "intermediate" | "advanced";
export type TutorMessageRole = "user" | "assistant";

export const tutorConversationsTable = pgTable(
  "tutor_conversations",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    language: varchar("language", { length: 8 })
      .$type<TutorLanguage>()
      .notNull()
      .default("en"),
    level: varchar("level", { length: 20 })
      .$type<TutorLevel>()
      .notNull()
      .default("intermediate"),
    materialId: integer("material_id").references(() => materialsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("tutor_conversations_user_updated_idx").on(
      table.userId,
      table.updatedAt,
    ),
  ],
);

export const tutorMessagesTable = pgTable(
  "tutor_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => tutorConversationsTable.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 12 }).$type<TutorMessageRole>().notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("tutor_messages_conversation_idx").on(
      table.conversationId,
      table.id,
    ),
  ],
);

export type TutorConversation =
  typeof tutorConversationsTable.$inferSelect;
export type TutorMessage = typeof tutorMessagesTable.$inferSelect;
