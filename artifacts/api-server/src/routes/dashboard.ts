import {
  CreateExamBody,
  CreateExamResponse,
  DeleteExamParams,
  GetDashboardResponse,
  GetProfileResponse,
  GetProgressResponse,
  ListExamsResponse,
  UpdateProfileBody,
  UpdateProfileResponse,
} from "@workspace/api-zod";
import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import {
  db,
  examsTable,
  flashcardsTable,
  materialsTable,
  profilesTable,
  quizzesTable,
} from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();
const FREE_MONTHLY_TEST_LIMIT = 5;

function userIdFor(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return req.user.id;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function calculateStreak(completedAt: Date[]): number {
  const days = new Set(completedAt.map(dateKey));
  const today = new Date();
  const todayKey = dateKey(today);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = dateKey(yesterday);
  let cursor = days.has(todayKey) ? today : yesterday;
  if (!days.has(dateKey(cursor))) return 0;

  let streak = 0;
  while (days.has(dateKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  return streak;
}

function weakTopicSummary(
  quizzes: (typeof quizzesTable.$inferSelect)[],
) {
  const topics = new Map<
    string,
    { topic: string; subject: string; attempts: number; correct: number }
  >();
  for (const quiz of quizzes) {
    for (const question of quiz.questions) {
      if (question.userAnswer === null || question.isCorrect === null) continue;
      const key = `${quiz.subject}\u0000${question.topic}`;
      const current = topics.get(key) ?? {
        topic: question.topic,
        subject: quiz.subject,
        attempts: 0,
        correct: 0,
      };
      current.attempts += 1;
      if (question.isCorrect) current.correct += 1;
      topics.set(key, current);
    }
  }
  return [...topics.values()]
    .map(({ topic, subject, attempts, correct }) => ({
      topic,
      subject,
      attempts,
      accuracy: Math.round((correct / attempts) * 100),
    }))
    .filter((topic) => topic.accuracy < 70)
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
    .slice(0, 6);
}

async function getMonthlyTestUsage(userId: string): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [usage] = await db
    .select({ value: count() })
    .from(quizzesTable)
    .where(
      and(
        eq(quizzesTable.userId, userId),
        gte(quizzesTable.createdAt, monthStart),
      ),
    );
  return usage?.value ?? 0;
}

router.get(
  "/dashboard",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const now = new Date();
    const today = dateKey(now);
    const [
      materials,
      recentQuizzes,
      completedQuizzes,
      upcomingExams,
      dueFlashcards,
      monthlyAiTestsUsed,
    ] = await Promise.all([
      db
        .select()
        .from(materialsTable)
        .where(eq(materialsTable.userId, userId))
        .orderBy(desc(materialsTable.updatedAt))
        .limit(4),
      db
        .select()
        .from(quizzesTable)
        .where(eq(quizzesTable.userId, userId))
        .orderBy(desc(quizzesTable.createdAt))
        .limit(4),
      db
        .select()
        .from(quizzesTable)
        .where(eq(quizzesTable.userId, userId))
        .orderBy(desc(quizzesTable.completedAt))
        .limit(120),
      db
        .select()
        .from(examsTable)
        .where(
          and(
            eq(examsTable.userId, userId),
            gte(examsTable.examDate, today),
          ),
        )
        .orderBy(examsTable.examDate)
        .limit(1),
      db
        .select({ value: count() })
        .from(flashcardsTable)
        .where(
          and(
            eq(flashcardsTable.userId, userId),
            lte(flashcardsTable.dueAt, new Date()),
          ),
        ),
      getMonthlyTestUsage(userId),
    ]);
    const [materialCount] = await db
      .select({ value: count() })
      .from(materialsTable)
      .where(eq(materialsTable.userId, userId));
    const [quizCount] = await db
      .select({ value: count() })
      .from(quizzesTable)
      .where(eq(quizzesTable.userId, userId));

    const scores = completedQuizzes
      .filter((quiz) => quiz.scorePercentage !== null)
      .map((quiz) => quiz.scorePercentage!);
    const allCompletedDates = completedQuizzes
      .map((quiz) => quiz.completedAt)
      .filter((value): value is Date => value !== null);
    const averageScore = scores.length
      ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
      : 0;
    const [profile] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.userId, userId))
      .limit(1);
    const userName =
      profile?.displayName ||
      [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ") ||
      "Student";

    res.json(
      GetDashboardResponse.parse({
        userName,
        totalMaterials: materialCount?.value ?? 0,
        totalQuizzes: quizCount?.value ?? 0,
        averageScore,
        studyStreak: calculateStreak(allCompletedDates),
        flashcardsDue: dueFlashcards[0]?.value ?? 0,
        nextExam: upcomingExams[0] ?? null,
        recentMaterials: materials,
        recentResults: recentQuizzes,
        weakTopics: weakTopicSummary(completedQuizzes),
        monthlyAiTestsUsed,
        monthlyAiTestLimit: FREE_MONTHLY_TEST_LIMIT,
      }),
    );
  },
);

router.get(
  "/progress",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const [materialCount, quizCount, completed, cardsDue, masteredCards] =
      await Promise.all([
        db
          .select({ value: count() })
          .from(materialsTable)
          .where(eq(materialsTable.userId, userId)),
        db
          .select({ value: count() })
          .from(quizzesTable)
          .where(eq(quizzesTable.userId, userId)),
        db
          .select()
          .from(quizzesTable)
          .where(
            and(
              eq(quizzesTable.userId, userId),
              gte(quizzesTable.completedAt, new Date(0)),
            ),
          )
          .orderBy(desc(quizzesTable.completedAt))
          .limit(120),
        db
          .select({ value: count() })
          .from(flashcardsTable)
          .where(
            and(
              eq(flashcardsTable.userId, userId),
              lte(flashcardsTable.dueAt, new Date()),
            ),
          ),
        db
          .select({ value: count() })
          .from(flashcardsTable)
          .where(
            and(
              eq(flashcardsTable.userId, userId),
              eq(flashcardsTable.difficulty, "easy"),
            ),
          ),
      ]);
    const scored = completed.filter((quiz) => quiz.scorePercentage !== null);
    const averageScore = scored.length
      ? Math.round(
          scored.reduce((sum, quiz) => sum + (quiz.scorePercentage ?? 0), 0) /
            scored.length,
        )
      : 0;
    const scoreTrend = [...scored]
      .reverse()
      .slice(-12)
      .map((quiz) => ({
        date: dateKey(quiz.completedAt ?? quiz.createdAt),
        score: quiz.scorePercentage ?? 0,
        subject: quiz.subject,
      }));

    res.json(
      GetProgressResponse.parse({
        totalMaterials: materialCount[0]?.value ?? 0,
        totalQuizzes: quizCount[0]?.value ?? 0,
        completedQuizzes: completed.length,
        averageScore,
        studyStreak: calculateStreak(
          completed
            .map((quiz) => quiz.completedAt)
            .filter((value): value is Date => value !== null),
        ),
        flashcardsDue: cardsDue[0]?.value ?? 0,
        masteredFlashcards: masteredCards[0]?.value ?? 0,
        scoreTrend,
        weakTopics: weakTopicSummary(completed),
      }),
    );
  },
);

router.get("/exams", async (req: Request, res: Response): Promise<void> => {
  const userId = userIdFor(req, res);
  if (!userId) return;
  const exams = await db
    .select()
    .from(examsTable)
    .where(eq(examsTable.userId, userId))
    .orderBy(examsTable.examDate);
  res.json(ListExamsResponse.parse(exams));
});

router.post(
  "/exams",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const parsed = CreateExamBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [exam] = await db
      .insert(examsTable)
      .values({
        title: parsed.data.title,
        subject: parsed.data.subject,
        examDate:
          parsed.data.examDate instanceof Date
            ? parsed.data.examDate.toISOString().slice(0, 10)
            : parsed.data.examDate,
        userId,
      })
      .returning();
    res.status(201).json(CreateExamResponse.parse(exam));
  },
);

router.delete(
  "/exams/:id",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const params = DeleteExamParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [exam] = await db
      .delete(examsTable)
      .where(
        and(eq(examsTable.id, params.data.id), eq(examsTable.userId, userId)),
      )
      .returning({ id: examsTable.id });
    if (!exam) {
      res.status(404).json({ error: "Exam not found." });
      return;
    }
    res.sendStatus(204);
  },
);

router.get(
  "/profile",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const [existing] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.userId, userId))
      .limit(1);
    const [profile] = existing
      ? [existing]
      : await db
          .insert(profilesTable)
          .values({
            userId,
            displayName:
              [req.user?.firstName, req.user?.lastName]
                .filter(Boolean)
                .join(" ") || "Student",
          })
          .returning();
    res.json(
      GetProfileResponse.parse({
        displayName: profile?.displayName ?? "Student",
        gradeLevel: profile?.gradeLevel ?? null,
      }),
    );
  },
);

router.patch(
  "/profile",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const parsed = UpdateProfileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [existing] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.userId, userId))
      .limit(1);
    const displayName =
      parsed.data.displayName?.trim() ||
      existing?.displayName ||
      [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ") ||
      "Student";
    const gradeLevel =
      parsed.data.gradeLevel === undefined
        ? existing?.gradeLevel ?? null
        : parsed.data.gradeLevel;
    const [profile] = await db
      .insert(profilesTable)
      .values({ userId, displayName, gradeLevel })
      .onConflictDoUpdate({
        target: profilesTable.userId,
        set: { displayName, gradeLevel, updatedAt: new Date() },
      })
      .returning();
    res.json(
      UpdateProfileResponse.parse({
        displayName: profile?.displayName ?? displayName,
        gradeLevel: profile?.gradeLevel ?? null,
      }),
    );
  },
);

export default router;
