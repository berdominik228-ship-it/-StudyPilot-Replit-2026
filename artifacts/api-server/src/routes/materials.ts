import {
  AnalyzeMaterialParams,
  AnalyzeMaterialResponse,
  CreateMaterialBody,
  CreateMaterialResponse,
  DeleteMaterialParams,
  GetMaterialParams,
  GetMaterialResponse,
  ListMaterialsResponse,
  UpdateMaterialBody,
  UpdateMaterialParams,
  UpdateMaterialResponse,
} from "@workspace/api-zod";
import { and, count, desc, eq, gt } from "drizzle-orm";
import { db, materialsTable, uploadIntentsTable } from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";
import { ObjectStorageService } from "../lib/objectStorage";
import { analyzeStudyText, AiConfigurationError } from "../lib/study-ai";
import { getStudyMaterialText } from "../lib/study-content";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const FREE_MATERIAL_LIMIT = 5;

function userIdFor(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return req.user.id;
}

router.get("/materials", async (req: Request, res: Response): Promise<void> => {
  const userId = userIdFor(req, res);
  if (!userId) return;
  const materials = await db
    .select()
    .from(materialsTable)
    .where(eq(materialsTable.userId, userId))
    .orderBy(desc(materialsTable.updatedAt));
  res.json(ListMaterialsResponse.parse(materials));
});

router.post(
  "/materials",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const parsed = CreateMaterialBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const input = parsed.data;
    if (
      !input.objectPath &&
      !input.contentText?.trim() &&
      !input.notes?.trim()
    ) {
      res.status(400).json({
        error: "Add text or upload a file before saving this material.",
      });
      return;
    }

    const [materialCount] = await db
      .select({ value: count() })
      .from(materialsTable)
      .where(eq(materialsTable.userId, userId));
    if ((materialCount?.value ?? 0) >= FREE_MATERIAL_LIMIT) {
      res.status(403).json({
        error:
          "The Free plan includes up to 5 materials. Premium is shown as a preview and is not available for purchase yet.",
      });
      return;
    }

    if (input.objectPath) {
      const [intent] = await db
        .select()
        .from(uploadIntentsTable)
        .where(
          and(
            eq(uploadIntentsTable.objectPath, input.objectPath),
            eq(uploadIntentsTable.userId, userId),
            gt(uploadIntentsTable.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!intent) {
        res.status(403).json({ error: "This upload is not available to you." });
        return;
      }
      try {
        await objectStorage.trySetObjectEntityAclPolicy(input.objectPath, {
          owner: userId,
          visibility: "private",
        });
        await db
          .delete(uploadIntentsTable)
          .where(eq(uploadIntentsTable.objectPath, input.objectPath));
      } catch (error) {
        req.log.warn({ err: error }, "Uploaded object was not ready to save");
        res.status(400).json({
          error: "The file upload did not finish. Please try uploading again.",
        });
        return;
      }
    }

    const [material] = await db
      .insert(materialsTable)
      .values({
        userId,
        title: input.title.trim(),
        subject: input.subject.trim(),
        fileName: input.fileName ?? null,
        contentType: input.contentType ?? null,
        objectPath: input.objectPath ?? null,
        contentText: input.contentText?.trim() || null,
        notes: input.notes?.trim() || null,
      })
      .returning();

    res.status(201).json(CreateMaterialResponse.parse(material));
  },
);

router.get(
  "/materials/:id",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const params = GetMaterialParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [material] = await db
      .select()
      .from(materialsTable)
      .where(
        and(
          eq(materialsTable.id, params.data.id),
          eq(materialsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!material) {
      res.status(404).json({ error: "Material not found" });
      return;
    }
    res.json(GetMaterialResponse.parse(material));
  },
);

router.patch(
  "/materials/:id",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const params = UpdateMaterialParams.safeParse(req.params);
    const parsed = UpdateMaterialBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [material] = await db
      .update(materialsTable)
      .set({
        ...parsed.data,
        ...(parsed.data.title !== undefined
          ? { title: parsed.data.title.trim() }
          : {}),
        ...(parsed.data.subject !== undefined
          ? { subject: parsed.data.subject.trim() }
          : {}),
        ...(parsed.data.contentText !== undefined
          ? { contentText: parsed.data.contentText?.trim() || null }
          : {}),
        ...(parsed.data.notes !== undefined
          ? { notes: parsed.data.notes?.trim() || null }
          : {}),
        ...(parsed.data.contentText !== undefined ||
        parsed.data.notes !== undefined
          ? { summary: null, keyTopics: [] }
          : {}),
      })
      .where(
        and(
          eq(materialsTable.id, params.data.id),
          eq(materialsTable.userId, userId),
        ),
      )
      .returning();
    if (!material) {
      res.status(404).json({ error: "Material not found" });
      return;
    }
    res.json(UpdateMaterialResponse.parse(material));
  },
);

router.delete(
  "/materials/:id",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const params = DeleteMaterialParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [material] = await db
      .delete(materialsTable)
      .where(
        and(
          eq(materialsTable.id, params.data.id),
          eq(materialsTable.userId, userId),
        ),
      )
      .returning({ id: materialsTable.id });
    if (!material) {
      res.status(404).json({ error: "Material not found" });
      return;
    }
    res.sendStatus(204);
  },
);

router.post(
  "/materials/:id/analyze",
  async (req: Request, res: Response): Promise<void> => {
    const userId = userIdFor(req, res);
    if (!userId) return;
    const params = AnalyzeMaterialParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [material] = await db
      .select()
      .from(materialsTable)
      .where(
        and(
          eq(materialsTable.id, params.data.id),
          eq(materialsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!material) {
      res.status(404).json({ error: "Material not found" });
      return;
    }
    try {
      const text = await getStudyMaterialText(material, userId);
      const analysis = await analyzeStudyText(text);
      const [updated] = await db
        .update(materialsTable)
        .set({
          contentText: material.contentText ?? text,
          summary: analysis.summary,
          keyTopics: analysis.keyTopics,
        })
        .where(eq(materialsTable.id, material.id))
        .returning();
      res.json(
        AnalyzeMaterialResponse.parse({
          summary: updated?.summary ?? analysis.summary,
          keyTopics: updated?.keyTopics ?? analysis.keyTopics,
          studySuggestion: analysis.studySuggestion,
        }),
      );
    } catch (error) {
      if (error instanceof AiConfigurationError) {
        res.status(503).json({ error: error.message });
        return;
      }
      req.log.warn({ err: error }, "Unable to analyze study material");
      res.status(422).json({
        error:
          error instanceof Error
            ? error.message
            : "This material could not be analyzed.",
      });
    }
  },
);

export default router;
