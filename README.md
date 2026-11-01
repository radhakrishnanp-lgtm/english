# English Path — interactive English grammar course

A self-learning English grammar website: **115 units** from beginner to intermediate, each with a lesson, examples, common mistakes and **Easy / Medium / Hard** practice, plus an **AI tutor** that works with any OpenAI-compatible API (OpenRouter, OpenAI, Groq, DeepSeek, local Ollama…).

Everyone has their **own account and private space**: progress, notes, bookmarks, saved sentences, results, chats and AI memory. An **admin console** manages accounts, AI access and AI spend.

- **No build step, no npm dependencies, no Postgres.** One Node.js process + one SQLite file.
- Runs in any modern browser, installs as a phone app (PWA), light and dark themes.

> The course follows the unit order of a standard elementary grammar syllabus, but **all explanations, examples and exercises are original** (written for this project). No text from any published book is included.

## Features

**Learning**
- 115 units in 19 sections, 2,070 practice questions (6 per level), 6 reference pages
- Lesson view with collapsible sections, "In this lesson" contents, font size, read-aloud
- 📖 **Book view** — lesson on the left page, exercises on the right, like a textbook
- 🔈 Tap any word to hear it; 🔊 listen to any example (normal or 🐢 slow); 🎤 say it and get a score
- 🗺️ Visual tab: grammar mind map, **AI flowchart** ("which form do I use?"), and a **drawing canvas** saved per unit
- Question types: multiple choice, fill in the blank (one or two blanks), word order, correct the mistake
- 💡 Hint and 🤖 **AI hint** (gives a clue, never the answer), "Ask AI why" after a wrong answer
- 📝 **Unit exam** (mixed levels, optional timer, optional extra AI questions)
- 📊 **Results history** for every test, with an **AI analysis** of each result
- Practice hub: review mistakes (spaced repetition: 1, 3, 7 days), daily mix, 60-second speed round, level test, irregular verbs (flashcards / groups / typing drill / list), dictation, speaking
- Dashboard: daily XP goal, streak, 4-week activity, focus areas, badges

**AI tutor**
- 🎯 **Unit mode** — focuses only on the open unit's content; off-topic questions are redirected
- 🌍 **General mode** — anything about English
- Multiple chats per mode ("＋ New" or continue an old chat), rename/delete
- 🧠 **Memory** — short notes about the learner, kept per unit and in general, used in new chats; viewable and editable
- 💭 **Reasoning** switch (sends `reasoning: {enabled: true}`, shows the model's thinking in a collapsible box)
- 🎙️ **Live talk** — hands-free voice conversation (browser speech recognition + speech synthesis)
- Quick actions (explain simply, more examples, quiz me, check my sentence, explain in my language, dialogue, summary notes…)
- ✨ Unlimited AI practice quizzes at any level

**Never forget (spaced review)**
- 🧠 **Today's review** combines three research-backed methods: *retrieval practice* (write what you remember first, AI checks it), *spaced repetition* (a forgetting-curve model like FSRS/Anki schedules each unit, irregular verb and saved sentence just before you would forget it) and *interleaving* (questions from different units mixed together)
- Remembering grows the gap (harder recalls grow it more); forgetting shortens it
- Memory-strength bars on the course map and in every unit; a due-count badge in the menu

**Games in every unit**: ⚡ Quick Fire (lives, timer, combos), 🃏 Memory Match (sentence halves), 🧩 Sentence Builder (word-order race) — best scores and XP.

**Typing and writing**: ⌨️ "Type answers" mode turns choice and word-order questions into typing; ✍️ after any question, write your own sentence, save it and let the AI check it (drafts are kept automatically).

**Auto-save**: the app remembers the page and scroll position you were on ("Continue where you left off") and every unfinished quiz/exam ("You stopped at question 4 of 6 — continue?").

**Admin console** (🛡️ Admin)
- Only admins create accounts (sign-up can be opened if you want); the **first account becomes admin**
- Create, edit, reset passwords, turn accounts on/off, make admins, delete
- Turn the **AI tutor on/off per user** and set a **daily AI token limit** (per user or a default)
- **Live tracker**: who is online and which page they are on; per-user page with course map, activity, tests, chats
- **AI usage**: every AI call with user, feature, model, input/output/reasoning tokens, **cost**, time and errors; CSV export; totals per day / model / feature / user
- **AI conversations**: read every learner's chats (with the model's thinking)
- **Settings**: shared AI provider (OpenRouter key/model), prices per 1M tokens (one click to load from OpenRouter), who can sign up

**Personal space**: bookmarks, important units, colour notes (also from highlighted text), saved sentences/AI answers (flashcards), mistakes list, recently viewed, results, data export (JSON), account deletion.

## Quick start

Needs **Node.js 22.5 or newer** (built-in `node:sqlite`).

```bash
git clone <this repo> english-path && cd english-path
AI_API_KEY=sk-or-v1-... AI_MODEL=qwen/qwen3.8-omni-flash npm start
```

Open http://localhost:3000. The **first account you create becomes the admin**; after that, accounts are created in 🛡️ Admin → Users. Without `AI_API_KEY`, each user can add their own key in **Settings → AI Tutor**.

```bash
npm test               # API + content tests (uses a fake AI server)
npm run check-content  # validate all lesson files
```

## Configuration

All settings are environment variables — see [`.env.example`](.env.example).

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | where to listen |
| `DATA_DIR` | `./data` | SQLite database + encryption key |
| `APP_SECRET` | auto | encrypts users' own API keys |
| `SECURE_COOKIES` | `false` | set `true` behind HTTPS |
| `ALLOW_REGISTRATION` | `false` | open sign-up (admins can change this in Admin → Settings) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | – | create (or promote) an admin at start-up |
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` | default provider |
| `AI_API_KEY` | – | default key for all users |
| `AI_MODEL` | `openai/gpt-4o-mini` | e.g. `qwen/qwen3.8-omni-flash` |
| `ALLOW_USER_AI` | `true` | users may set their own URL/key/model |
| `ALLOW_PRIVATE_AI_URL` | `false` | allow user URLs on localhost/private IPs (e.g. Ollama) |
| `TRUST_PROXY` | `true` | use `X-Forwarded-For` from a proxy on the same machine for per-IP limits |
| `REGISTER_LIMIT` | `10` | sign-up attempts per IP per hour (when sign-up is open) |
| `WRITE_LIMIT` | `300` | write requests per user per minute |

### AI usage and cost

Every AI call is logged with tokens and cost. OpenRouter reports the real cost of each call (`usage.cost`), which is used directly. For other providers the cost is calculated from the prices in **Admin → Settings** (USD per 1M tokens; "Get prices from OpenRouter" fills them in). If a provider doesn't report tokens, they are estimated (shown with `~`).

### OpenRouter

Base URL `https://openrouter.ai/api/v1`, your `sk-or-v1-…` key, model e.g. `qwen/qwen3.8-omni-flash`. In Settings you can tap **Load models** to pick from the provider's list and **Test connection**. Turn on **Reasoning** to send `reasoning: {"enabled": true}`; the thinking stream (`delta.reasoning` / `delta.reasoning_content`) is shown in a collapsible "Thinking" box. (Reasoning details are not sent back on the next turn; each turn reasons fresh.)

## Deploy on your own VPS

```bash
# as root
adduser --system --group englishpath
git clone <this repo> /opt/english-path
mkdir -p /var/lib/english-path && chown englishpath: /var/lib/english-path
cp /opt/english-path/.env.example /opt/english-path/.env   # edit it
cp /opt/english-path/deploy/english-path.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now english-path
cp /opt/english-path/deploy/nginx.conf /etc/nginx/sites-available/english-path   # edit server_name
ln -s ../sites-available/english-path /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx
certbot --nginx -d english.example.com
```

`proxy_buffering off` in the nginx config is required so AI answers stream smoothly.

**Backup:** the whole site state is `DATA_DIR/app.db` (+ `secret.key`). Back it up with
`sqlite3 /var/lib/english-path/app.db ".backup /backups/app-$(date +%F).db"` (or stop the service and copy the file).

**Update:** `cd /opt/english-path && git pull && systemctl restart english-path`.

## Project layout

```
server/      index.js (routes), db.js (SQLite schema), auth.js, ai.js (provider + prompts), content.js (lesson parser), http.js
content/     01-present.txt … 10-reference.txt — all course content in a simple text format (see top of server/content.js)
public/      index.html, css/app.css, js/*.js (no framework, ES modules)
test/        api.test.js
deploy/      systemd unit and nginx config
```

### Editing lessons

Each unit in `content/*.txt` looks like this:

```
# 12 | Past simple: negatives and questions | Past | A1
summary: One line.
[learn]
## Heading
Text with **bold**, tables | like | this |, lists, > tips, and "= example" lines (with a 🔊 button).
[examples]
Sentence. :: optional note
[mistakes]
Wrong. => Right. | Also right. :: why
[easy] / [medium] / [hard]
mc: She ___ here. | *is | are | am :: explanation      (* = correct option)
fill: Where ___ you ___ (go)? = are, going :: explanation
order: This is my bag. :: hint
fix: He are tired. => He is tired. | He's tired. :: why
```

Run `npm run check-content` after editing; it reports format errors with file and line numbers.

## Security

Tested with `npm test`: API tests, a security suite (`test/security.test.js`) and a fuzzer (`test/fuzz.test.js`) that calls every API route with hostile input as a visitor, a learner and an admin. There are no npm dependencies to audit.

- **Accounts:** scrypt password hashes; at least 8 characters, not the user name, not common passwords. Login takes the same time for unknown users (no user-name discovery). Only failed logins count towards lockout (10 per user / 30 per IP in 10 minutes). Changing a password logs out other devices; turning an account off logs it out at once.
- **Sessions:** random 256-bit token, only its SHA-256 is stored; cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` when `SECURE_COOKIES=true`.
- **CSRF:** JSON-only request bodies, `SameSite` cookies, and requests a browser marks as cross-site (`Origin` / `Sec-Fetch-Site`) are refused.
- **XSS:** all user and AI text is escaped before display; strict Content-Security-Policy (`script-src 'self'`, no inline scripts, `frame-ancestors 'none'`, `object-src 'none'`), plus `X-Frame-Options`, `nosniff`, `Permissions-Policy` and HSTS (with HTTPS).
- **Access control:** every record is checked against its owner; admin routes check the admin role on every request.
- **SSRF:** a learner's own AI URL may not reach private/internal addresses. Every IP is checked when connecting (no DNS-rebinding gap) and redirects are never followed. Set `ALLOW_PRIVATE_AI_URL=true` only if you need a local model such as Ollama.
- **Cost protection:** with the shared key, learners can't change the model; per-user AI switch and daily token limits; AI rate limit per user.
- **Abuse limits:** request size limits, per-user write rate limit, caps on notes, saved items and unfinished quizzes, header/request timeouts against slow-request attacks.
- **Secrets:** API keys are encrypted at rest (AES-256-GCM) and never sent to the browser.

Behind nginx, keep `HOST=127.0.0.1` so the app is only reachable through the proxy (the per-IP limits use the address nginx adds to `X-Forwarded-For`).

## Browser support

Everything works in current Chrome, Edge, Firefox and Safari. Speech recognition (🎤 speaking, 🎙️ live talk) needs Chrome, Edge or Safari; other browsers still get read-aloud.
