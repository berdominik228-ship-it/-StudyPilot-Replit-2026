import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetTutorConversationQueryKey,
  getListTutorConversationsQueryKey,
  useCreateTutorConversation,
  useGetTutorConversation,
  useListMaterials,
  useListTutorConversations,
  useSendTutorMessage,
} from "@workspace/api-client-react";
import {
  ArrowRight,
  BookOpen,
  LoaderCircle,
  MessageCircle,
  Plus,
  Send,
  Sparkles,
} from "lucide-react";
import { Link, useParams, useLocation } from "wouter";
import "./Tutor.css";

const promptSuggestions = [
  "Can you explain this topic step by step?",
  "Help me solve a maths problem",
  "Make a few practice questions",
];

function tutorApiError(error: unknown): string {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = error.data;
    if (
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof data.error === "string"
    ) {
      return data.error;
    }
  }
  return "The tutor could not respond. Check your connection and try again.";
}

export default function Tutor() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const conversationId = Number(id) || 0;
  const queryClient = useQueryClient();
  const conversations = useListTutorConversations();
  const materials = useListMaterials();
  const conversation = useGetTutorConversation(conversationId, {
    query: {
      queryKey: getGetTutorConversationQueryKey(conversationId),
      enabled: Boolean(conversationId),
    },
  });
  const createConversation = useCreateTutorConversation();
  const sendMessage = useSendTutorMessage();
  const [message, setMessage] = useState("");
  const [language, setLanguage] = useState<"en" | "et" | "ru">("en");
  const [level, setLevel] = useState<
    "beginner" | "intermediate" | "advanced"
  >("intermediate");
  const [materialId, setMaterialId] = useState("");
  const [error, setError] = useState("");
  const endOfMessages = useRef<HTMLDivElement>(null);
  const isSending = createConversation.isPending || sendMessage.isPending;
  const activeConversation = conversation.data;

  useEffect(() => {
    if (!activeConversation) return;
    setLanguage(activeConversation.language);
    setLevel(activeConversation.level);
    setMaterialId(activeConversation.materialId?.toString() ?? "");
  }, [activeConversation?.id]);

  useEffect(() => {
    endOfMessages.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversation?.messages.length, isSending]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || isSending) return;
    setError("");

    try {
      if (conversationId && activeConversation) {
        await sendMessage.mutateAsync({
          id: conversationId,
          data: {
            message: trimmed,
            language,
            level,
            materialId: materialId ? Number(materialId) : null,
          },
        });
        await queryClient.invalidateQueries({
          queryKey: getGetTutorConversationQueryKey(conversationId),
        });
        await queryClient.invalidateQueries({
          queryKey: getListTutorConversationsQueryKey(),
        });
      } else {
        const created = await createConversation.mutateAsync({
          data: {
            message: trimmed,
            language,
            level,
            ...(materialId ? { materialId: Number(materialId) } : {}),
          },
        });
        await queryClient.invalidateQueries({
          queryKey: getListTutorConversationsQueryKey(),
        });
        setLocation(`/tutor/${created.id}`);
      }
      setMessage("");
    } catch (error) {
      setError(tutorApiError(error));
    }
  }

  function startNewConversation() {
    setError("");
    setMessage("");
    setLanguage("en");
    setLevel("intermediate");
    setMaterialId("");
    setLocation("/tutor");
  }

  const selectedMaterial = (materials.data ?? []).find(
    (item) => item.id.toString() === materialId,
  );

  return (
    <div className="tutor-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">A PATIENT STUDY PARTNER</span>
          <h1>AI tutor</h1>
          <p>Ask a question, work through the steps, and keep learning.</p>
        </div>
        <button
          type="button"
          className="button button-outline"
          onClick={startNewConversation}
        >
          <Plus size={16} /> New conversation
        </button>
      </header>

      <div className="tutor-layout">
        <aside className="tutor-history panel" aria-label="Tutor conversation history">
          <div className="tutor-history-heading">
            <span className="eyebrow">YOUR CONVERSATIONS</span>
            <MessageCircle size={16} aria-hidden="true" />
          </div>
          {conversations.isLoading ? (
            <p className="tutor-muted">Loading conversations…</p>
          ) : conversations.isError ? (
            <p className="tutor-muted" role="status">
              Conversation history is unavailable right now.
            </p>
          ) : conversations.data?.length ? (
            <nav className="tutor-conversation-list">
              {conversations.data.map((item) => (
                <Link
                  key={item.id}
                  href={`/tutor/${item.id}`}
                  className={`tutor-conversation-link ${
                    item.id === conversationId ? "is-active" : ""
                  }`}
                >
                  <span>{item.title}</span>
                  <small>
                    {item.language.toUpperCase()} ·{" "}
                    {new Date(item.updatedAt).toLocaleDateString()}
                  </small>
                </Link>
              ))}
            </nav>
          ) : (
            <p className="tutor-muted">
              Your saved conversations will appear here.
            </p>
          )}
        </aside>

        <section className="tutor-chat panel" aria-label="AI tutor chat">
          <div className="tutor-controls">
            <label className="tutor-select">
              <span>Reply language</span>
              <select
                value={language}
                onChange={(event) =>
                  setLanguage(event.target.value as "en" | "et" | "ru")
                }
              >
                <option value="en">English</option>
                <option value="et">Eesti</option>
                <option value="ru">Русский</option>
              </select>
            </label>
            <label className="tutor-select">
              <span>Explanation level</span>
              <select
                value={level}
                onChange={(event) =>
                  setLevel(
                    event.target.value as
                      | "beginner"
                      | "intermediate"
                      | "advanced",
                  )
                }
              >
                <option value="beginner">Start with the basics</option>
                <option value="intermediate">School level</option>
                <option value="advanced">Go deeper</option>
              </select>
            </label>
            <label className="tutor-select tutor-material-select">
              <span>Study material</span>
              <select
                value={materialId}
                onChange={(event) => setMaterialId(event.target.value)}
                disabled={materials.isLoading}
              >
                <option value="">No material attached</option>
                {(materials.data ?? []).map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.title} · {item.subject}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="tutor-message-area" aria-live="polite">
            {conversationId && conversation.isLoading ? (
              <div className="tutor-empty-state">
                <LoaderCircle className="tutor-spinner" size={22} />
                <span>Opening your conversation…</span>
              </div>
            ) : conversationId && (conversation.isError || !activeConversation) ? (
              <div className="tutor-empty-state">
                <MessageCircle size={25} />
                <b>We couldn’t open this conversation.</b>
                <button type="button" className="small-link" onClick={startNewConversation}>
                  Start a new conversation <ArrowRight size={14} />
                </button>
              </div>
            ) : activeConversation?.messages.length ? (
              <div className="tutor-messages">
                {activeConversation.messages.map((item) => (
                  <article
                    key={item.id}
                    className={`tutor-message tutor-message-${item.role}`}
                  >
                    {item.role === "assistant" && (
                      <span className="tutor-message-mark" aria-hidden="true">
                        <Sparkles size={14} />
                      </span>
                    )}
                    <div className="tutor-message-content">
                      <span className="tutor-message-role">
                        {item.role === "assistant" ? "StudyPilot" : "You"}
                      </span>
                      <p>{item.content}</p>
                    </div>
                  </article>
                ))}
                {isSending && (
                  <div className="tutor-thinking" role="status">
                    <LoaderCircle className="tutor-spinner" size={16} />
                    Working through it…
                  </div>
                )}
                <div ref={endOfMessages} />
              </div>
            ) : (
              <div className="tutor-empty-state">
                <span className="tutor-empty-icon">
                  <BookOpen size={23} />
                </span>
                <span className="eyebrow">LET’S WORK IT OUT</span>
                <h2>What are you learning today?</h2>
                <p>
                  Ask for a step-by-step explanation, a maths walkthrough, or
                  practice questions. You can attach one of your saved materials.
                </p>
                <div className="tutor-suggestions">
                  {promptSuggestions.map((prompt) => (
                    <button
                      type="button"
                      key={prompt}
                      onClick={() => setMessage(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <form className="tutor-composer" onSubmit={submit}>
            {selectedMaterial && (
              <div className="tutor-attached-material">
                <BookOpen size={13} />
                Using {selectedMaterial.title}
              </div>
            )}
            <label className="sr-only" htmlFor="tutor-message">
              Your question
            </label>
            <textarea
              id="tutor-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ask your tutor a question…"
              rows={3}
              maxLength={4000}
              disabled={isSending}
            />
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <div className="tutor-composer-footer">
              <p>
                Messages and attached study text are sent to OpenAI for
                processing. Don’t include personal details.
              </p>
              <button
                type="submit"
                className="button button-primary"
                disabled={!message.trim() || isSending}
              >
                {isSending ? (
                  <>
                    <LoaderCircle className="tutor-spinner" size={15} /> Thinking
                  </>
                ) : (
                  <>
                    Send <Send size={15} />
                  </>
                )}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
