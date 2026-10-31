import OpenAI from "openai";

export type QuestionType = "multiple-choice" | "true-false" | "open-ended";

export interface GeneratedQuestion {
  id: string;
  prompt: string;
  type: QuestionType;
  choices: string[];
  topic: string;
  correctAnswer: string;
  explanation: string;
  userAnswer: string | null;
  isCorrect: boolean | null;
}

export class AiConfigurationError extends Error {
  constructor() {
    super("AI is not configured. Add OPENAI_API_KEY in Replit Secrets.");
    this.name = "AiConfigurationError";
  }
}

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AiConfigurationError();
  return new OpenAI({ apiKey });
}

async function requestJson<T>(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 3000,
): Promise<T> {
  const completion = await getOpenAI().chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    max_completion_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("The AI returned an empty response.");
  return JSON.parse(content) as T;
}

export async function extractImageText(
  imageDataUrl: string,
): Promise<string> {
  const completion = await getOpenAI().chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    max_completion_tokens: 3000,
    messages: [
      {
        role: "system",
        content:
          "Transcribe legible study content from this image faithfully. Preserve headings, equations, lists, and key wording. If the image is not study material, describe its relevant educational content briefly. Do not invent text.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract the readable learning material." },
          {
            type: "image_url",
            image_url: { url: imageDataUrl, detail: "high" },
          },
        ],
      },
    ],
  });
  return completion.choices[0]?.message.content?.trim() ?? "";
}

export async function analyzeStudyText(text: string): Promise<{
  summary: string;
  keyTopics: string[];
  studySuggestion: string;
}> {
  const result = await requestJson<{
    summary?: string;
    keyTopics?: string[];
    studySuggestion?: string;
  }>(
    "You are a careful study coach for students aged 14–19. Use only the supplied material. Keep language clear, encouraging, and age-appropriate. Return a JSON object with summary, keyTopics (array), and studySuggestion.",
    `Analyze this study material:\n\n${text.slice(0, 24000)}`,
    1600,
  );
  return {
    summary: String(result.summary ?? "").slice(0, 3000),
    keyTopics: Array.isArray(result.keyTopics)
      ? result.keyTopics.map(String).slice(0, 12)
      : [],
    studySuggestion: String(result.studySuggestion ?? "").slice(0, 1000),
  };
}

export async function generateStudyQuiz(input: {
  text: string;
  subject: string;
  difficulty: "easy" | "medium" | "hard";
  questionCount: number;
  questionTypes: QuestionType[];
}): Promise<{ title: string; questions: GeneratedQuestion[] }> {
  const result = await requestJson<{
    title?: string;
    questions?: Array<{
      prompt?: string;
      type?: string;
      choices?: string[];
      topic?: string;
      correctAnswer?: string;
      explanation?: string;
    }>;
  }>(
    "You create accurate school revision quizzes for students aged 14–19. Base every question and answer only on the provided study material. Do not introduce facts not supported by it. Return JSON with title and questions. Each question must have prompt, type (multiple-choice, true-false, or open-ended), choices (multiple-choice gets four concise options; true-false gets [True, False]; open-ended gets []), topic, correctAnswer, and a short explanation. Avoid trick questions. For open-ended answers, provide a concise model answer.",
    JSON.stringify({
      subject: input.subject,
      difficulty: input.difficulty,
      questionCount: input.questionCount,
      questionTypes: input.questionTypes,
      material: input.text.slice(0, 24000),
    }),
    5000,
  );
  if (!Array.isArray(result.questions) || result.questions.length === 0) {
    throw new Error("The AI could not create questions from this material.");
  }
  const questions = result.questions.slice(0, input.questionCount).map((item, index) => {
    const type: QuestionType = input.questionTypes.includes(
      item.type as QuestionType,
    )
      ? (item.type as QuestionType)
      : input.questionTypes[index % input.questionTypes.length]!;
    const choices =
      type === "true-false"
        ? ["True", "False"]
        : type === "multiple-choice" && Array.isArray(item.choices)
          ? item.choices.map(String).slice(0, 4)
          : [];
    if (type === "multiple-choice" && choices.length < 2) {
      throw new Error("The AI returned an invalid multiple-choice question.");
    }
    const correctAnswer = String(item.correctAnswer ?? "").trim();
    if (!correctAnswer) {
      throw new Error("The AI returned a question without a correct answer.");
    }
    return {
      id: `q-${index + 1}`,
      prompt: String(item.prompt ?? "").trim(),
      type,
      choices,
      topic: String(item.topic ?? input.subject).slice(0, 120),
      correctAnswer,
      explanation: String(item.explanation ?? "").slice(0, 1200),
      userAnswer: null,
      isCorrect: null,
    };
  });
  if (questions.some((question) => !question.prompt)) {
    throw new Error("The AI returned an incomplete question.");
  }
  return {
    title: String(result.title ?? `${input.subject} practice`).slice(0, 180),
    questions,
  };
}

export async function evaluateOpenAnswer(input: {
  prompt: string;
  expectedAnswer: string;
  studentAnswer: string;
}): Promise<{ isCorrect: boolean; explanation: string }> {
  const result = await requestJson<{
    isCorrect?: boolean;
    explanation?: string;
  }>(
    "You grade a student's short answer against a concise model answer. Give credit for correct meaning even when wording differs. Be fair, supportive, and age-appropriate. Return JSON with isCorrect (boolean) and a brief explanation that teaches the key idea.",
    JSON.stringify(input),
    900,
  );
  return {
    isCorrect: result.isCorrect === true,
    explanation: String(result.explanation ?? "Review the model answer and try again.").slice(
      0,
      1200,
    ),
  };
}

export async function generateStudyFlashcards(input: {
  text: string;
  subject: string;
  count: number;
}): Promise<Array<{ question: string; answer: string }>> {
  const result = await requestJson<{
    cards?: Array<{ question?: string; answer?: string }>;
  }>(
    "Create concise, accurate revision flashcards for students aged 14–19 using only the supplied material. Each question should test one key fact or idea. Return JSON with cards, each containing question and answer.",
    JSON.stringify({
      subject: input.subject,
      count: input.count,
      material: input.text.slice(0, 24000),
    }),
    4000,
  );
  if (!Array.isArray(result.cards)) {
    throw new Error("The AI could not create flashcards from this material.");
  }
  return result.cards
    .slice(0, input.count)
    .map((card) => ({
      question: String(card.question ?? "").trim().slice(0, 1000),
      answer: String(card.answer ?? "").trim().slice(0, 2000),
    }))
    .filter((card) => card.question && card.answer);
}
