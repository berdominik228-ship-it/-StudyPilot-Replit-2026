import {
  AnswerQuizQuestionBody,
  AnswerQuizQuestionParams,
  AnswerQuizQuestionResponse,
  FinishQuizParams,
  FinishQuizResponse,
  GenerateQuizBody,
  GenerateQuizResponse,
  GetQuizParams,
  GetQuizResponse,
  ListQuizzesResponse,
} from "@workspace/api-zod";
import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import {
  db,
  materialsTable,
  quizzesTable,
  type StoredQuizQuestion,
} from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  evaluateOpenAnswer,
  generateStudyQuiz,
  publicAiFailure,
} from "../lib/study-ai";
import { getStudyMaterialText } from "../lib/study-content";

const router: IRouter = Router();
const FREE_MONTHLY_TEST_LIMIT = 5;

function userIdFor(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return req.user.id;
}

function publicQuiz(quiz: typeof quizzesTable.$inferSelect) {
  return {
    ...quiz,
    recommendations: quiz.completedAt
      ? recommendationsFor(quiz.scorePercentage, quiz.questions)
      : [],
    questions: quiz.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      type: question.type,
      choices: question.choices,
      topic: question.topic,
      userAnswer: question.userAnswer,
      isCorrect: question.isCorrect,
      explanation: question.userAnswer ? question.explanation : null,
    })),
  };
}

function normalizeAnswer(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[.,!?;:'"()[\]{}]/g, "")
    .replace(/\s+/g, " ");
}

function recommendationsFor(
  score: number | null,
  questions: StoredQuizQuestion[],
): string[] {
  const weakTopics = [
    ...new Set(
      questions
        .filter((question) => question.isCorrect === false)
        .map((question) => question.topic),
    ),
  ];
  if (weakTopics.length) {
    return weakTopics.slice(0, 3).map(
      (topic) =>
        `Review ${topic} in your study materials, then try a short practice round.`,
    );
  }
  if ((score ?? 0) >= 90) {
    return [
      "Try a harder round or explain one key idea without looking at your notes.",
    ];
  }
  if ((score ?? 0) >= 70) {
    return [
      "Review your answers and revisit one key idea from the source material.",
    ];
  }
  return [
    "Review the key ideas in your study materials before trying another round.",
  ];
}

router.get("/quizzes", async (req: Request, res: Response): Promise<void> => {
  const userId = userIdFor(req, res);
  if (!userId) return;
  const quizzes = await db
    .select()
    .from(quizzesTable)
    .where(eq(quizzesTable.userId, userId))
    .orderBy(desc(quizzesTable.createdAt))
    .limit(30);
  res.json(ListQuizzesResponse.parse(quizzes));
});

router.post(
  "/quizzes/generate",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const parsed = GenerateQuizBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const currentMonth = new Date();
    currentMonth.setUTCDate(1);
    currentMonth.setUTCHours(0, 0, 0, 0);
    const [usage] = await db
      .select({ value: count() })
      .from(quizzesTable)
      .where(
        and(
          eq(quizzesTable.userId, userId),
          gte(quizzesTable.createdAt, currentMonth),
        ),
      );
    if ((usage?.value ?? 0) >= FREE_MONTHLY_TEST_LIMIT) {
      res.status(403).json({
        error:
          "You have reached the Free plan's monthly test limit. Premium is shown as a preview and is not available for purchase yet.",
      });
      return;
    }

    const materials = await db
      .select()
      .from(materialsTable)
      .where(
        and(
          eq(materialsTable.userId, userId),
          inArray(materialsTable.id, parsed.data.materialIds),
        ),
      );
    if (materials.length !== new Set(parsed.data.materialIds).size) {
      res.status(404).json({ error: "One or more materials were not found." });
      return;
    }

    try {
      const materialContents = await Promise.all(
        materials.map(async (material) => ({
          material,
          text: await getStudyMaterialText(material, userId),
        })),
      );
      const subject = [...new Set(materials.map((item) => item.subject))].join(
        " · ",
      );
      const generated = await generateStudyQuiz({
        text: materialContents
          .map(({ material, text }) => `# ${material.title}\n${text}`)
          .join("\n\n")
          .slice(0, 40_000),
        subject,
        topic: parsed.data.topic,
        difficulty: parsed.data.difficulty,
        questionCount: parsed.data.questionCount,
        questionTypes: parsed.data.questionTypes,
      });
      const [quiz] = await db
        .insert(quizzesTable)
        .values({
          userId,
          title: generated.title,
          subject: subject.slice(0, 80),
          difficulty: parsed.data.difficulty,
          questionCount: generated.questions.length,
          questions: generated.questions,
        })
        .returning();
      if (!quiz) {
        res.status(500).json({ error: "The quiz could not be saved." });
        return;
      }
      res.status(201).json(GenerateQuizResponse.parse(publicQuiz(quiz)));
    } catch (error) {
      const aiFailure = publicAiFailure(error);
      if (aiFailure) {
        res.status(aiFailure.status).json({ error: aiFailure.message });
        return;
      }
      req.log.warn(
        { errorName: error instanceof Error ? error.name : typeof error },
        "Unable to generate study quiz",
      );
      res.status(422).json({
        error:
          error instanceof Error
            ? error.message
            : "The quiz could not be generated from these materials.",
      });
    }
  },
);

router.get(
  "/quizzes/:id",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const params = GetQuizParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [quiz] = await db
      .select()
      .from(quizzesTable)
      .where(
        and(
          eq(quizzesTable.id, params.data.id),
          eq(quizzesTable.userId, userId),
        ),
      )
      .limit(1);
    if (!quiz) {
      res.status(404).json({ error: "Quiz not found" });
      return;
    }
    res.json(GetQuizResponse.parse(publicQuiz(quiz)));
  },
);

router.post(
  "/quizzes/:id/answers",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const params = AnswerQuizQuestionParams.safeParse(req.params);
    const parsed = AnswerQuizQuestionBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [quiz] = await db
      .select()
      .from(quizzesTable)
      .where(
        and(
          eq(quizzesTable.id, params.data.id),
          eq(quizzesTable.userId, userId),
        ),
      )
      .limit(1);
    if (!quiz || quiz.completedAt) {
      res.status(404).json({ error: "Active quiz not found." });
      return;
    }
    const questionIndex = quiz.questions.findIndex(
      (question) => question.id === parsed.data.questionId,
    );
    if (questionIndex < 0) {
      res.status(404).json({ error: "Question not found." });
      return;
    }
    const question = quiz.questions[questionIndex]!;
    if (question.userAnswer !== null) {
      res.status(409).json({ error: "This question has already been answered." });
      return;
    }

    let isCorrect =
      normalizeAnswer(parsed.data.answer) ===
      normalizeAnswer(question.correctAnswer);
    let explanation = question.explanation;
    if (
      question.type === "open-ended" ||
      question.type === "short-answer" ||
      question.type === "math"
    ) {
      try {
        const evaluation = await evaluateOpenAnswer({
          prompt: question.prompt,
          expectedAnswer: question.correctAnswer,
          studentAnswer: parsed.data.answer,
          questionType: question.type,
        });
        isCorrect = evaluation.isCorrect;
        explanation = evaluation.explanation;
      } catch (error) {
        const aiFailure = publicAiFailure(error);
        if (aiFailure) {
          res.status(aiFailure.status).json({ error: aiFailure.message });
          return;
        }
        req.log.warn(
          { errorName: error instanceof Error ? error.name : typeof error },
          "Unable to evaluate open answer",
        );
        res.status(502).json({ error: "The answer could not be checked. Try again." });
        return;
      }
    }

    const updatedQuestions: StoredQuizQuestion[] = quiz.questions.map(
      (item, index) =>
        index === questionIndex
          ? {
              ...item,
              userAnswer: parsed.data.answer,
              isCorrect,
              explanation,
            }
          : item,
    );
    const answeredCount = updatedQuestions.filter(
      (item) => item.userAnswer !== null,
    ).length;
    await db
      .update(quizzesTable)
      .set({
        questions: updatedQuestions,
        correctCount: updatedQuestions.filter((item) => item.isCorrect).length,
      })
      .where(eq(quizzesTable.id, quiz.id));

    res.json(
      AnswerQuizQuestionResponse.parse({
        questionId: question.id,
        isCorrect,
        correctAnswer: question.correctAnswer,
        explanation,
        answeredCount,
        questionCount: quiz.questionCount,
      }),
    );
  },
);

router.post(
  "/quizzes/:id/finish",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const params = FinishQuizParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [quiz] = await db
      .select()
      .from(quizzesTable)
      .where(
        and(
          eq(quizzesTable.id, params.data.id),
          eq(quizzesTable.userId, userId),
        ),
      )
      .limit(1);
    if (!quiz) {
      res.status(404).json({ error: "Quiz not found" });
      return;
    }
    const correctCount = quiz.questions.filter(
      (question) => question.isCorrect === true,
    ).length;
    const scorePercentage = Math.round(
      (correctCount / Math.max(quiz.questionCount, 1)) * 100,
    );
    const completedAt = quiz.completedAt ?? new Date();
    const [updated] = await db
      .update(quizzesTable)
      .set({
        scorePercentage,
        correctCount,
        completedAt,
      })
      .where(eq(quizzesTable.id, quiz.id))
      .returning();
    const weakTopics = [
      ...new Set(
        quiz.questions
          .filter((question) => question.isCorrect === false)
          .map((question) => question.topic),
      ),
    ];
    const recommendations = recommendationsFor(scorePercentage, quiz.questions);
    res.json(
      FinishQuizResponse.parse({
        id: quiz.id,
        scorePercentage: updated?.scorePercentage ?? scorePercentage,
        correctCount,
        questionCount: quiz.questionCount,
        weakTopics,
        recommendations,
        completedAt: updated?.completedAt ?? completedAt,
      }),
    );
  },
);

export default router;
