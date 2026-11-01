import {
  CreateTutorConversationBody,
  CreateTutorConversationResponse,
  GetTutorConversationParams,
  GetTutorConversationResponse,
  ListTutorConversationsResponse,
  SendTutorMessageBody,
  SendTutorMessageParams,
  SendTutorMessageResponse,
} from "@workspace/api-zod";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  db,
  materialsTable,
  tutorConversationsTable,
  tutorMessagesTable,
} from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  createTutorReply,
  publicAiFailure,
  type TutorLanguage,
  type TutorLevel,
} from "../lib/study-ai";
import { getStudyMaterialText } from "../lib/study-content";

const router: IRouter = Router();

function getUserId(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return req.user.id;
}

async function readConversation(id: number, userId: string) {
  const [conversation] = await db
    .select()
    .from(tutorConversationsTable)
    .where(
      and(
        eq(tutorConversationsTable.id, id),
        eq(tutorConversationsTable.userId, userId),
      ),
    )
    .limit(1);
  if (!conversation) return null;
  const messages = await db
    .select()
    .from(tutorMessagesTable)
    .where(eq(tutorMessagesTable.conversationId, id))
    .orderBy(asc(tutorMessagesTable.id));
  return { ...conversation, messages };
}

async function getMaterialContext(
  materialId: number | null | undefined,
  userId: string,
  res: Response,
): Promise<string | null> {
  if (materialId == null) return null;
  const [material] = await db
    .select()
    .from(materialsTable)
    .where(
      and(
        eq(materialsTable.id, materialId),
        eq(materialsTable.userId, userId),
      ),
    )
    .limit(1);
  if (!material) {
    res.status(404).json({ error: "Study material not found." });
    return null;
  }
  try {
    return await getStudyMaterialText(material, userId);
  } catch (error) {
    const aiFailure = publicAiFailure(error);
    if (aiFailure) {
      res.status(aiFailure.status).json({ error: aiFailure.message });
      return null;
    }
    res.status(422).json({
      error:
        error instanceof Error
          ? error.message
          : "The selected study material could not be read.",
    });
    return null;
  }
}

function safelyReportTutorError(req: Request, res: Response, error: unknown) {
  const aiFailure = publicAiFailure(error);
  if (aiFailure) {
    res.status(aiFailure.status).json({ error: aiFailure.message });
    return;
  }
  const metadata =
    error instanceof Error
      ? { errorName: error.name }
      : { errorName: typeof error };
  req.log.warn(metadata, "Tutor request failed");
  res.status(502).json({
    error: "The tutor could not respond right now. Please try again.",
  });
}

router.get(
  "/tutor/conversations",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req, res);
    if (!userId) return;
    const conversations = await db
      .select()
      .from(tutorConversationsTable)
      .where(eq(tutorConversationsTable.userId, userId))
      .orderBy(desc(tutorConversationsTable.updatedAt))
      .limit(50);
    res.json(ListTutorConversationsResponse.parse(conversations));
  },
);

router.post(
  "/tutor/conversations",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req, res);
    if (!userId) return;
    const parsed = CreateTutorConversationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const firstMessage = parsed.data.message.trim();
    if (!firstMessage) {
      res.status(400).json({ error: "Write a question to start the conversation." });
      return;
    }
    const materialContext = await getMaterialContext(
      parsed.data.materialId,
      userId,
      res,
    );
    if (res.headersSent) return;

    let reply: string;
    try {
      reply = await createTutorReply({
        messages: [{ role: "user", content: firstMessage }],
        language: parsed.data.language as TutorLanguage,
        level: parsed.data.level as TutorLevel,
        materialContext: materialContext ?? undefined,
      });
    } catch (error) {
      safelyReportTutorError(req, res, error);
      return;
    }

    const created = await db.transaction(async (tx) => {
      const [conversation] = await tx
        .insert(tutorConversationsTable)
        .values({
          userId,
          title: firstMessage.slice(0, 160),
          language: parsed.data.language as TutorLanguage,
          level: parsed.data.level as TutorLevel,
          materialId: parsed.data.materialId ?? null,
        })
        .returning();
      if (!conversation) throw new Error("Conversation could not be saved.");
      await tx.insert(tutorMessagesTable).values([
        {
          conversationId: conversation.id,
          role: "user",
          content: firstMessage,
        },
        {
          conversationId: conversation.id,
          role: "assistant",
          content: reply,
        },
      ]);
      return conversation;
    });
    const conversation = await readConversation(created.id, userId);
    res
      .status(201)
      .json(CreateTutorConversationResponse.parse(conversation));
  },
);

router.get(
  "/tutor/conversations/:id",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req, res);
    if (!userId) return;
    const params = GetTutorConversationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const conversation = await readConversation(params.data.id, userId);
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    res.json(GetTutorConversationResponse.parse(conversation));
  },
);

router.post(
  "/tutor/conversations/:id/messages",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req, res);
    if (!userId) return;
    const params = SendTutorMessageParams.safeParse(req.params);
    const parsed = SendTutorMessageBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [conversation] = await db
      .select()
      .from(tutorConversationsTable)
      .where(
        and(
          eq(tutorConversationsTable.id, params.data.id),
          eq(tutorConversationsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    const message = parsed.data.message.trim();
    if (!message) {
      res.status(400).json({ error: "Write a message before sending." });
      return;
    }
    const materialId =
      parsed.data.materialId === undefined
        ? conversation.materialId
        : parsed.data.materialId;
    const materialContext = await getMaterialContext(materialId, userId, res);
    if (res.headersSent) return;

    const history = await db
      .select()
      .from(tutorMessagesTable)
      .where(eq(tutorMessagesTable.conversationId, conversation.id))
      .orderBy(desc(tutorMessagesTable.id))
      .limit(16);
    let reply: string;
    try {
      reply = await createTutorReply({
        messages: [
          ...history.reverse().map((item) => ({
            role: item.role,
            content: item.content,
          })),
          { role: "user", content: message },
        ],
        language:
          (parsed.data.language as TutorLanguage | undefined) ??
          conversation.language,
        level:
          (parsed.data.level as TutorLevel | undefined) ?? conversation.level,
        materialContext: materialContext ?? undefined,
      });
    } catch (error) {
      safelyReportTutorError(req, res, error);
      return;
    }

    await db.transaction(async (tx) => {
      await tx.insert(tutorMessagesTable).values([
        {
          conversationId: conversation.id,
          role: "user",
          content: message,
        },
        {
          conversationId: conversation.id,
          role: "assistant",
          content: reply,
        },
      ]);
      await tx
        .update(tutorConversationsTable)
        .set({
          language:
            (parsed.data.language as TutorLanguage | undefined) ??
            conversation.language,
          level:
            (parsed.data.level as TutorLevel | undefined) ?? conversation.level,
          materialId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tutorConversationsTable.id, conversation.id),
            eq(tutorConversationsTable.userId, userId),
          ),
        );
    });

    const updated = await readConversation(conversation.id, userId);
    res.json(SendTutorMessageResponse.parse(updated));
  },
);

export default router;
