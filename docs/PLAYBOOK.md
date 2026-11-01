# The App-Building Playbook

**How to build any web application the right way — with accounts, an admin console, AI features, strong security, a good UI, and tests.**

This playbook was written from a real project: **Fluento — Master English** (first built under the working name "English Path"), an interactive English-learning website with 115 units, an AI tutor, an admin console, spaced review, games and a full security test suite. Everything here was actually done, broken, fixed and tested. Use it as the checklist and template for your next app — a shop, a clinic system, a school portal, a coaching app, anything.

---

## Contents

1. [How to use this playbook](#1-how-to-use-this-playbook)
2. [The story of this project (what we did, step by step)](#2-the-story-of-this-project)
3. [Golden rules](#3-golden-rules)
4. [The build process — phase by phase](#4-the-build-process--phase-by-phase)
5. [Standard architecture (copy this)](#5-standard-architecture-copy-this)
6. [Feature modules you can reuse in any app](#6-feature-modules-you-can-reuse-in-any-app)
   - 6.1 Accounts and login · 6.2 Admin console · 6.3 AI features · 6.4 Personal space · 6.5 Auto-save and resume · 6.6 Engagement (memory, games, streaks) · 6.7 Search · 6.8 Settings, themes, PWA
7. [UI / UX plan](#7-ui--ux-plan)
8. [Security playbook](#8-security-playbook)
9. [Testing playbook](#9-testing-playbook)
10. [Bug log — every bug, how we fixed it, how to avoid it](#10-bug-log)
11. [What we missed (and should do next time)](#11-what-we-missed)
12. [How to adapt this to a new application](#12-how-to-adapt-this-to-a-new-application)
13. [Deployment and operations](#13-deployment-and-operations)
14. [Prompt templates for working with an AI coding assistant](#14-prompt-templates)
15. [Code patterns (copy-paste)](#15-code-patterns)
16. [Final checklists](#16-final-checklists)

---

## 1. How to use this playbook

- **Starting a new app?** Read sections 3, 4 and 12, then pick the modules you need from section 6.
- **Adding AI?** Read 6.3 and the AI parts of section 8.
- **Before going live?** Go through section 16 (final checklists) line by line.
- **Working with an AI assistant (like Claude Code)?** Give it this file and use the prompt templates in section 14. Say: *"Follow docs/PLAYBOOK.md."*

Every rule here exists because something went wrong without it (see section 10).

---

## 2. The story of this project

| Step | What was asked | What we built | Lesson |
|---|---|---|---|
| 1 | "Make a website from my English book" | Read the PDF's contents list; found it is a copyrighted Cambridge book | **Check rights first.** We followed the syllabus (topic order — not copyrightable) but wrote **all content new**. |
| 2 | Plan | Unit → lesson, examples, mistakes, Easy/Medium/Hard practice; AI tutor; personal space | Agree the feature list and data model before coding. |
| 3 | v1 build | Zero-dependency Node.js + built-in SQLite server; no-build browser UI; 9 units; screenshot tests | Build a thin full slice end-to-end first, then fill in. |
| 4 | Content | 115 units, 2,070 questions in a simple text format with an automatic validator | Content is code: give it a format **and a checker**. The checker caught ~30 bad questions. |
| 5 | v2 (user feedback: "UI not good, more AI") | Book view, collapsible sections, contents bar, tap-a-word pronunciation, AI hints, exams + results, flowcharts, canvas, live voice chat, chat threads, AI memory, reasoning switch | Users ask for features in bursts — keep the architecture modular so each one is a small, separate piece. |
| 6 | v3 (admin + "never forget") | Admin console (users, AI on/off, token limits, usage and cost, live tracker, all chats), research-based spaced review, games, typing mode, auto-save | Admin, roles and usage tracking should have been planned **from day 1** (we had to add database migrations later). |
| 7 | Security test | Code review + live probing + 1,000s of fuzzed requests; fixed SSRF, cost abuse, login lockout, timing leak, crash bugs | **Test like an attacker.** Every serious bug was found by a dedicated security pass, not by normal use. |
| 8 | This playbook | — | Write down what you learn so the next app starts at v3, not v1. |

Final size: ~7,200 lines of code, 62 API routes, 17 automated test groups (API, security, fuzzing) plus browser end-to-end tests.

---

## 3. Golden rules

1. **Plan the boring foundations first:** accounts, roles (user/admin), settings, audit/usage logs, data export/delete, backups. Adding them later costs migrations and bugs.
2. **Every feature = data model + API + UI + test.** If one is missing, the feature is not done.
3. **Never trust the browser.** Every check that matters (who you are, what you own, limits, prices) happens on the server.
4. **Escape everything you display.** Treat user text and AI text the same: as untrusted.
5. **Every record belongs to someone.** Every query filters by owner (`WHERE user_id = ?`).
6. **AI is an external, paid, unreliable service.** Gate it (on/off per user), limit it (rate + daily tokens), log it (tokens + cost), validate its output, and never let users steer it to internal addresses.
7. **Fail safe.** Bad input → clear 4xx error, never a crash (500).
8. **Small dependencies surface.** We used **zero** npm packages: nothing to audit, nothing to break on update.
9. **Test in three layers:** API tests, security tests + fuzzing, real-browser end-to-end tests with screenshots.
10. **Look at the screenshots.** Many UI bugs (overflow, overlap, wrong state) were only visible in screenshots.
11. **Small commits with clear messages**, pushed often.
12. **Be honest about what is not tested** (for example "tested with a fake AI server, not your real key").

---

## 4. The build process — phase by phase

### Phase 0 — Understand and check (½ day)
- [ ] Who are the users? (learners, staff, customers, admins)
- [ ] What are the 3–5 core jobs they need to do?
- [ ] What data exists? Who owns each piece? (copyright, privacy, personal data)
- [ ] What must the admin control? (accounts, access, limits, prices, content)
- [ ] Where will it run? (own VPS, cloud) Any constraints? (here: "no Postgres", "OpenAI-compatible AI")

### Phase 1 — Plan (½–1 day)
- [ ] Feature list grouped into **must / should / later**
- [ ] Data model (tables) — include `users`, `sessions`, `settings`, `app_settings`, an **activity / usage log**
- [ ] API list (method + path + who can call it)
- [ ] Screen list (pages, tabs, dialogs) + navigation
- [ ] Security notes for each feature (see section 8)
- [ ] Agree the plan with the owner before coding

### Phase 2 — Skeleton (1 day)
- [ ] Server: config from env, database with migrations, router, JSON body reader, static files, error handler, security headers
- [ ] Accounts: register (first user = admin), login, logout, sessions, roles
- [ ] UI shell: top bar, sidebar, router, toasts, modals, theme
- [ ] One complete feature end-to-end (here: one unit with lesson + quiz)
- [ ] First automated test + first browser screenshot test

### Phase 3 — Content and core features
- [ ] Content in a simple format **with a validator** (`npm run check-content`)
- [ ] Core features one by one, each with its test
- [ ] Commit and push after each feature

### Phase 4 — Power features
- [ ] Admin console, AI features, personal space, auto-save, engagement
- [ ] Keep each in its own file/module

### Phase 5 — Quality
- [ ] Browser end-to-end tests for every main flow (desktop **and** mobile)
- [ ] Look at every screenshot
- [ ] Accessibility basics (keyboard, labels, contrast)

### Phase 6 — Security (never skip)
- [ ] Code review against section 8
- [ ] Live probing (curl) of suspicious areas
- [ ] Security regression tests + fuzzer over all routes
- [ ] Fix → re-test → document

### Phase 7 — Ship
- [ ] README (features, setup, config table, deploy, backup, security)
- [ ] `.env.example`, systemd unit, nginx config
- [ ] Final checklists (section 16)

---

## 5. Standard architecture (copy this)

### 5.1 Stack we used and why

| Part | Choice | Why |
|---|---|---|
| Server | Node.js 22+, plain `node:http` | No framework to learn or update; fast; easy to read |
| Database | Built-in `node:sqlite` (one file) | No database server to run; easy backup (copy one file); handles thousands of users on one VPS |
| UI | Plain HTML/CSS + ES modules, no build step | Loads fast, deploy by copying files, nothing to compile |
| AI | Any OpenAI-compatible API (OpenRouter, OpenAI, Groq, Ollama…) | One code path for every provider |
| Tests | `node:test` + Playwright (browser) | Built in; Playwright for real-browser checks |
| Deploy | systemd + nginx + certbot | Standard, reliable, cheap |

**When to choose something else:** many servers behind a load balancer → Postgres + Redis (shared rate limits/sessions); a large team or complex UI → a framework (React/Vue/Svelte) with a build step; mobile app → same API, native/Flutter client.

### 5.2 Folder layout

```
server/
  config.js     all settings from environment (+ .env loader), with safe defaults
  db.js         schema (CREATE TABLE IF NOT EXISTS) + addColumn() migrations
  http.js       JSON body reader (size limit, object-only), cookies, static files, send()
  auth.js       password hashing, sessions, rate limiting, encryption of secrets
  ai.js         provider selection, safe HTTP request, streaming, prompts, output parsers
  content.js    content loader + validator (domain specific)
  index.js      routes (one place), helpers, admin, request handler, security headers
public/
  index.html    one page; everything else is JS modules
  css/app.css   design tokens (CSS variables), light + dark themes, components
  js/core.js    api(), store, toast, modal, speech helpers, shared utilities
  js/app.js     shell, router, dashboard, settings
  js/<feature>.js   one file per feature area (unit, quiz, tutor, admin, review, games…)
content/        domain content as text files
test/           api.test.js, security.test.js, fuzz.test.js
deploy/         fluento.service (systemd), nginx.conf
docs/           this playbook
```

### 5.3 Request lifecycle (server)

```
request → parse URL (bad URL → 400)
        → API? → CSRF check for writes (Origin / Sec-Fetch-Site)
               → find route → load session user → login required? admin required?
               → write rate limit → update last_seen
               → handler: validate input → owner checks → do work → JSON
        → else static file (safe path) → else index.html (single-page app)
errors  → known HttpError → its status + message; unknown → 500 "Server error" + log
every response gets security headers (CSP, frame, nosniff, permissions, HSTS)
```

### 5.4 Database conventions

- Every table that holds user data has `user_id … REFERENCES users(id) ON DELETE CASCADE` → deleting a user deletes their data.
- Logs that must survive user deletion use `ON DELETE SET NULL` (AI usage).
- Times are numbers (milliseconds). Days for streaks are `YYYY-MM-DD` strings from the **client's** local date.
- Indexes on `(user_id, …)` for every list query.
- **Migrations:** `CREATE TABLE IF NOT EXISTS` for new tables, and an `addColumn(table, col, def)` helper that checks `PRAGMA table_info` before `ALTER TABLE`. Old databases upgrade themselves on start.
- App-wide editable settings live in an `app_settings(key, value JSON)` table; `.env` gives the defaults.

---

## 6. Feature modules you can reuse in any app

Each module lists: **what**, **data**, **API**, **UI**, **security**, **tests**.

### 6.1 Accounts and login

- **What:** username + password, sessions, roles (`user`, `admin`), turn accounts off.
- **Data:** `users(id, username UNIQUE NOCASE, display_name, pass_hash, role, disabled, created_at, last_seen, …)`, `sessions(token_hash, user_id, expires_at)`.
- **Rules:**
  - Password hash: **scrypt** (or argon2/bcrypt) with random salt. Never store plain passwords.
  - Session token: 32 random bytes; store only its **SHA-256**; cookie `HttpOnly; SameSite=Lax; Secure (HTTPS)`.
  - First account on a new server becomes admin; after that **only admins create accounts** (sign-up switch in admin settings). Optional `ADMIN_USERNAME/ADMIN_PASSWORD` env bootstraps an admin.
  - Passwords: ≥ 8 characters, not containing the username, not a common password.
  - Login: unknown users still run the hash (**no timing leak**); only **failed** attempts count (10 per user, 30 per IP per 10 minutes).
  - Changing password → log out other devices. Admin reset → log out that user. Turning an account off → delete its sessions.
  - Never let the last admin demote, disable or delete themselves.
- **Tests:** register/login/logout; duplicate username; disabled user can't log in; wrong password lockout per user only; timing parity.

### 6.2 Admin console

The admin console from this project, as a reusable checklist:

| Tab | Shows / does |
|---|---|
| **Overview** | users (total, online now, active today/week), AI calls/tokens/cost (today, 7d, 30d, all), errors, charts per day, by model, by feature, top users, domain stats (answers, tests) |
| **Users** | search; create (with generated password + copyable login card); edit name/role/password; AI on/off switch inline; daily AI token limit; turn account on/off; delete; per-user stats |
| **User detail** | last seen, current page, progress map, activity chart, recent results, chats, AI usage |
| **Live tracker** | who is online (last 3 minutes) and which page they are on; auto-refresh |
| **AI usage** | every AI call: time, user, feature, model, provider, input/output/reasoning tokens, cost and its source, duration, status/error; filters; CSV export |
| **AI conversations** | read any chat (including the model's "thinking") |
| **Settings** | who can sign up; shared AI provider (URL, key, model) + test button; let users bring their own key; default daily limit; price table (USD per 1M tokens) + "load prices from OpenRouter" |

- **Data:** `users.role/ai_enabled/ai_daily_tokens/disabled/last_seen/resume`, `ai_usage`, `app_settings`.
- **Security:** `{ admin: true }` flag on every admin route, checked **on the server** for every request; secrets shown only as `••••last4`; admin can't lock themselves out.
- **Privacy note:** if admins can read user chats, **tell users** (in your terms/privacy text).

### 6.3 AI features

#### Provider layer
- One function `providerFor(userSettings, defaults)` returns `{ baseUrl, apiKey, model, reasoning, userUrl, ownKey }`.
- Defaults come from **admin settings**, then `.env`.
- Users may bring their own key/URL/model **only if the admin allows** it.
- **With the shared key, users cannot choose the model** (cost protection).
- If a user sets their own URL, the shared key is **never** sent there (key-leak protection).

#### Safe HTTP to the AI provider (SSRF protection)
- Check every resolved IP **at connect time** (custom DNS `lookup`) when the URL comes from a user — blocks localhost, private ranges, link-local/cloud metadata (169.254.169.254), IPv6 private, IPv4-mapped IPv6.
- **Never follow redirects.** Reject URLs with `user:pass@`. Timeout. Size cap on non-streamed replies.

#### Streaming
- Server streams Server-Sent Events (SSE) to the browser: `{t: text}`, `{r: reasoning}`, `{done, threadId, title}`, `{error}`.
- nginx: `proxy_buffering off`.
- Abort upstream when the browser disconnects.
- Request `stream_options: {include_usage: true}`; retry once without it if the provider returns 400.

#### Usage and cost logging (do this for every AI call)
- Wrapper `aiRun(user, kind, provider, messages, opts, threadId)` → calls the model, then logs: user, kind (chat/quiz/hint/…), model, provider host, prompt/completion/reasoning tokens, cost, cost source (`provider` / `price-table` / `unknown`), estimated flag, duration, ok/error.
- Cost: use the provider's reported cost if present (OpenRouter `usage.cost`), else `tokens × price-table`, else 0. Never store NaN.

#### Gating and limits
- Per-user **AI on/off**, per-user or default **daily token limit**, **rate limit** (calls per minute).
- Check before each call; clear messages ("AI is turned off for your account").

#### Prompt design
- **Scoped assistant:** system prompt contains only the current topic's content + "FOCUS RULES: answer only about this; otherwise say it's outside and suggest General mode".
- **General assistant:** broad help, with a domain twist (here: correct the learner's English).
- **Learner profile** in the prompt: name, first language, preferred style, weak areas, **memory notes**.
- **Structured output** (quizzes, flowcharts): ask for JSON only, show an exact example, then **parse defensively** (find first `{` and last `}`), **validate every field**, drop invalid items, cap counts, and give a friendly error if nothing usable is left.
- **"Never reveal" prompts** (hints): tell the model not to reveal the answer **and** check the output on the server (leak guard), with a safe fallback.

#### Conversations and memory
- `threads(user, scope, title)` + `messages(thread, role, content, reasoning)` → "New chat", continue, rename, delete.
- Send only the last N messages (we used 20) to control cost.
- **Memory:** after every ~6 new messages, ask the model (cheaply, in the background) to update short bullet notes for that scope; store in `memory(user, scope)`; include in future prompts; let the user view/edit/clear/turn off.

#### Reasoning ("thinking") models
- Optional switch per user; send `reasoning: {enabled: true}` only when on (some providers reject unknown fields).
- Show reasoning in a collapsed "Thinking" box. Turn it off for small background tasks (hints, memory, quizzes).

#### Voice
- Browser speech recognition + speech synthesis; a special prompt rule: "spoken conversation, 1–3 short sentences, no markdown, end with a question".

#### Caching
- Cache expensive, shared, deterministic outputs (we cached AI flowcharts per unit in `ai_cache`).

### 6.4 Personal space
- Bookmarks, "important" flags, notes (colours, auto-save, markdown preview), saved items (sentences, AI answers, own writing), mistakes list, recently viewed, results history.
- **Export my data (JSON)** and **delete my account** (with password).
- Caps: notes ≤ 2,000, saved ≤ 5,000 per user.

### 6.5 Auto-save and resume
- **Where you were:** on navigation and every few seconds of scrolling, POST `{route, title, scroll}`; on page hide use `fetch(..., {keepalive: true})`. Show "📍 Continue where you left off" on the dashboard and a banner after login; restore scroll after rendering.
- **Unfinished work:** save multi-step forms/quizzes on the server after each step (`quiz_state(user, key, state)`); on return ask "Continue or start again?". Delete on finish. Cap per user.
- **Drafts:** typed text in `localStorage` keyed by context; clear after save.
- **Validate** stored routes (`^#/[\w/%.:-]*$`) before using them as links.

### 6.6 Engagement: memory, games, streaks (adapt to any domain)
- **Spaced repetition:** forgetting curve `R(t) = (1 + 19/81 · t/S)^-0.5` (FSRS style). Success grows stability S (more when recall was harder); failure shrinks it. Next review when R ≈ 90% (t = S).
- **Today's review:** retrieval practice first ("write what you remember", AI checks), then **interleaved** questions from all due items.
- **Games:** quick-fire (timer, lives, combos), memory match, builder race — generated from existing content, best scores, XP.
- **Gamification:** XP, daily goal ring, streak, badges, activity heatmap.
- **Other domains:** a sales training app → spaced product-knowledge quizzes; a clinic → staff protocol refreshers; a shop → staff onboarding. The same `srs` table works for anything with "items to remember".

### 6.7 Search
- Server builds a plain-text index once at start; client searches it plus the user's own notes/saved items; highlight matches with `<mark>` **after escaping**.

### 6.8 Settings, themes, PWA, accessibility
- Theme light/dark/system with CSS variables; a visible toggle button.
- Font size, reading voice and speed, daily goal, first language, AI style.
- `manifest.webmanifest` + icon → installable on phones.
- Keyboard shortcuts (`/` search, `A` AI), `aria-label`s on icon buttons, focus states, `prefers-reduced-motion`.

---

## 7. UI / UX plan

### 7.1 Layout
- **Top bar:** logo, search, status pills (streak, daily goal), theme toggle, AI button, user menu.
- **Sidebar:** main sections with icons + labels; collapsible to icons on desktop; slide-in on mobile; badges for "due" counts; admin link only for admins.
- **Main area:** max-width page container; `.wide` for book view / admin tables.
- **Right drawer:** AI assistant (stays open across pages on desktop; full-screen on mobile; hidden with `visibility` when closed).
- **Floating:** back-to-top, toasts, resume banner.

### 7.2 Design tokens (CSS variables)
`--bg --panel --panel2 --text --muted --line --brand --brand-soft --ok --bad --warn --ai` + soft versions; radius; shadow. Dark theme = same names, different values under `[data-theme="dark"]`. **Never hard-code colours in components.**

### 7.3 Components (build once, reuse)
Buttons (primary, ghost, danger, small, AI), chips, segmented control, pills/badges, cards, tables (wrapped for horizontal scroll), forms (labels above inputs, inline errors), modal (Esc + click-outside to close), toast, switch, progress bar/ring, tabs (sticky), collapsible sections, empty states, loading ("typing…" dots), charts (simple CSS bars).

### 7.4 Every screen must handle four states
1. **Loading** (text or dots)  2. **Empty** (friendly message + next action)  3. **Error** (clear message, retry)  4. **Normal**.

### 7.5 Interaction rules
- Instant feedback on every action (toast, colour, sound/vibration where useful).
- Keyboard: Enter submits, number keys pick options, Esc closes.
- Destructive actions ask for confirmation.
- Long lists: search/filter; long pages: contents bar + back-to-top + collapsible sections.
- Auto-save instead of "Save" buttons where possible; show "Saving… / Saved ✓".
- Never lose work on navigation (drafts, quiz state, canvas auto-save on leave).

### 7.6 Mobile
- Breakpoints we used: 1200px (drawer overlays content), 1000px (single column, book pages stack), 760px (sidebar slides in, search moves into the sidebar, 2-column stat grids).
- Touch targets ≥ 40px; no hover-only features.

### 7.7 Accessibility checklist
- [ ] Every icon-only button has `aria-label`/`title`
- [ ] Forms have labels; errors are text, not only colour
- [ ] Contrast OK in both themes
- [ ] Works with keyboard only
- [ ] `prefers-reduced-motion` disables animations
- [ ] Language attribute on `<html>`

### 7.8 UI bugs to watch for (we hit all of these)
Grid items overflowing (fix: `min-width: 0` / `minmax(0, 1fr)`), closed drawers still visible (fix: `visibility: hidden`), empty table header rows, single-bar charts stretching (cap bar width), raw separator characters shown to users, toasts piling up, screenshots taken mid-animation (false alarms).

---

## 8. Security playbook

Go through every row for every app. ✅ = what we implemented here.

### 8.1 Authentication and sessions
| Risk | Defence |
|---|---|
| Stolen password database | ✅ scrypt + salt; ✅ secrets (API keys) encrypted with AES-256-GCM; ✅ only token hashes stored |
| Password guessing | ✅ lockout counts **failures only**, per user and per IP; ✅ strong password rules |
| Username discovery | ✅ same work (hash) for unknown users; ✅ same error message |
| Session theft | ✅ HttpOnly, SameSite=Lax, Secure on HTTPS, expiry, server-side revoke |
| Old sessions after password change | ✅ log out other devices |
| Lost admin access | ✅ last admin protected; ✅ env bootstrap admin |

### 8.2 Authorization (access control)
| Risk | Defence |
|---|---|
| Reading/changing other users' data (IDOR) | ✅ every query `WHERE id = ? AND user_id = ?`; ✅ tests that user B gets 404 on user A's IDs |
| Learner calling admin APIs | ✅ server-side `admin` flag on routes; ✅ test all admin routes return 403 |
| Disabled user keeps using the app | ✅ sessions deleted + `disabled` checked on every request |

### 8.3 Web attacks
| Risk | Defence |
|---|---|
| XSS (script injection) | ✅ escape all user/AI text before `innerHTML`; ✅ markdown renderer escapes first, no links/HTML; ✅ CSP `script-src 'self'`, `object-src 'none'`, `base-uri 'self'` |
| CSRF | ✅ JSON-only bodies (forms can't send JSON); ✅ SameSite cookies; ✅ refuse `Origin` mismatch, unparsable `Origin` (`null`), and `Sec-Fetch-Site: cross-site` |
| Clickjacking | ✅ `X-Frame-Options: DENY` + `frame-ancestors 'none'` |
| MIME sniffing | ✅ `nosniff` |
| Path traversal | ✅ decode safely, normalise, root + separator check, no dotfiles, no NUL bytes |
| SQL injection | ✅ prepared statements only; numbers clamped (e.g. `LIMIT` ≥ 1) |
| Prototype pollution | ✅ build objects with `Object.fromEntries`, skip `__proto__/constructor/prototype`, `Object.hasOwn` for lookups |

### 8.4 Server-side request forgery (SSRF) — any feature that fetches a URL
✅ connect-time IP check (no DNS rebinding), ✅ no redirects, ✅ no credentials in URL, ✅ http/https only, ✅ timeouts, ✅ size caps, ✅ admin switch to allow local models.

### 8.5 AI-specific risks
| Risk | Defence |
|---|---|
| Cost abuse | ✅ per-user on/off, daily token limits, rate limits, model locked with shared key, usage + cost log |
| API key leakage | ✅ key never sent to browser; never sent to user-supplied URLs |
| Prompt injection / jailbreak | Scoped system prompts; treat AI output as untrusted; never let AI output run code or reach other users unescaped |
| Answer leakage (hints) | ✅ instruction + server-side leak guard |
| Broken structured output | ✅ strict parsing + validation + caps |
| Privacy | Memory is per user, editable, can be turned off; tell users admins can read chats |

### 8.6 Denial of service and abuse
✅ body size limits (256 KB default, larger only where needed), ✅ JSON must be an object, ✅ per-user write rate limit, ✅ registration limit, ✅ caps on rows per user, ✅ `headersTimeout`/`requestTimeout` (slow-request attacks), ✅ AI rate limits. **Missing for big scale:** shared rate limiter (Redis) when running several processes.

### 8.7 Infrastructure
✅ app binds to `127.0.0.1` behind nginx, ✅ `X-Forwarded-For` trusted only from a local proxy and only the last address, ✅ HTTPS + HSTS, ✅ `server_tokens off`, ✅ systemd hardening (`NoNewPrivileges`, `ProtectSystem=strict`, `ReadWritePaths` only the data folder), ✅ no secrets in git (`.gitignore` has `.env`, `data/`).

### 8.8 How we test security (repeat for every app)
1. **Read** the code with this table open.
2. **Probe** the running app with `curl` (bad URLs, weird headers, negative numbers, timing).
3. **Write a security test** for each fix (`test/security.test.js`).
4. **Fuzz** every route with hostile values as visitor/user/admin; fail on any 500 or logged error (`test/fuzz.test.js`).
5. **Scan the UI code** for template strings that insert user data without escaping.
6. **Check the repository** for committed secrets.

---

## 9. Testing playbook

### 9.1 Layers
| Layer | Tool | What it proves |
|---|---|---|
| Content validator | `npm run check-content` | every lesson/question is well-formed (one correct answer, no duplicates, no placeholders, blanks match answers) |
| API tests | `node:test` + real HTTP server on a random port + temp database | features work, data is private, roles enforced |
| Fake AI server | tiny HTTP server that streams SSE like OpenRouter (incl. reasoning and usage/cost) | all AI features testable **without a key or cost** |
| Security tests | `test/security.test.js` | each vulnerability stays fixed |
| Fuzzer | `test/fuzz.test.js` | no route crashes on hostile input |
| Browser end-to-end | Playwright scripts: admin + learner in two browser contexts | real flows work; **no browser console errors**; screenshots for visual review |
| Mobile | same scripts at 390×844 | layout works on phones |

### 9.2 Rules
- Tests create their **own temporary database** and use **random ports**.
- Tests must not depend on order of other tests (create the users you need; remember "first user = admin").
- Make limits configurable (`REGISTER_LIMIT`, `WRITE_LIMIT`) so tests can raise them — but keep secure defaults.
- In browser tests, wait for a **specific element**, not for time; stop loops when the game/quiz ends.
- When a test fails, first ask: *is the app wrong, or the test?* (Several of our failures were the new security rules doing their job.)
- Slow by design (password hashing) → sample those routes in the fuzzer instead of removing the protection.

### 9.3 Fake AI server (pattern)
Return different canned replies depending on words in the system prompt (`practice questions` → quiz JSON, `flowchart` → diagram JSON, `HINT` → hint), stream in small chunks, emit `reasoning` deltas when `reasoning` was requested, and finish with a `usage` chunk including `cost`.

---

## 10. Bug log

Every real bug from this project: **symptom → cause → fix → rule to avoid it.**

### 10.1 Functional and UI bugs
| # | Symptom | Cause | Fix | Prevention rule |
|---|---|---|---|---|
| 1 | Empty grey header row in some lesson tables | Table with blank header cells | Renderer skips an all-empty header | Test renderers with edge-case input |
| 2 | Users saw raw `|` between alternative answers | Internal separator displayed as is | Format alternatives ("A or B") for display | Never show internal formats to users |
| 3 | Mobile: AI drawer stayed open and broke layout | Drawer state not reset on navigation | Close overlays on route change on small screens | Test every overlay on mobile |
| 4 | Questions with two blanks impossible | Format supported one blank only | Multi-blank format `= are, going` + validator check | Design formats for the hardest case first |
| 5 | ~30 bad questions (duplicate options, no correct answer, wrong answer marked, placeholder text, broken options) | Hand-written content | Validator rejects them with file:line | **Content needs a validator** |
| 6 | AI hint could give away short answers ("is") | Leak check ignored answers ≤ 2 letters | Leak guard: long answers anywhere, short ones when quoted/bold/"answer is …" | Never rely on the AI obeying; check outputs |
| 7 | Book view wider than the screen | Grid `1fr` columns can't shrink below content | `minmax(0, 1fr)`; global `.grid > * { min-width: 0 }` | Always allow grid/flex children to shrink |
| 8 | Closed drawer's shadow visible at the edge | Off-screen transform but still visible | `visibility: hidden` when closed (delayed transition) | Hide closed panels fully |
| 9 | **Slow page drew over the next page** (e.g. dashboard over admin settings) | Async render finished after navigation into the shared container | Each navigation renders into a **fresh container** | Assume async work can finish late; never write into a shared node after `await` |
| 10 | Buttons stopped working after an AI request | `event.currentTarget` is `null` after `await` | Save the element in a variable before `await` | Never use `event.currentTarget` after `await` |
| 11 | Review page used old data | State not reloaded when opening the page | Reload state on page entry | Pages that depend on fresh server data reload it |
| 12 | One-day chart = one giant bar | Bars stretch to fill width | Max bar width | Test charts with 0, 1 and many data points |
| 13 | Toasts piled up across pages | Many quick toasts during games | Short durations | Rate-limit noisy UI messages |
| 14 | `node --test test/` failed | Folder argument unsupported in this Node version | `node --test test/*.test.js` | Check tool behaviour on the target version |
| 15 | Fuzzer exceeded time limit | Every login now runs a deliberately slow hash | Smaller sample for password routes | Make tests fit security, not the reverse |
| 16 | Dev scripts killed their own shell | `pkill -f pattern` matched the command itself | Match processes by exact command via `/proc`, or by port | Be careful with broad process kills |

### 10.2 Security bugs (found in the security pass)
| # | Problem | Impact | Fix |
|---|---|---|---|
| S1 | AI URL check then `fetch` **followed redirects**; DNS could change between check and connect | Learner could make the server call internal services (cloud metadata) | Connect-time IP check, no redirects, no credentials, timeout |
| S2 | With the shared key, learners could pick **any model** | Huge AI bills | Model choice only with own key |
| S3 | Login limit **per IP behind nginx** = one shared IP; **successful logins counted** | One attacker could lock out everyone | Real client IP from proxy; failures-only, per user + per IP |
| S4 | Unknown usernames answered ~5× faster | Attackers could list valid usernames | Dummy hash for unknown users |
| S5 | JSON body `null`/number/array → **500 on most routes** | Crash/noise; possible DoS | Body reader accepts only JSON objects |
| S6 | Malformed URL encoding → 500 | Crash/noise | Safe decoding → 400 / fallback |
| S7 | `Origin: null` → 500; cross-site requests without Origin accepted | CSRF gaps | Parse safely; reject `Sec-Fetch-Site: cross-site` |
| S8 | Negative `LIMIT` meant "no limit" | Large responses | Clamp numbers |
| S9 | Password change kept other sessions | Stolen session survives password change | Log out other devices |
| S10 | Sign-up race on a new server | Unexpected accounts | Re-check after reading the body |
| S11 | No caps on notes/saved/quiz saves; no request timeouts | Database flooding; slow-request attacks | Caps, write rate limit, timeouts |
| S12 | Missing headers (HSTS, frame-ancestors, permissions…) | Weaker browser protection | Full header set |

---

## 11. What we missed

Be honest about gaps. For the next app, plan these from the start:

**Planned too late in this project**
- Roles, admin console and AI usage logging were added in v3 → required migrations. *Plan them in Phase 1.*
- Security review happened at the end → several serious issues lived for three versions. *Do a mini security check after every feature.*
- Copyright of source material checked only when the PDF arrived. *Ask about rights on day 1.*

**Not built yet (good next steps)**
- **CI pipeline** (GitHub Actions running `npm test` + content check on every push).
- **Admin audit log** (who changed which user/setting, when).
- **Password reset by email** and **two-factor login** for admins.
- **Automatic backups** (daily `sqlite3 .backup` + off-server copy) and a tested restore.
- **Monitoring:** health endpoint, uptime check, error alerts, structured logs.
- **Shared rate limiter** if running more than one server process.
- **Exam integrity:** answers are sent to the browser (fine for self-study; for real exams, check answers on the server).
- **Offline mode** (service worker) for learners with weak internet.
- **UI translations** (the interface is English-only).
- **Full accessibility audit** with a screen reader.
- **Human review** of AI-written and hand-written content by a teacher/domain expert.
- **Terms and privacy page** (especially: admins can read AI chats).
- **Load testing** before a large launch.

---

## 12. How to adapt this to a new application

### 12.1 Step by step
1. **Describe the app** in 5 lines: users, core jobs, data, admin needs, where it runs.
2. **Copy the foundations** from this repo: `server/config.js`, `db.js`, `http.js`, `auth.js`, the request handler + headers from `index.js`, `public/js/core.js`, the shell/router from `app.js`, `css/app.css` tokens + components, `admin.js`, `test/security.test.js`, `test/fuzz.test.js`, `deploy/`.
3. **Replace the domain:** `content.js` → your data loader; `unit.js/quiz.js/games.js` → your feature screens.
4. **Pick modules** from the menu below.
5. **Follow phases 2–7** (section 4).

### 12.2 Feature menu (tick what the new app needs)
- [ ] Accounts + roles (always)
- [ ] Admin console: users, settings, live tracker (almost always)
- [ ] Usage/cost log (always if AI or paid APIs)
- [ ] AI assistant: scoped + general, threads, memory, reasoning switch, voice
- [ ] AI structured generation (quizzes, plans, diagrams) with validation
- [ ] Personal space: notes, bookmarks, saved items, export/delete
- [ ] Auto-save + resume
- [ ] Spaced review / reminders
- [ ] Games / gamification (XP, streaks, badges)
- [ ] Search
- [ ] Results/history with charts and AI analysis
- [ ] Book/reading view, collapsible sections, contents bar
- [ ] Drawing canvas / file uploads (size limits, type checks)
- [ ] Payments (use a provider; never store card data)
- [ ] Notifications (email/push)
- [ ] Multi-language UI

### 12.3 Examples
| New app | Reuse | Domain-specific parts |
|---|---|---|
| **Clinic booking** | accounts (patients/staff/admin roles), admin console, audit log, auto-save forms, AI assistant scoped to clinic FAQs, usage log | doctors, slots, bookings, reminders; extra privacy rules for health data |
| **Shop / inventory** | accounts, admin, search, results charts, export, AI assistant for product questions | products, stock, orders, suppliers; payments via provider |
| **School portal** | everything from Fluento (lessons, quizzes, review, games, AI tutor) | classes, teachers, assignments, grades, parent accounts |
| **Coaching / fitness** | accounts, personal space, spaced reminders, streaks, AI coach with memory | plans, sessions, progress photos (upload limits) |
| **Company knowledge base** | search, scoped AI per document, admin, usage/cost | documents, permissions per team, citations |

### 12.4 Roles template
`admin` (everything) → `staff`/`teacher` (manage their group) → `user` (own data only). Put the role on the user row; check it on every server route; hide UI the user can't use (but **never rely on hiding**).

---

## 13. Deployment and operations

### 13.1 First deploy (VPS)
1. Install Node 22+, nginx, certbot.
2. Create a system user; clone to `/opt/<app>`; data folder `/var/lib/<app>` owned by that user.
3. `.env` from `.env.example`: `HOST=127.0.0.1`, `SECURE_COOKIES=true`, `APP_SECRET`, AI key/model, `ADMIN_USERNAME/PASSWORD`.
4. systemd unit (hardened) → `systemctl enable --now`.
5. nginx site (proxy, `proxy_buffering off` for streaming, `server_tokens off`, one trusted `X-Forwarded-For`) → certbot HTTPS.
6. Log in as admin → Admin → Settings: provider test, prices, sign-up policy, default AI limit → create users.

### 13.2 Daily operations
- **Backup** daily: `sqlite3 app.db ".backup /backups/app-$(date +%F).db"` + copy off the server; keep `secret.key`/`APP_SECRET` safe (without it, saved user AI keys can't be decrypted).
- **Update:** `git pull && systemctl restart <app>` (migrations run automatically).
- **Watch:** Admin → Overview (errors, spend), AI usage errors filter, server logs `journalctl -u <app>`.
- **Costs:** set a default daily token limit; review top users weekly.

### 13.3 Incident checklist
- [ ] Suspected key leak → rotate provider key in Admin → Settings; check AI usage for unusual users/models
- [ ] Suspected account takeover → turn account off (logs out), reset password
- [ ] Server down → `systemctl status`, `journalctl -u`, disk space, restore from backup if needed
- [ ] Bug report → reproduce in a test first, fix, keep the test

---

## 14. Prompt templates

Use these with an AI coding assistant.

**Plan a new app**
> I want to build \<app\> for \<users\>. Core jobs: \<list\>. Constraints: \<hosting, no Postgres, etc.\>. Follow docs/PLAYBOOK.md. First give me a plan: feature list (must/should/later), data model, API list, screens, admin features, AI features, security notes. Don't code yet.

**Build the skeleton**
> Build Phase 2 from the playbook: config, database with migrations, accounts with roles (first user admin, admin-only sign-up), security headers, CSRF and body checks, UI shell with sidebar/top bar/router/toasts/modals/dark mode, one complete feature end-to-end, an API test and a Playwright screenshot test. Commit and push.

**Add an AI feature**
> Add \<feature\> using the AI module pattern from section 6.3: go through providerFor/aiRun (usage + cost logging), respect per-user AI switch and daily limit, stream with SSE, validate any structured output, add a test with the fake AI server.

**Add admin control for a feature**
> Add admin controls for \<feature\>: settings in app_settings, per-user switch/limit on the users table, an admin tab with stats and a table, server-side admin checks, tests that learners get 403.

**Security pass**
> Do a full security review using section 8 of the playbook: read the code, probe the running server with curl, write a security test for each finding, run a fuzzer over every route as visitor/user/admin, fix everything, report what was found and fixed.

**Bug hunt**
> Run all tests and browser end-to-end flows (desktop and mobile), look at every screenshot, list every bug with cause and fix, fix them, and add a test for each.

---

## 15. Code patterns

### 15.1 Route with login, admin flag and validation
```js
route('PUT', '/api/admin/users/:id', async (ctx) => {
  const u = userRow(ctx.params.id);                 // 404 if missing
  const b = await ctx.body();                       // JSON object only, size-limited
  if (b.aiDailyTokens !== undefined)
    db.prepare('UPDATE users SET ai_daily_tokens = ? WHERE id = ?')
      .run(Math.max(0, Number(b.aiDailyTokens) || 0), u.id);   // clamp numbers
  return { ok: true };
}, { admin: true });                                // checked on the server for every request
```

### 15.2 Owner check (every user record)
```js
const n = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(Number(ctx.params.id), ctx.user.id);
if (!n) throw new HttpError(404, 'Note not found');   // same answer whether missing or not yours
```

### 15.3 Safe JSON body reader
```js
// reject non-JSON content type (415), too large (413), invalid JSON (400), and non-objects (400)
if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Expected a JSON object');
```

### 15.4 CSRF check for writes
```js
let sameOrigin = true;
if (origin) { try { sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; } }
const site = req.headers['sec-fetch-site'];
if (!sameOrigin || (site && site !== 'same-origin' && site !== 'none')) throw new HttpError(403, 'Cross-origin request blocked');
```

### 15.5 AI call wrapper (usage + cost on every call)
```js
async function aiRun(user, kind, p, messages, opts = {}, threadId = null) {
  const t0 = Date.now(); let usage = null; let out = '';
  try {
    out = await ai.streamChat(p, messages, { ...opts, onDelta: (d) => { out += d; opts.onDelta?.(d); }, onUsage: (u) => { usage = u; } });
    logUsage(user, kind, p, messages, out, usage, Date.now() - t0, true, '', threadId);
    return out;
  } catch (e) { logUsage(user, kind, p, messages, out, usage, Date.now() - t0, false, e.message, threadId); throw e; }
}
```

### 15.6 SSRF-safe outgoing request (idea)
```js
// http(s).request with a custom `lookup` that resolves the host and rejects private IPs
// at connect time; no redirect following; timeout; size cap; reject user:pass@ in URLs.
```

### 15.7 Render race protection (single-page apps)
```js
async function route() {
  const view = document.createElement('div');
  document.querySelector('#view').replaceChildren(view);   // old async renders write into detached nodes
  await renderPage(view);
}
```

### 15.8 Don't use event.currentTarget after await
```js
btn.onclick = async (e) => {
  const b = e.currentTarget;      // save it first
  b.disabled = true;
  await doWork();
  b.disabled = false;             // e.currentTarget would be null here
};
```

### 15.9 Escape everything
```js
el.innerHTML = `<b>${esc(user.display_name)}</b> ${md(aiAnswer)}`;   // md() escapes first
toast(message);                                                      // uses textContent
```

### 15.10 Migration helper
```js
const addColumn = (table, col, def) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
```

---

## 16. Final checklists

### Before you say "done" on any feature
- [ ] Data model, API, UI and test exist
- [ ] Owner checks on every query; admin checks where needed
- [ ] Inputs validated and clamped; bad input → 4xx
- [ ] All displayed text escaped
- [ ] Loading / empty / error states
- [ ] Works on mobile and in dark mode
- [ ] Browser test passes with no console errors; screenshots reviewed
- [ ] Committed with a clear message

### Before going live
- [ ] `npm test` (API + security + fuzz) passes
- [ ] Content/data validator passes
- [ ] Browser flows pass for every role
- [ ] `.env`: `HOST=127.0.0.1`, `SECURE_COOKIES=true`, `APP_SECRET` set, admin bootstrap, AI key and model
- [ ] HTTPS working; HSTS header present
- [ ] Sign-up policy chosen; default AI daily limit set; prices loaded
- [ ] Backups scheduled and a restore tested
- [ ] No secrets in git
- [ ] README up to date (features, config, deploy, security)
- [ ] Privacy/terms text (who can see what)

### Every month
- [ ] Update Node.js and the server OS
- [ ] Review AI spend and top users
- [ ] Check errors in Admin → AI usage and server logs
- [ ] Test a backup restore
- [ ] Re-run the security tests and fuzzer

---

*Built and written during the Fluento project. Keep this file updated: every new bug → a new row in section 10 and, where possible, a new test.*
