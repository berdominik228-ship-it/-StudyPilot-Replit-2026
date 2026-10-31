# StudyPilot

StudyPilot helps students aged 14–19 turn their own class notes and materials into AI-supported practice, flashcards, and progress insights.

## Run & Operate

- `pnpm --filter @workspace/studypilot run dev` — run the StudyPilot web app
- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/studypilot run typecheck` — typecheck the web app
- `pnpm --filter @workspace/api-server run typecheck` — typecheck the API
- `pnpm run typecheck` — typecheck the workspace
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/db run push` — push development database schema changes

Replit-managed environment values provide PostgreSQL, OpenID authentication, and private App Storage. AI features require `OPENAI_API_KEY` in Replit Secrets. Never expose it to frontend code or logs.

## Stack

- pnpm workspaces, Node.js 24, TypeScript
- Web: React, Vite, TanStack Query
- API: Express
- Data: PostgreSQL and Drizzle ORM
- Authentication: Replit Auth
- File storage: private Replit App Storage
- AI: OpenAI SDK using the user's own API key; no Replit AI Integration
- API contract and generated client: Orval from the OpenAPI spec

## Where things live

- `artifacts/studypilot/` — StudyPilot web app
- `artifacts/api-server/` — authenticated API routes, OpenAI requests, and private file access
- `lib/api-spec/openapi.yaml` — source API contract
- `lib/api-client-react/` and `lib/api-zod/` — generated API client, hooks, and validation schemas
- `lib/db/src/schema/` — PostgreSQL table definitions

## Architecture decisions

- The AI key is read only by the API server. Study text and OCR images are sent to OpenAI only when the user invokes an AI study feature.
- Uploaded study files are private. Upload URLs are bound to an authenticated user's short-lived upload intent, then the stored object is assigned to that user.
- Each data endpoint scopes reads and writes to the authenticated user.
- Text PDFs and plain-text files are parsed locally. Uploaded images use OpenAI vision for OCR. Scanned PDFs without selectable text currently need notes pasted into the material.
- Free plan limits are enforced server-side. The €4.99/month Premium pricing is informational only; checkout and charges are disabled.

## Product

Authenticated students can save class materials, analyze them for explanations and key topics, generate quizzes and flashcards, review answers, record upcoming exams, and track scores and weak topics. The public site includes product and pricing information.

## User preferences

- Do not require a Replit plan upgrade for AI. Use the user's own OpenAI API key instead.
- Do not activate real payments unless the user asks.
- Explain any paid external service before implementing it.

## Gotchas

- Keep API routes under `/api`; the web app is a separate artifact.
- Regenerate API hooks and schemas after changing the OpenAPI file.
- OpenAI API use is billed by OpenAI. App Storage may also consume the workspace's storage budget.
- The API requires the configured OpenAI key for explanations, quiz and flashcard generation, open-ended answer evaluation, and image OCR.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
