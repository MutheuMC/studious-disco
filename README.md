# JobNest

A personal job application tracker and assistant, implemented in TypeScript with **two application folders**:

- **frontend/** — Next.js App Router, React, responsive interface.
- **backend/** — Express API, Prisma/PostgreSQL, private document storage, integrations, and a database-backed background worker.

## Run locally

Requires Node.js 22.12+ (Node 24 recommended) and npm.

From the repository root:

```sh
npm install
npm run setup
```

Start a database in a separate terminal, using **one** option:

```sh
# Option A: portable development PostgreSQL, stored in .local/postgres
npm run db:local

# Option B: Docker PostgreSQL 16
# Docker Desktop must be running. Do not run both options on port 5433.
docker compose up -d postgres
```

Then apply the tracked migration and launch the application:

```sh
npm run db:migrate
npm run dev:all
```

Open **http://127.0.0.1:3000**. Use this hostname consistently; the API origin check expects it. Create your personal account. The first registration claims this instance; further registration is closed. Passwords require 12 characters. Alternatively configure Google sign-in before creating the account.

`npm run dev` runs only the frontend and API; `npm run worker` runs the background worker separately. Stop each foreground process with Ctrl+C. The portable database is for local development, uses documented development credentials, and binds to loopback. Use a managed PostgreSQL database or your own secured server for deployment.

Set **OWNER_EMAIL** in backend/.env before exposing the instance to restrict the first registration. There is no password reset email flow yet; use Google sign-in with the same verified email if configured.

## Implemented

- Personal registration, password login, Google login, hashed persistent sessions, logout, protected records, and origin checks.
- Dashboard, application list/board, filters, application details, notes, status history, deadlines, and portal handoff reminders.
- Persistent profile facts and preferences.
- Saved job websites with notes, frequency, pause/resume, check status, and assistant memory. “Remember https://example.com/jobs” saves a source even without AI credentials.
- RSS/Atom and JSON-LD JobPosting extraction, URL normalization, duplicate detection, expired-listing filtering, and network-address restrictions.
- Private PDF/DOCX uploads (8 MB maximum), editable text documents, immutable edit versions, PDF/DOCX export, and application links.
- AI match analysis and tailored CV, cover-letter, and email drafts when a provider is configured.
- Gmail authorization, encrypted provider credentials, resumable synchronization, conservative application matching, original-message links, and reviewed status suggestions.
- Explicitly approved email submission with attachment selection, saved recipient/message/document IDs, and duplicate-send protection. Uncertain sends remain blocked pending manual verification in Gmail. Submitted document versions cannot be deleted while retained in an application’s history.
- Telegram private-chat pairing and alerts.
- Database-backed scheduled work with atomic task claiming, leases, deduplication keys, retries, and visible failures.

Uploaded CVs are stored as files; automatic extraction of their contents is not implemented. Enter verified experience and skills in My Profile for AI drafting. The assistant retrieves saved profile/source/application context for each response. Chat text itself is session-local. Source and profile memory persists in PostgreSQL.

## Integrations

Configure secrets in **backend/.env**, then restart the API and worker. The settings screen reports connection/setup status; secrets are never returned to the frontend. No provider credentials are included in this repository.

### Google sign-up, login, and Gmail

The account screen includes **Sign in** and **Create account** modes, with **Sign in with Google** and **Sign up with Google** buttons. They become enabled once Google client credentials and the token encryption key are configured. Missing configuration is shown clearly.

Follow [Google authentication setup](docs/google-auth.md) to create a Web OAuth client, register **http://127.0.0.1:3000/api/google/callback**, and set backend/.env values. No Google credentials are committed.

The first Google signup creates the personal account without requiring a password. Returning Google login finds the same owner by Google subject ID. A verified Gmail or Workspace address can link to an existing email account; an already linked identity cannot be replaced by a different Google account. The personal instance still accepts only one owner.

Google signup/login requests only identity scopes. Gmail reading and sending require separate consent through Settings; enable the Gmail API for that optional connection. Google verification/testing restrictions apply to the requested scopes. Keep TOKEN_ENCRYPTION_KEY stable and backed up.

Sync imports up to 500 job-related messages per run, continuing through additional pages on subsequent runs. Initial import looks back 90 days. Relevant message headers and snippets are stored; this is not a full mailbox viewer. Ambiguous matches require your review. Keyword matching can miss unusual employer messages; they can still be reviewed directly in Gmail.

### Telegram

Create a bot through BotFather. Set TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME (without @). In Settings choose Pair Telegram, then press Start in the bot chat. The link expires after 10 minutes. Keep the worker running. Polling must be owned by this application; do not configure a webhook or another getUpdates consumer for the same bot.

### AI

Set AI_API_KEY, AI_BASE_URL (an OpenAI-compatible API base ending in /v1), and AI_MODEL. Requests use the chat-completions interface. Choose a model available through your provider. Profile facts and the selected job description are sent for document preparation; contextual chat includes saved profile/source/application information. Outputs require review and may contain marked questions for missing facts.

### Web search

Set BRAVE_SEARCH_API_KEY. Use Discover Jobs for manual searches. The worker runs a daily search using your preferred roles, countries, and remote preference when roles are set. Search results are leads, not verified job postings: check the original source and use Analyze Match before applying.

## Worker schedule

- Check enabled saved sources at their chosen interval.
- Sync connected Gmail every 15 minutes.
- Run a daily broad search when configured and preferred roles exist.
- Create reminders for saved/preparing/ready applications due within two days.
- Poll Telegram pairing and deliver pending alerts every cycle.

Monitoring requires the worker process to remain running. Unsupported pages, logins, CAPTCHAs, and JavaScript-only listings need a custom adapter or manual entry. No universal crawler or automatic portal login is included. Automated email applications without review are not enabled.

## Development and verification

```sh
npm run typecheck
npm run build
npm test
```

Tests use the **jobnest_test** database created by the portable launcher. For Docker, create a separate jobnest_test database first. Override with TEST_DATABASE_URL if needed; the database name must end in _test. The test runner applies migrations and deletes test records, never the main database. Tests cover auth, account isolation, persistent source memory, partial updates, document exports/versioning, private-network blocking, task retries, and duplicate/uncertain email sends. Gmail sends are mocked in tests; they do not contact employers.

For schema changes use `npm run db:dev -w backend`, then commit the migration. Generated Prisma client files, secrets, uploaded files, database files, caches, and build outputs are ignored.

## Deployment notes

Deploy the Next.js frontend, the Express API, and one continuously running worker. Set BACKEND_URL for the Next.js API proxy. Use HTTPS, NODE_ENV=production, FRONTEND_URL matching the deployed browser origin, managed PostgreSQL, backed-up persistent private storage, and production OAuth redirect settings. SESSION cookies become secure in production. The Express development server binds to 127.0.0.1; set HOST=0.0.0.0 when a container/service needs an external interface. Preserve owner restrictions and the encryption key. Deployment has not been performed.

## Follow-up work

Automatic CV text extraction; richer site-specific readers; full-text email matching; document layout templates; configurable digests and quiet hours; password recovery; and optional rule-based auto-application can be added after the initial release is reviewed.
