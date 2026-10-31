import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const profilesTable = pgTable("student_profiles", {
  userId: varchar("user_id", { length: 255 }).primaryKey(),
  displayName: varchar("display_name", { length: 100 }).notNull(),
  gradeLevel: varchar("grade_level", { length: 30 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type StudentProfile = typeof profilesTable.$inferSelect;
