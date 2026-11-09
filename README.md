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
- Manually approved email submission plus opt-in rule-based automatic email applications with approved templates and document versions; attachment selection, saved recipient/message/document IDs, and duplicate-send protection. Uncertain sends remain blocked pending manual verification in Gmail. Submitted document versions cannot be deleted while retained in an application’s history.
- Telegram private-chat pairing and alerts.
- Database-backed scheduled work with atomic task claiming, leases, deduplication keys, retries, and visible failures.

Upload a PDF or DOCX CV from My Profile or Documents, or choose Upload certificate in Documents, to extract its text locally and review suggested summary, skills, experience, education, languages, and labeled contact details. Select the fields to update and save them to your profile; existing values are unchecked by default. You can also choose “Extract to profile” on an existing CV. Extraction uses common section headings without AI credentials. When AI is connected, it selects supported passages for the reviewed fields. AI-assisted extraction reads the first 24,000 characters; the complete extracted text remains visible for review. Standalone certificates are imported as education/qualifications, with combined existing values shown for review before saving. Scanned PDFs need OCR before upload, and password-protected or unreadable files show an error while keeping the original upload. Check the extracted facts before saving, especially for CVs with columns. Your job preferences and account details are preserved. The assistant retrieves saved profile/source/application context for each response. Chat text itself is session-local. Source and profile memory persists in PostgreSQL.

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

Use your own Ollama server without a paid API key:

```env
AI_PROVIDER=ollama
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_MODEL=your-installed-model
AI_API_KEY=
```

Set AI_BASE_URL to your server's reachable address if it runs on another machine. If your proxy requires authentication, set AI_API_KEY. Use a locally installed model that can follow JSON instructions. Compatible hosted providers still work with AI_PROVIDER=compatible and an API key. Restart the API and worker after configuration changes.

The AI plans suitable roles from reviewed profile facts, including skills, experience, education and imported certificates, then assesses jobs actually retrieved from public sources. Scores describe suitability, not hiring probability; location and work authorization still require checking. Candidate facts go to your configured AI server, never to the public feed providers. Drafts and document imports require review. AI extraction only accepts passages that exist in the uploaded document; it cannot verify certificate authenticity.

### Free job discovery

No search subscription or paid AI API is required for board/feed discovery with your own Ollama server. Import your CV and approve its facts first. Discovery plans suitable roles before retrieving jobs, then uses those roles to search supported boards. Leave the focus blank to use the reviewed profile, or enter a role to narrow the search. Search now starts immediately in the API process; jobs are saved after location checks and assessment. Closing the browser does not cancel a search. A worker can recover an abandoned search after its lease expires. Automatic discovery runs at your selected 6, 12, or 24 hour interval once your profile contains candidate facts.

Set **My profile → Current location** accurately. With **Preferred countries = Worldwide**, discovery gives the current country priority, then nearby East African countries for candidates in that region, while including international opportunities. Specific country names (for example `Kenya, Uganda, Tanzania`) or `East Africa` limit new discovery to those places. Unknown locations are not assumed to satisfy a country restriction. A remote role restricted to a different country is excluded when your current country is known; remote-only mode requires positive evidence that a job is remote. Location is not proof of citizenship, work authorization, or regional work eligibility. Previously saved opportunities remain in the workspace.

The source directory includes JobWeb Kenya, MyJobMag Kenya, JobWeb Uganda, and JobWeb Tanzania alongside Arbeitnow and Remotive. Supported boards receive profile-derived role searches; saved generic sites are read as supplied. The reader follows same-site job links to structured job detail pages, enriches RSS summaries, and follows one next-page link per seed. Each source has a budget of 16 detail pages and three concurrent detail requests. Saved sources are included without the previous silent ten-source limit; explicitly pausing a built-in homepage in My job sources also prevents automatic inclusion of that homepage. Public international feeds are cached for six hours. Provider blocking, unreadable pages, and empty extraction are reported separately from successful retrieval. Coverage is bounded by the checked pages and source availability; it is not the whole internet or a guarantee that a country has no jobs.

For broader web discovery, configure `BRAVE_SEARCH_API_KEY` in the backend. This enables role-and-country searches from the profile even with no manual focus, including local, East African, and international queries. Search snippets are treated as leads: only linked pages with readable job records become opportunities. Without a key, board/feed discovery remains available and its limited coverage is shown explicitly.

The backend shortlists up to 18 relevant listings with country priority before AI assessment. AI-assessed results below 40/100 are not saved; uncertain requirements never become verified eligibility. If AI is unavailable, keyword matching remains available with no AI score. Discover Jobs orders local/regional matches before international matches and then by AI suitability. Each run exposes its roles, search area, per-source retrieved and shortlisted counts, and failures. Scheduled saved-source checks share the discovery role and country filters. Review original listings for current availability, full requirements, and eligibility before applying.

## Worker schedule

- Check enabled saved sources at their chosen interval.
- Sync connected Gmail every 15 minutes.
- Run profile-based discovery at the selected 6/12/24-hour interval once candidate facts exist. Pausing automatic search also pauses scheduled saved-source checks; manual searches and source checks remain available.
- Check application instructions for assessed matches, prepare strong portal matches, and process eligible automatic email applications under saved rules.
- Create reminders for saved/preparing/ready applications due within two days.
- Poll Telegram pairing and deliver pending alerts every cycle.

Monitoring and application preparation require the worker process to remain running. The UI reports its heartbeat; Search now works even when the worker is offline. For local development use `npm run dev:all`. For a worker that restarts automatically with Docker, after setting up backend/.env:

```sh
docker compose --profile automation up -d --build
```

The optional worker service shares PostgreSQL and private document storage with the host API, applies migrations on startup, and restarts unless stopped. Its AI_BASE_URL must be reachable from inside the container; 127.0.0.1 there refers to the container. The machine hosting the worker still needs to stay on. Do not run a second Telegram polling worker for the same bot.

Monitoring requires live internet access to the configured sources. Unsupported pages, logins, CAPTCHAs, and JavaScript-only listings need a custom adapter or manual entry. No universal crawler or automatic portal login is included. Automatic email sending is off by default. Enable it only in Settings & connections after selecting allowed job-title phrases, exact recipient domains, a minimum match score (default 85), a rolling 24-hour send limit (default 3), immutable approved document versions including a CV, and a complete approved subject/body template. Supported template fields are `{{title}}`, `{{company}}`, `{{name}}`, `{{skills}}` and `{{summary}}`. Saving enabled rules authorizes future matching emails without an individual Send click. The worker personalizes this approved text and attaches the chosen versions; it does not silently send freshly generated, unreviewed document drafts.

The application address must be explicitly shown in application instructions on the original advert. The job must match approved title phrases and domains, have a future deadline verified from structured data or an ISO date label, a current profile assessment with no gaps/unknowns, recorded work eligibility, and all required approved attachments. A high score alone is insufficient. The worker checks the full advert with AI again and rereads the instructions before claiming a send. Complex instructions, changed profiles, missing facts, unavailable AI, and quota limits go to Needs review. Quotas and send claims are atomic. Unconfirmed sends remain blocked; verify them in Gmail rather than retrying automatically.

Strong portal matches can receive CV and cover-letter drafts when portal preparation is enabled. Review those drafts, use the original portal, then choose “I completed the portal application.” A portal job is never marked applied merely because documents were prepared.

## Development and verification

```sh
npm run typecheck
npm run build
npm test
```

Tests use the **jobnest_test** database created by the portable launcher. For Docker, create a separate jobnest_test database first. Override with TEST_DATABASE_URL if needed; the database name must end in _test. The test runner applies migrations and deletes test records, never the main database. Tests cover auth, account isolation, persistent source memory, partial updates, document exports/versioning, private-network blocking, task retries, and duplicate/uncertain email sends. Gmail sends are mocked in tests; they do not contact employers.

For schema changes use `npm run db:dev -w backend`, then commit the migration. Generated Prisma client files, secrets, uploaded files, database files, caches, and build outputs are ignored.

## Deployment notes

For IIS reverse proxies, missing peer IPs, or rate-limit forwarded-header errors, see [IIS deployment and rate limits](docs/iis-deployment.md). Document extraction is limited per authenticated account; login limits support an explicit `TRUSTED_PROXY_ADDRESSES` setting and safely handle missing socket IPs.

Deploy the Next.js frontend, the Express API, and one continuously running worker. Set BACKEND_URL for the Next.js API proxy. Use HTTPS, NODE_ENV=production, FRONTEND_URL matching the deployed browser origin, managed PostgreSQL, backed-up persistent private storage, and production OAuth redirect settings. SESSION cookies become secure in production. The Express development server binds to 127.0.0.1; set HOST=0.0.0.0 when a container/service needs an external interface. Preserve owner restrictions and the encryption key. Deployment has not been performed.

## Follow-up work

OCR for scanned CVs; richer site-specific readers; full-text email matching; document layout templates; configurable digests and quiet hours; password recovery; and richer application-instruction adapters can be added after the initial release is reviewed.
