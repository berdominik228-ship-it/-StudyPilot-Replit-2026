import {
  GenerateFlashcardsBody,
  GenerateFlashcardsResponse,
  ListFlashcardsQueryParams,
  ListFlashcardsResponse,
  ReviewFlashcardBody,
  ReviewFlashcardParams,
  ReviewFlashcardResponse,
} from "@workspace/api-zod";
import { and, count, eq, lte } from "drizzle-orm";
import { db, flashcardsTable, materialsTable } from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";
import { generateStudyFlashcards, publicAiFailure } from "../lib/study-ai";
import { getStudyMaterialText } from "../lib/study-content";

const router: IRouter = Router();
const FREE_FLASHCARD_LIMIT = 50;

function userIdFor(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return req.user.id;
}

router.get(
  "/flashcards",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const parsed = ListFlashcardsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const conditions = [eq(flashcardsTable.userId, userId)];
    if (parsed.data.dueOnly) conditions.push(lte(flashcardsTable.dueAt, new Date()));
    const records = await db
      .select({
        card: flashcardsTable,
        materialTitle: materialsTable.title,
      })
      .from(flashcardsTable)
      .innerJoin(materialsTable, eq(flashcardsTable.materialId, materialsTable.id))
      .where(and(...conditions))
      .orderBy(flashcardsTable.dueAt);
    const cards = records.map(({ card, materialTitle }) => ({
      ...card,
      materialTitle,
    }));
    res.json(ListFlashcardsResponse.parse(cards));
  },
);

router.post(
  "/flashcards/generate",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const parsed = GenerateFlashcardsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [material] = await db
      .select()
      .from(materialsTable)
      .where(
        and(
          eq(materialsTable.id, parsed.data.materialId),
          eq(materialsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!material) {
      res.status(404).json({ error: "Material not found." });
      return;
    }
    const [usage] = await db
      .select({ value: count() })
      .from(flashcardsTable)
      .where(eq(flashcardsTable.userId, userId));
    if ((usage?.value ?? 0) + parsed.data.count > FREE_FLASHCARD_LIMIT) {
      res.status(403).json({
        error:
          "The Free plan includes up to 50 flashcards. Premium is shown as a preview and is not available for purchase yet.",
      });
      return;
    }
    try {
      const text = await getStudyMaterialText(material, userId);
      const generated = await generateStudyFlashcards({
        text,
        subject: material.subject,
        count: parsed.data.count,
      });
      if (generated.length < 1) {
        res.status(422).json({ error: "No flashcards could be created." });
        return;
      }
      const cards = await db
        .insert(flashcardsTable)
        .values(
          generated.map((card) => ({
            userId,
            materialId: material.id,
            question: card.question,
            answer: card.answer,
          })),
        )
        .returning();
      res.status(201).json(
        GenerateFlashcardsResponse.parse(
          cards.map((card) => ({ ...card, materialTitle: material.title })),
        ),
      );
    } catch (error) {
      const aiFailure = publicAiFailure(error);
      if (aiFailure) {
        res.status(aiFailure.status).json({ error: aiFailure.message });
        return;
      }
      req.log.warn(
        { errorName: error instanceof Error ? error.name : typeof error },
        "Unable to generate flashcards",
      );
      res.status(422).json({
        error:
          error instanceof Error
            ? error.message
            : "Flashcards could not be generated from this material.",
      });
    }
  },
);

router.patch(
  "/flashcards/:id/review",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const params = ReviewFlashcardParams.safeParse(req.params);
    const parsed = ReviewFlashcardBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [card] = await db
      .select({
        card: flashcardsTable,
        materialTitle: materialsTable.title,
      })
      .from(flashcardsTable)
      .innerJoin(materialsTable, eq(flashcardsTable.materialId, materialsTable.id))
      .where(
        and(
          eq(flashcardsTable.id, params.data.id),
          eq(flashcardsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!card) {
      res.status(404).json({ error: "Flashcard not found." });
      return;
    }
    const reviewCount = card.card.reviewCount + 1;
    const intervalDays = parsed.data.rating === "hard" ? 1 : Math.min(30, 3 * reviewCount);
    const [updated] = await db
      .update(flashcardsTable)
      .set({
        difficulty: parsed.data.rating,
        reviewCount,
        dueAt: new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000),
      })
      .where(eq(flashcardsTable.id, card.card.id))
      .returning();
    res.json(
      ReviewFlashcardResponse.parse({
        ...updated,
        materialTitle: card.materialTitle,
      }),
    );
  },
);

export default router;
