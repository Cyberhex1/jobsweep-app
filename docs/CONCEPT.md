# JobSweep — Concept

_Status: locked (concept phase complete, 2026-10-11). Next: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)._

## Goal

A personal, local-first **Windows desktop app** that automates job hunting: it finds jobs that fit the user,
tailors their resume and cover letters to each one, and fills in (and, when allowed, submits) applications —
while giving the user the best chance of landing interviews in their field.

- **Audience:** the owner only for the first build. Later it may be shared as a downloadable app (no accounts / hosting).
- **Cost target:** $0. Pay only if absolutely unavoidable.
- **Runs only while the PC is on.** No cloud servers.

## Why a desktop app (not a website)

1. Applying needs a real browser on the user's machine; job sites block automated traffic from cloud servers.
2. Personal data (addresses, work history, demographic answers) never leaves the PC.
3. Free local AI only works on local hardware.
4. No hosting cost. Built with web tech so a web version stays possible later.

## The experience — "the building"

The app is an immersive, sleek, dark, glassy space. **Navigation is an elevator**: each section is a floor, switching
floors plays a smooth transition and a soft *ding*. Classic elevator music plays **on by default**, mutable, and the
mute choice is remembered. Music is public-domain / CC0 (or CC-BY with a credits screen).

| Floor | Section |
|---|---|
| Lobby | Dashboard: today's matches, pending reviews, recent responses, run summary |
| 1 | Resume Studio |
| 2 | Profile |
| 3 | Job Board |
| 4 | Automation (Apply-for-me, review deck, run history) |
| 5 | Site Learning |
| 6 | Analytics |
| Maintenance | Settings, AI setup, accounts vault, backups |

## Features

### Resume Studio
- Upload a resume (Word or PDF). See an **editable ATS version side by side** with the original, plus suggestions
  for the original. Choose which one is the default.
- **ATS check** (deterministic, no AI needed): invisible characters, broken punctuation, merged headline/summary,
  soft-skill padding, duplicate bullets, missing LinkedIn, non-standard headings, tables/columns, contact info in
  headers/footers, etc.
- **Background tailoring** per job, with a **truth guard**: the AI may only reword and reorder what is already true
  in the resume — never invent employers, titles, dates, numbers, or skills.
- **Resume creation** from scratch (guided).
- **Federal resume generator** (USAJOBS format: hours/week, salary, supervisor, full addresses, detailed duties).
- **Output:** Word (.docx) by default; converted to PDF only when a site asks for PDF (via Microsoft Word, which
  the owner has installed; LibreOffice as fallback).
- Every resume version is kept and tied to every application it was used in.

### Cover letters
- Only generated **when a site allows one**.
- The user writes a **sample template**; the AI only tweaks it to fit each job. Changes are **highlighted** so the
  user can see exactly what was altered. Same truth guard as resumes.

### Profile
- Name, location, preferred job locations (with **strict remote-only / onsite-only** options), fields of interest,
  desired pay (hourly or salary), education level and degree, and target roles (suggestions as you type).
- Pre-filled from the uploaded resume.
- **Answer bank**: common application questions (work authorization, sponsorship, salary expectations, "why this
  company", EEO, etc.) answered once and reused; new questions get an AI draft the user approves once.
- **Sensitive data setting**: allow or forbid storing sensitive info. Off = the app pauses and asks each time.
  On = stored encrypted. **SSN and date of birth have their own separate switch.**
- **Company blocklist**, which automatically includes the user's current employer.

### Job Board
- Expandable cards per **source**. Each shows 5 matching jobs and a "see more" link to the full filtered list.
- Sorts/filters: newest, best match / likely to get an interview, highest pay, plus remote/onsite, pay, source.
- Without a resume/profile, shows generic jobs.
- **Learns** which sources and kinds of jobs the user engages with and orders cards accordingly.
- **Sources with APIs preferred:** USAJOBS, state/local government, company job boards (Greenhouse, Lever, Ashby,
  SmartRecruiters, Workday), job aggregators with free tiers, remote-job feeds.
- **LinkedIn, Indeed, Hiring Cafe, Glassdoor, ZipRecruiter** are used as *discovery boards only*: a paired
  **Microsoft Edge extension** adds an "Import to JobSweep" button on job pages. JobSweep then finds the **original
  posting on the company's own site** and applies there. If a job only exists on LinkedIn, it uses **assist mode**
  (the app fills, the user clicks submit). No full automation on LinkedIn/Indeed.
- **All available government job sites:** federal (USAJOBS), state (NC — runs on Workday), UNC-system schools,
  and county/city sites in the user's area.
- **Duplicate guard**: the same job seen on several sources becomes one entry; the app never applies twice.
- **Scam & ghost-job filter**: flags stale/reposted listings, Telegram/WhatsApp "interviews", requests for payment, etc.

### Automation — "Apply for me"
- **Review mode (default on first launch):** a card deck of filled-out applications, each with a preview, waiting
  for the user to hit Apply.
- **Auto mode:** submits and produces a summary of which applications went through and which failed (and why).
- **Auto sign-up**: creates accounts on application sites as needed, using the profile, a **unique strong password
  per site** stored encrypted, and **handles verification emails** automatically.
- **Dedicated email**: the user is advised to create a Gmail account just for job applications. All sign-ups and
  applications use it, and the app only reads that inbox.
- **Daily cap** chosen by the user, with **escalating risk warnings** as it goes higher, plus a **per-company cap**
  and a **minimum match score** for auto mode.
- **Pause & notify** on CAPTCHA, login/2FA, or an unfamiliar question — never bypasses CAPTCHAs.
- **Submission snapshots**: screenshot + exact resume, cover letter, and answers saved for every application.

### Site Learning (formerly "job site assumption")
- The user enters a web address (and optionally screenshots) of an application.
- The app learns the fields and steps, runs a **test fill that never submits**, and shows the results.
- Satisfied → added to the auto sites. Disappointed → the user explains what went wrong, the app adjusts and re-tests.
- Learning is done per **application platform** (Workday, Greenhouse, Lever, iCIMS, Taleo, NEOGOV, …) where possible,
  so teaching one platform covers thousands of employers.

### Review / Analytics
- How many applications were sent (auto vs. reviewed), by source, role, and platform.
- **Which resume version gets the most responses**, with sample sizes shown.
- **Email response tracking**: reads the dedicated inbox to detect confirmations, rejections, interview invites,
  assessments, and recruiter replies, and updates each application's status automatically.

## AI strategy

- **No AI where plain code works** (parsing, ATS checks, keyword matching, scoring, most field mapping).
- AI is used for writing (tailoring, cover-letter tweaks, unusual questions) and for messy extraction.
- **Provider order:** (1) **local AI via Ollama**, (2) **Gemini API free key** (one-click guided setup),
  (3) **OpenRouter sign-in** (free models), (4) the user's **own paid API keys** (OpenAI, Anthropic, Gemini).
- Consumer chat subscriptions (Claude, ChatGPT, Gemini Pro) don't include API access, so they can't power the app.
- **Privacy:** before anything goes to a free cloud tier, the app strips phone, address, and email; sensitive
  tasks prefer local AI. (Free-tier Gemini prompts may be used by Google to improve its products.)
- **Local AI wizard:** with permission, scans the PC's hardware and recommends the **5 best-matched local models**
  (balancing size against the context length this app needs). **"Freedom" mode** opens the list to uncensored
  Hugging Face models (labeled honestly: they tend to follow instructions worse). The wizard installs and sets up
  the chosen model, or offers a **ready-made prompt** with the PC's specs that can be pasted into any chatbot for
  step-by-step guidance.
- Owner's hardware note: has run up to ~12 GB VRAM models; 27–30B models only with small context windows.

## Owner's answers (reference)

| Topic | Decision |
|---|---|
| Platform | Windows desktop app |
| Users | Owner only for now; downloadable app later |
| Browser for extension | Microsoft Edge |
| Microsoft Word installed | Yes |
| Email | Dedicated Gmail for the app (2-Step Verification to be enabled for the app password) |
| LinkedIn / Indeed | Discovery + assist only |
| Government sites | All available |
| Sensitive data | User setting (allow / forbid), separate SSN/DOB switch |
| Schedule | Only while the PC is on |
| Daily cap | User-selected with escalating warnings |
| Resume format | Word; PDF when a site requires it |
| Cover letters | Only when allowed; user template, AI tweaks |
| Music | Classic elevator, on by default |
| Navigation | Elevator floors |
| Federal resume | Yes |
| First-launch mode | Review mode |
| Budget | $0 preferred |
