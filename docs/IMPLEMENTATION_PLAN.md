# JobSweep — Implementation Plan

_Status: M0–M9 built (2026-10-11), including the Windows installer; awaiting the owner's first test session ([TESTING.md](TESTING.md)). Concept: [CONCEPT.md](CONCEPT.md)._

## Build status

| Milestone | Status | Verified here (Linux container) | Needs the owner's PC |
|---|---|---|---|
| M0 Foundation | Built | App launches; floors, doors, ding; settings persist | Music/audio output, window chrome on Windows |
| M1 AI layer + wizard | Built | Router, scrubbing, providers compile; recommender tests | Hardware scan, Ollama install/pull/benchmark, Gemini/OpenRouter sign-in |
| M2 Profile & Resume Studio | Built | Owner's PDF parses into 4 jobs; ATS check flags all known issues; DOCX/PDF export | Word-based PDF conversion |
| M3 Sources & Board | Built | Live pulls from NC State (Workday), governmentjobs.com, Remotive, RemoteOK, The Muse; dedupe/scoring | USAJOBS/Adzuna/JSearch keys |
| M4 Extension & resolver | Built | Extraction + paired import API tested | Real LinkedIn/Indeed pages in Edge |
| M5 Review mode | Built | Engine fills a multi-page fake employer site, stops before submit, review deck shows screenshots | Real Greenhouse/Lever/Ashby forms |
| M6 Accounts, Workday, Site Learning | Built | Account creation on fake site; Site Learning dry run | Real Workday tenants, email verification |
| M7 Auto mode & schedule | Built | Auto submit + confirmation detection on fake site; caps and risk tiers | Scheduled runs on Windows |
| M8 Email & analytics | Built | Classifier/linking tests | Gmail app password connection |
| M9 Polish & installer | Built | Floor crash panel + error log; floors load on demand (startup script 1.9 MB → 0.4 MB); keyboard focus, ARIA labels, reduce-motion setting; packaged app boots and every floor opens | Running the .exe installer, SmartScreen, shortcuts, uninstall |

### Deviations from the original plan (and why)
- **Single package instead of a pnpm monorepo.** Same separation (`src/core` has no Electron imports and is fully unit-tested), less build tooling.
- **Node's built-in `node:sqlite` instead of `better-sqlite3` + Drizzle.** No native module to compile on Windows, so `npm install` just works. Migrations are hand-written SQL.
- **Elevator music is generated live** (Web Audio bossa nova: electric piano, bass, vibraphone, brushes) instead of bundled tracks — copyright-free by construction.
- **Platform knowledge lives in one generic engine** (labels, ARIA, Workday `data-automation-id` hints) instead of one adapter file per platform; Site Learning recipes cover per-site fixes.


This plan covers architecture, data, the major subsystems, the build order (milestones with acceptance criteria),
testing, and the setup the owner needs to do. The `.exe` installer (electron-builder, NSIS, per-user) is built by
`npm run dist` or the *Windows installer* GitHub Actions workflow.

---

## 1. Architecture at a glance

```
┌──────────────────────────── Windows PC ─────────────────────────────┐
│                                                                     │
│  JobSweep desktop app (Electron)                                    │
│  ┌──────────────┐   IPC   ┌──────────────────────────────────────┐  │
│  │ UI (React)   │◀──────▶│ Backend services (Node, TypeScript)  │  │
│  │ elevator     │         │  • SQLite database + encrypted vault │  │
│  │ floors,music │         │  • Job source connectors             │  │
│  └──────────────┘         │  • Matching / dedupe / scam rules    │  │
│                           │  • AI router (Ollama/Gemini/…)       │  │
│                           │  • Automation engine (Playwright)────┼──┼──▶ Microsoft Edge
│                           │  • Email watcher (IMAP)              │  │    (dedicated profile)
│                           │  • Scheduler                         │  │
│                           │  • Local API 127.0.0.1 + pair token ◀┼──┼──  Edge extension
│                           └──────────────────────────────────────┘  │    ("Import to JobSweep")
│                                       │                             │
│                                       ▼                             │
│                           Ollama (local AI, localhost:11434)        │
└─────────────────────────────────────────────────────────────────────┘
        │ outbound only: job APIs, optional cloud AI, Gmail IMAP
```

### Technology choices (and why)

| Need | Choice | Why |
|---|---|---|
| Desktop shell | **Electron** + **electron-vite** | Web tech UI, Node backend, mature Windows support, easy installer later. |
| Language | **TypeScript** everywhere (app, automation, extension) | One language end to end; types catch mistakes early. |
| UI | **React**, **Tailwind CSS**, **Framer Motion** (floor transitions), **Radix UI** (accessible primitives), **Recharts** (analytics) | Fast to build a sleek, animated, accessible UI. |
| Browser automation | **Playwright** driving the **installed Microsoft Edge** (`channel: "msedge"`) with a dedicated persistent profile | Edge is already on every Windows PC (no 150 MB browser download); a persistent profile keeps logins; a real browser is far less likely to be blocked than server traffic. |
| Database | **SQLite** (`better-sqlite3`) + **Drizzle ORM** migrations, FTS5 full-text search | Single local file, fast, zero setup, easy backups. |
| Secrets | **Electron `safeStorage`** (Windows DPAPI under the hood) | Passwords, API keys and sensitive answers are encrypted with the user's Windows login. |
| Word documents | `docx` (generate), `mammoth` (read) | Pure JS, no Office dependency for creating/reading files. |
| PDF | Read with `pdfjs-dist`; **convert DOCX→PDF via Microsoft Word** (PowerShell COM script), LibreOffice headless fallback | Word gives pixel-perfect conversion; owner has Word. |
| Email | `imapflow` + `mailparser` with a Gmail **app password** | 2-minute setup, no Google Cloud project, no weekly re-login. OAuth path kept as fallback (see §11). |
| Local AI | **Ollama** HTTP API | Free, runs GGUF models, can pull Hugging Face models directly (`hf.co/{user}/{repo}`). |
| Scheduling | In-app scheduler (`croner`) + optional "start JobSweep at login" | Matches "only while the PC is on". |
| Hardware scan | `systeminformation` + `nvidia-smi` query + registry fallback for VRAM | Windows' generic GPU memory field caps at 4 GB, so it can't be trusted alone. |
| Extension | **Edge Manifest V3** extension | Owner uses Edge; MV3 is the current standard. |
| Tests | **Vitest** (logic), **Playwright Test** (adapters against saved fixture pages) | Most logic is testable in the cloud dev container; only Windows-specific parts need the owner's PC. |

### Repository layout (pnpm workspaces monorepo)

```
apps/
  desktop/            Electron main + preload + React renderer
  extension/          Edge MV3 extension
packages/
  core/               Pure logic: resume model, ATS linter, matching, dedupe, scam rules, truth guard
  db/                 Drizzle schema, migrations, repositories
  ai/                 Provider router, PII scrubber, prompts, structured-output schemas
  sources/            Job source connectors (USAJOBS, Workday, Greenhouse, …)
  automation/         Playwright engine, ATS adapters, generic form mapper, site recipes
  email/              IMAP watcher, classifier, verification-link handling
  docs-render/        DOCX generation (ATS, tailored, federal), PDF conversion
  hw/                 Hardware scan + model recommender (Windows-specific bits isolated here)
catalog/
  models.json         Curated local-model catalog (updatable without reinstalling)
  skills.json         Skills/keyword dictionary for matching
  companies.json      Seed list of companies → application platform (grows automatically)
assets/
  music/, sfx/        Public-domain/CC0 elevator tracks + ding
docs/
```

**Why a monorepo with pure `core`:** everything that doesn't touch Windows, Edge, or Word can be developed and unit
tested in the cloud container; the Windows-only parts are thin and isolated, which keeps PC testing sessions short.

**Personal data never goes in the repo.** All user data lives in `%APPDATA%\JobSweep\`. Test fixtures use a
synthetic resume; the owner's real resume is only used locally (a git-ignored `local/` folder).

---

## 2. Data model (SQLite)

| Table | Key fields | Notes |
|---|---|---|
| `profile` | name, location, contact (dedicated email), work-auth, current employer | Single row for now (multi-profile later). |
| `profile_locations` | place, radius, mode (`remote_only`/`onsite_only`/`hybrid_ok`/`any`) | |
| `profile_roles` | title, field, source (`user`/`suggested`/`resume`) | Role suggestions while typing. |
| `profile_pay` | min, target, unit (`hourly`/`salary`) | Normalized to annual for comparison. |
| `education`, `certifications` | | Also used by federal resume. |
| `resumes` | name, is_default | Logical resume. |
| `resume_versions` | resume_id, kind (`original`/`ats`/`tailored`/`federal`), parent_id, structured JSON, docx path, created_for_job_id | Every version kept; ties into analytics. |
| `cover_letter_templates` | body (user-written) | |
| `cover_letters` | template_id, job_id, body, diff JSON | Diff powers the "what changed" highlight. |
| `answer_bank` | canonical question, variants[], answer, sensitivity (`normal`/`sensitive`/`ssn_dob`), approved | Sensitive rows only exist if the setting allows. |
| `jobs` | source, external_id, url, apply_url, company, title, location, remote_type, pay_min/max/unit, description, posted_at, first_seen, fingerprint, match_score, scam_score, platform | `fingerprint` drives dedupe. |
| `job_sightings` | job_id, source, url, seen_at | Same job seen on multiple sources. |
| `job_sources` | key, enabled, rate budget, last_run, affinity score | Board card order comes from affinity. |
| `signals` | job_id/source, kind (`view`/`expand`/`save`/`dismiss`/`apply`/`response`), at | Learning input. |
| `blocklist` | company, aliases[], domains[], reason | Current employer auto-added. |
| `site_accounts` | platform, tenant/domain, username, password (encrypted), email, status | Unique password per site. |
| `site_recipes` | platform or domain, version, steps JSON, field mappings JSON, test results, approved | Output of Site Learning. |
| `applications` | job_id, resume_version_id, cover_letter_id, mode (`assist`/`review`/`auto`), status, submitted_at, failure_reason | |
| `application_snapshots` | application_id, page index, screenshot path, field values JSON | Proof of exactly what was sent. |
| `application_events` | application_id, kind (status change / email), at, details | Timeline. |
| `emails` | message_id, from, subject, received_at, classification, application_id | Only from the dedicated inbox. |
| `runs` | started_at, mode, counts, summary | "Apply for me" run summaries. |
| `ai_calls` | provider, model, task, tokens, ms, scrubbed (bool) | Debugging + cost visibility. |
| `settings` | key, value | Caps, thresholds, toggles, music volume, etc. |

---

## 3. Subsystems

### 3.1 Resume Studio
1. **Import:** DOCX via `mammoth` (keeps structure); PDF via `pdfjs-dist` text with positions.
2. **Structure:** rules-based section detection → structured JSON (contact, headline, summary, skills, experience[],
   education[], certifications[]). Local AI fills gaps using a strict JSON schema; output validated.
3. **ATS linter** (`packages/core`, deterministic). Each rule returns a finding + one-click fix:
   - invisible/zero-width and control characters; smart-quote/odd bullet glyphs
   - repeated punctuation (`, ,`), stray whitespace
   - headline merged into summary; non-standard section names
   - soft-skill padding ("Team Player", "Positive Attitude") in the skills list
   - near-duplicate bullets (similarity threshold)
   - missing LinkedIn URL / location / dates
   - tables, columns, text boxes, images, contact info in header/footer (DOCX inspection)
   - bullet length, weak verbs, missing metrics; implausible metrics flagged for the user to verify
4. **ATS version:** rendered from structured JSON with a single-column, standard-heading DOCX template. Shown side
   by side with the original; both editable; user picks the default.
5. **Tailoring with truth guard:** the AI returns *edit operations* (reorder bullets, rephrase bullet N, surface
   skill X in summary, choose which bullets to include) instead of free text. A verifier rejects any edit that
   introduces a number, employer, title, date, credential, or skill not present in the source resume/profile.
   The UI shows a diff.
6. **Federal resume:** extra profile fields (hours/week, salary, supervisor + may-contact, full addresses) collected
   once; long-form DOCX template.
7. **Resume creation:** guided wizard producing the same structured JSON.

### 3.2 Cover letters
- User writes a template. The AI may change only marked or minimal spans (company, role, 1–2 job-specific sentences
  that reuse true facts). Change budget enforced (e.g., ≤ 25% of words) + truth guard. Diff highlighting in UI.
- Generated only when the application form has a cover-letter field/upload.

### 3.3 Profile & answer bank
- Profile form with typeahead role suggestions (from `catalog/skills.json` role taxonomy + resume-derived titles).
- Answer bank seeded with ~40 common questions. Question matching: normalized text → synonym rules → local
  embeddings (`nomic-embed-text` via Ollama; TF-IDF fallback) → AI as last resort. New questions get an AI draft
  that the user approves once.
- Sensitive-data gate: when storage is off, sensitive questions always trigger a pause; SSN/DOB has its own switch.

### 3.4 AI router (`packages/ai`)
- Task types: `extract` (structured JSON), `classify`, `write`, `embed`, `vision` (screenshots).
- Each task declares a **sensitivity**; the router only sends it to providers allowed for that level.
  Free cloud tiers always get **PII-scrubbed** input (phone, address, email, and names replaced by placeholders and
  restored afterwards).
- Providers: **Ollama** (default), **Gemini** (API key; guided "Get my free key" flow that opens Google AI Studio and
  watches the clipboard for a pasted key), **OpenRouter** (OAuth PKCE sign-in using a localhost callback — no key
  pasting), **OpenAI / Anthropic / Gemini paid keys** (paste).
- Fallback chain with timeouts; every call logged in `ai_calls`.
- Prompts are versioned files with golden-output tests.

### 3.5 Local AI wizard (`packages/hw`)
1. Ask permission → scan CPU, RAM, GPU model, **VRAM** (nvidia-smi / registry), free disk, whether Ollama is installed.
2. Score each entry in `catalog/models.json` (fields: Ollama tag, parameter count, quantization, VRAM needed at 8k
   and 16k context, speed tier, quality tier, license, `uncensored` flag). Rank by "fits at ≥ 16k context" first,
   then quality, then speed → **top 5** with plain-English reasons.
3. **Freedom mode:** additionally queries the Hugging Face API for GGUF repos tagged uncensored/abliterated that fit
   in VRAM; clearly labeled.
4. Install: Ollama via `winget install Ollama.Ollama` (with consent) → `ollama pull` with progress → a short
   **benchmark task** (extract fields from a sample job post) → set as default.
5. **Copy-paste prompt:** generates a prompt containing the PC's specs and the top recommendations that the user
   can paste into any chatbot for step-by-step help.
6. The catalog file is fetched from this repo on launch so recommendations stay current without reinstalling.

### 3.6 Job sources (`packages/sources`)
Common interface: `search(query) → NormalizedJob[]`, with per-source rate budgets and caching so free limits are
never exceeded.

| Source | Access | Notes |
|---|---|---|
| **USAJOBS** | Official API, free key (email-registered) | Federal jobs. |
| **NC state government** | Workday career site (public JSON endpoint behind the careers page) | Fetched through the Edge session if direct requests are blocked. |
| **UNC-system schools** | Per-school career sites | Platforms verified per school during M3. |
| **County / city governments** (any county or city near you) | Per-agency (often NEOGOV/governmentjobs.com) | Platforms verified per agency during M3. |
| **Greenhouse / Lever / Ashby / SmartRecruiters** | Public job-board APIs per company | Seeded from `catalog/companies.json`; grows as imports reveal new companies. |
| **Workday (company sites)** | Public JSON endpoint per tenant | Same mechanism as NC state. |
| **Adzuna** | Free developer key | Broad aggregator; limits to confirm at signup. |
| **JSearch** | Free tier (small monthly quota) | Surfaces Google-for-Jobs listings; used sparingly. |
| **Remote feeds** (Remotive, RemoteOK, The Muse, …) | Public APIs/feeds | Availability verified at build time. |
| **Imported** (LinkedIn, Indeed, Hiring Cafe, Glassdoor, ZipRecruiter) | Edge extension | Discovery only. |

### 3.7 Matching, ranking & board learning (`packages/core`)
- **Match score (0–100)** = weighted: role/title similarity (embeddings), skills overlap (dictionary + JD
  extraction), location/remote fit (hard filter when strict), pay fit, education fit, recency.
- **"Likely to get an interview"** = match score adjusted by learned response rates (by source, platform, role
  family, resume version) once there's enough data; until then it equals match score. Small samples are shrunk
  toward the average so one lucky response doesn't dominate.
- **Board learning:** per-source affinity from `signals` with time decay (dismissals negative, applies/responses
  strongly positive). Card order = affinity; the 5 preview jobs = top matches for that source.
- **No profile/resume:** board shows generic recent jobs near the location, sorted by newest.

### 3.8 Dedupe, scam filter, blocklist
- **Dedupe:** fingerprint = normalized company + normalized title + location bucket; plus description similarity
  (MinHash) to catch reposts with slightly different titles. Merged jobs keep all sightings; the apply target
  prefers the company's own platform over aggregators.
- **Scam/ghost score:** rules (posting age and repost count, no company domain, free-mail recruiter, keywords like
  Telegram/WhatsApp/check deposit/equipment purchase/"no interview", pay far outside the role's range) + optional AI
  check. Badge on the card; auto mode skips anything above the threshold.
- **Blocklist:** company names, aliases, and domains; the profile's current employer is added automatically.

### 3.9 Edge extension (`apps/extension`)
- Adds an **Import to JobSweep** button on job detail pages of supported sites; also works as a toolbar button on
  any page.
- **Minimal footprint by design:** acts only when clicked, reads only the job currently on screen (title, company,
  location, description, "apply on company site" link if present), never scrolls, paginates, or fetches in the
  background. Reports suggest LinkedIn watches for extensions that automate actions; a click-only reader is the
  lowest-risk approach, though not zero-risk.
- Talks to the desktop app over `http://127.0.0.1:<port>` with a **pairing token** shown once in the app, so no
  other website or program can push data into JobSweep.
- Narrow host permissions (only the supported job sites) + `activeTab`.

### 3.10 Original-posting resolver
For imported jobs: (1) use the captured external apply link; (2) look up the company's platform in
`companies.json` and search that platform's API for the title; (3) discover the company's careers page from its
domain and detect the platform from links; (4) otherwise mark **assist mode on the original site**.

### 3.11 Automation engine (`packages/automation`)
Per application:
1. **Resolve & detect platform** (URL patterns + DOM fingerprints).
2. **Account:** log in with the vault credentials, or **sign up** with the profile + a generated unique password,
   then complete **email verification** via the email module (only links from expected domains are opened).
3. **Fill** using the platform adapter or approved site recipe; unknown fields go to the generic mapper
   (DOM/ARIA field extraction → synonym rules → embeddings → AI), each with a confidence score.
4. **Questions:** answer bank → AI draft → low confidence or sensitive → **pause**.
5. **Documents:** upload tailored DOCX (or PDF if required) and cover letter if allowed.
6. **Snapshot** every page (screenshot + field values).
7. **Review mode:** stop before submit and add a card to the review deck. On approval the engine **replays** the
   fill, verifies the values match the snapshot, then submits (no browser tabs held open for hours).
   **Auto mode:** submit, then confirm via the thank-you page and/or confirmation email.
8. **Human handoff:** CAPTCHA, 2FA, or a blocking question → Windows notification, Edge window brought to front,
   the user handles it and clicks Continue in JobSweep.

Guards: a **dry-run guard** that refuses to click anything submit-like in test/learning mode; one application at a
time per site; polite pacing between actions; daily cap, per-company cap, match threshold, and scam threshold are
enforced in the engine (not only the UI).

**Adapter order** (by value × ease): Greenhouse → Lever → Ashby → **Workday** (NC state + many large employers) →
iCIMS → SmartRecruiters → NEOGOV → Oracle/Taleo → SuccessFactors → generic. **USAJOBS** applications hand off to
agency systems and start as assist mode. **LinkedIn/Indeed** are always assist mode.

### 3.12 Site Learning
1. User gives a URL (+ optional screenshots).
2. App opens it in Edge, walks the application steps with the dry-run guard on, and records fields/steps per page.
   Screenshots are read by a vision-capable model (local if available, otherwise Gemini with scrubbing) to
   pre-seed expected fields.
3. Test fill → results page with screenshots and a per-field table (value used, confidence).
4. Approve → saved as a recipe (per platform when detected, otherwise per domain). Or the user describes what went
   wrong in plain language → converted to mapping overrides → re-test.

### 3.13 Email watcher (`packages/email`)
- IMAP connection to the **dedicated Gmail** with an app password; checks every few minutes while the app runs.
- Classifier (rules first: known platform senders and phrases; local AI for the rest): `verification`,
  `confirmation`, `rejection`, `interview`, `assessment`, `recruiter`, `other`.
- Links each email to an application (company, job title, platform IDs) and updates its status/timeline.
- Verification emails are passed to the account manager.

### 3.14 Analytics
- Funnel (found → applied → response → interview → offer) by resume version, source, platform, role family, mode.
- Response rate by resume version **with sample sizes and a "not enough data yet" state**.
- Time-to-response, activity over time, auto vs. reviewed outcomes.

### 3.15 Settings & risk tiers
- Mode: review (default) / auto.
- **Daily cap tiers:** 1–10 green · 11–25 yellow (quality notice) · 26–50 orange (account-flag warning) ·
  51+ red (double confirmation). Per-company cap (default 3/month). Minimum match score. Scam threshold.
- Sensitive storage on/off; SSN/DOB on/off.
- AI provider order, cloud scrubbing (always on for free tiers), schedule time, start at login, music volume.

### 3.16 Immersion (UI & audio)
- Dark glass design system (tokens, typography, motion rules) built in M0 so every floor feels consistent.
- Elevator floor transitions (Framer Motion) with floor indicator; *ding* on arrival.
- Background music via Web Audio with fades, remembered mute/volume, ducking during notifications.

---

## 4. Security & privacy
- All user data in `%APPDATA%\JobSweep\`; secrets encrypted via `safeStorage`.
- Local API bound to `127.0.0.1` only, pairing token required.
- Logs redact secrets and personal fields.
- Only links from expected senders/domains are opened from email.
- Encrypted backup/export and restore.
- No personal data or credentials ever committed to the repo.

---

## 5. Milestones

Each milestone ends with something usable and a short test session on the owner's PC.

| # | Milestone | Delivers | Acceptance criteria |
|---|---|---|---|
| **M0** | Foundation | Monorepo scaffold, Electron shell, design system, **elevator navigation + music**, SQLite + migrations, settings, encrypted vault, logging, backup/export | App starts on the owner's PC; floors animate with *ding*; music plays and mute persists across restarts. |
| **M1** | AI layer + Local AI wizard | Provider router, PII scrubber, Ollama/Gemini/OpenRouter/BYO keys, hardware scan, top-5 recommendations, freedom mode, install + benchmark, copy-paste prompt | Scan reports the owner's GPU/VRAM correctly; a recommended model installs and passes the benchmark; Gemini key flow takes < 1 minute. |
| **M2** | Profile & Resume Studio | Import, structure, ATS linter, side-by-side editor, ATS DOCX + PDF export, default choice, profile + role suggestions + prefill, answer bank, cover-letter template, federal resume, resume wizard | Owner's resume imports; linter flags the known issues (invisible characters, `, ,`, merged headline, soft-skill padding, duplicate bullets, missing LinkedIn, metric to verify); exported ATS DOCX opens cleanly in Word and converts to PDF. |
| **M3** | Job sources & Board | Connectors, normalization, dedupe, scam filter, blocklist, match scoring, board cards (5 + see more), sorts/filters, learning signals, generic mode | Board shows real jobs from ≥ 6 sources including USAJOBS and NC state; duplicates merged; blocklisted employer never appears; sorting works. |
| **M4** | Extension & resolver | Edge extension, pairing, import, original-posting resolver | Importing a LinkedIn job that links to a company site resolves to the company posting; Easy-Apply-only jobs are marked assist. |
| **M5** | Automation — review mode | Engine, Greenhouse/Lever/Ashby adapters, generic mapper, answer bank integration, tailoring + cover letters per application, snapshots, review deck, human handoff | Ten real applications filled correctly to the pre-submit point and shown in the deck; approving one submits it and records the snapshot. |
| **M6** | Accounts, Workday & Site Learning | Account manager (sign-up/login, unique passwords), IMAP verification, Workday adapter, Site Learning tab, more adapters | JobSweep creates a Workday account on a test employer, verifies it via email, and fills an application; a new site learned through the tab passes its test. |
| **M7** | Auto mode & scheduling | Auto submit, confirmation detection, scheduler, caps + risk tiers, run summaries | Scheduled run applies within caps, skips blocklisted/scam/low-match jobs, and produces an accurate summary of successes and failures. |
| **M8** | Email tracking & Analytics | Email classifier, status timeline, analytics floor | Rejections/interview emails update the right applications; response rate by resume version is shown with sample sizes. |
| **M9** | Polish | Performance, accessibility, onboarding flow, error states, final immersion pass | First-run experience matches the concept walkthrough end to end. Installer packaging follows when requested. |

**Why this order:** AI comes before the Resume Studio because tailoring, structuring, and suggestions depend on it,
and the hardware scan can be tested on the owner's PC right away. Review mode comes before auto mode so the
owner sees many correct fills before trusting unattended submission.

---

## 6. Testing strategy
- **Unit tests (cloud):** ATS linter, truth guard, dedupe, scam rules, matching, question matching, PII scrubber,
  recipe logic — run on every change.
- **Adapter tests:** saved snapshots of real application forms served locally; adapters must fill them correctly
  and the dry-run guard must block submission.
- **Prompt tests:** golden inputs/outputs for each AI task, run against the configured local model.
- **On the owner's PC:** a short smoke checklist per milestone (Windows-only pieces: Edge automation, Word PDF
  conversion, DPAPI vault, hardware scan, notifications).
- **Live dry runs:** real sites in learning/test mode never submit.

---

## 7. Owner setup checklist (all free)

| Item | When needed | Notes |
|---|---|---|
| Git, Node.js LTS, pnpm on the PC | M0 | Installed during the first PC session. |
| Ollama | M1 | The wizard can install it. |
| Google AI Studio (Gemini) API key | M1 | Guided in-app. |
| OpenRouter account | M1 (optional) | Sign-in flow in-app. |
| **Dedicated Gmail** for applications | M5–M6 | Then turn on **2-Step Verification** and create an **app password** for JobSweep. |
| USAJOBS API key | M3 | Request at developer.usajobs.gov (emailed). |
| Adzuna developer key | M3 | Self-serve signup. |
| JSearch (RapidAPI) free plan | M3 (optional) | Small quota. |
| LinkedIn URL for the resume | M2 | Flagged by the ATS check. |

---

## 8. Things to verify during the build
These were researched but rely partly on third-party sources or change often:
- Adzuna and JSearch free-tier limits and terms.
- Whether Gmail app passwords remain supported long-term (one vendor claims a phase-out; unconfirmed). If they go
  away, switch the email module to Google OAuth.
- Gemini free-tier models, limits, and data-use terms at setup time.
- Each local government's and UNC school's hiring platform.
- Workday's bot protection on direct JSON requests (fallback: fetch through the Edge session).
- Current status of remote-job feeds.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Account restrictions on LinkedIn/Indeed | Discovery + assist only; click-only extension; never automate actions there. |
| Site changes break adapters | Platform adapters + recipes with automatic re-test; failures surface in run summary and switch the job to review. |
| Bad or untrue AI output | Structured edits, truth guard, diffs, review mode default. |
| CAPTCHAs / 2FA | Never bypassed; human handoff with notification. |
| Free API limits | Rate budgets, caching, multiple sources. |
| Privacy leaks to cloud AI | Local-first, PII scrubbing, sensitivity routing. |
| Spammy behavior hurting the candidate | Daily/per-company caps, match threshold, duplicate guard, risk tiers. |

## 10. Next step
Owner reviews this plan. On approval, development starts at **M0** in the first session connected to the owner's PC.

## 11. Later (not in the first build)
- Installer (`.exe`) and auto-update.
- Shareable version for other people: Google OAuth for email, multi-profile, onboarding without developer tools.
- Interview prep from job descriptions; follow-up reminders.
