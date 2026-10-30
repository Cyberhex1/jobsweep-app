<p align="center"><img src="build/icon.png" alt="JobSweep icon" width="128"></p>

# JobSweep

A personal, local-first Windows desktop app that automates job hunting: it finds matching jobs, tailors your resume
and cover letter for each one, and fills in applications. Free local AI does the writing. Everything stays on your PC.

- Concept: [docs/CONCEPT.md](docs/CONCEPT.md)
- Implementation plan and build status: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)
- First test session checklist: [docs/TESTING.md](docs/TESTING.md)

## Install on Windows

1. Download **JobSweep-Setup-0.0.1.exe** from the [latest release](https://github.com/Cyberhex1/jobsweep-app/releases/latest).
   For an unreleased build, open **Actions → Windows installer**, pick the latest green run, and download
   **JobSweep-Setup** under *Artifacts* (it arrives as a zip; the .exe is inside).
2. Run it. The installer isn't code-signed yet, so Windows SmartScreen says "Windows protected your PC". Click
   **More info → Run anyway**. No admin rights are needed; JobSweep installs for your Windows account only.
3. JobSweep opens with elevator music playing. Follow the **Getting started** steps in the Lobby.

Uninstall from **Settings → Apps**. Your data in `%APPDATA%\JobSweep` is kept, so reinstalling picks up where you left off.

## Run from source (for development)

1. Install **Node.js 22 LTS or newer** from https://nodejs.org (accept the defaults).
2. Install **Git** from https://git-scm.com, then in PowerShell:
   ```powershell
   git clone https://github.com/Cyberhex1/jobsweep-app.git
   cd jobsweep-app
   npm install
   npm run dev
   ```
   The first `npm run dev` downloads Electron (about 100 MB) if `npm install` didn't. Newer Electron versions no longer
   download during install, so this is expected. If it fails, run `npx install-electron` and try again.

`npm run build` then `npm start` runs the production build. `npm run dist` builds the installer into `dist\`.

Your data lives in `%APPDATA%\JobSweep` (database, documents, screenshots, error log, and a separate Edge profile used
for applying). Passwords, API keys and sensitive answers are encrypted with your Windows login. If something breaks,
**Maintenance → Backup & help → Open the error log folder** shows the log to send along.

## The floors

| Floor | What it does |
|---|---|
| **Lobby** | Today at a glance, setup checklist, best matches, inbox activity |
| **1 · Resume Studio** | Import Word/PDF, ATS check with one-click fixes, side-by-side original vs. ATS version, editor, Word/PDF/federal export, AI suggestions, cover letter template |
| **2 · Profile** | About you, locations (remote-only/on-site-only), pay, roles with suggestions, education, federal details, sensitive-data switches, answer bank, blocklist |
| **3 · Job Board** | One card per source with its top 5 matches and "see all", sorts (likely interview, best match, newest, highest pay), filters, job details with match reasons, missing keywords and scam warnings |
| **4 · Automation** | Apply for me (review or auto mode), review deck with screenshots and every filled answer, needs-you queue with inline answers, all applications, run history, site accounts |
| **5 · Site Learning** | Test-fill any application link with submit locked, see results per page, fix with plain-language feedback, approve |
| **6 · Analytics** | Funnel, response rate by resume version/source/platform/mode with sample sizes, daily activity, job emails |
| **M · Maintenance** | Local AI wizard (hardware scan, top 5 models, install and benchmark, freedom mode, setup prompt), Gemini/OpenRouter/API keys, email, Edge extension pairing, job sources, automation limits, sound, backup |

## Edge extension

Load the extension folder in Edge (`edge://extensions` → Developer mode → Load unpacked), then paste the pairing
code from **Maintenance → Edge extension**. **Show me the folder** on that page opens it (with the installer it lives in
the app's install folder; from source it's `extension/`). On LinkedIn, Indeed, Hiring Cafe, Glassdoor, ZipRecruiter and others, click
**Import to JobSweep**. JobSweep then looks for the same job on the company's own site and applies there.

## Development

```bash
npm test            # unit + engine tests (Chromium needed for engine tests)
npm run typecheck
npm run test:live   # pulls real jobs from public sources (bash; in PowerShell: $env:LIVE=1; npx vitest run tests/db.test.ts)
npm run dist        # Windows installer into dist/
```

Every push to `main` builds the installer on GitHub's Windows machines
(`.github/workflows/windows-installer.yml`).

Layout: `src/core` (pure logic, no Electron), `src/main` (Electron main: database, AI, sources, automation, email),
`src/renderer` (React UI), `extension/` (Edge extension), `catalog/` (skills, roles, local model catalog).
