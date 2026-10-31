import { PDFParse } from "pdf-parse";
import { and, eq } from "drizzle-orm";
import { db, materialsTable, type StudyMaterial } from "@workspace/db";
import { ObjectPermission } from "./objectAcl";
import { ObjectStorageService } from "./objectStorage";
import { extractImageText } from "./study-ai";

const objectStorage = new ObjectStorageService();
const MAX_CONTEXT_LENGTH = 40_000;

export async function getStudyMaterialText(
  material: StudyMaterial,
  userId: string,
): Promise<string> {
  const savedText = [material.contentText, material.notes]
    .filter((part): part is string => Boolean(part?.trim()))
    .join("\n\n")
    .trim();
  if (savedText) return savedText.slice(0, MAX_CONTEXT_LENGTH);

  if (!material.objectPath) {
    throw new Error(
      "Add study text or upload a PDF or image before generating learning materials.",
    );
  }

  const file = await objectStorage.getObjectEntityFile(material.objectPath);
  const canRead = await objectStorage.canAccessObjectEntity({
    userId,
    objectFile: file,
    requestedPermission: ObjectPermission.READ,
  });
  if (!canRead) throw new Error("This uploaded file is not available to you.");

  const [buffer] = await file.download();
  const contentType = material.contentType?.split(";")[0]?.trim().toLowerCase();

  if (contentType === "application/pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const text = result.text.trim().slice(0, MAX_CONTEXT_LENGTH);
      if (!text) {
        throw new Error(
          "No selectable text was found in this PDF. Paste the key notes into the material to continue.",
        );
      }
      return cacheExtractedText(material, userId, text);
    } finally {
      await parser.destroy();
    }
  }

  if (contentType?.startsWith("text/")) {
    const text = buffer.toString("utf8").trim().slice(0, MAX_CONTEXT_LENGTH);
    if (text) return cacheExtractedText(material, userId, text);
  }

  if (contentType?.startsWith("image/")) {
    const dataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;
    const text = (await extractImageText(dataUrl)).trim();
    if (text) return cacheExtractedText(material, userId, text.slice(0, MAX_CONTEXT_LENGTH));
  }

  throw new Error(
    "This file does not contain readable study text. Add notes or use a PDF, text file, or clear photo.",
  );
}

async function cacheExtractedText(
  material: StudyMaterial,
  userId: string,
  text: string,
): Promise<string> {
  await db
    .update(materialsTable)
    .set({ contentText: text })
    .where(
      and(
        eq(materialsTable.id, material.id),
        eq(materialsTable.userId, userId),
      ),
    );
  return text;
}
