# METRO MICHIGAN PROPERTY BUYERS

Lead-generation website for a cash home-buying business. Homeowners submit their property
details through the site, the lead is stored in MongoDB, and the team is notified by email and
SMS in real time. An admin dashboard lists and triages incoming leads, and a Gemini-backed chat
assistant answers common questions and points visitors to the offer form.

---

## Contents

- [What the site does](#what-the-site-does)
- [Tech stack](#tech-stack)
- [Project layout](#project-layout)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Running it](#running-it)
- [API reference](#api-reference)
- [Chat assistant](#chat-assistant)
- [Reviews and moderation](#reviews-and-moderation)
- [Contact form](#contact-form)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## What the site does

**Public pages**

| Page | Path |
| --- | --- |
| Home | `index.html` |
| How It Works | `pages/how-it-works/how-it-works.html` |
| Sell Your House (lead form) | `pages/sell-your-house/sell.html` |
| Testimonials | `pages/testimonials/Testimonials.html` |
| FAQ | `pages/faq/faq.html` |
| Contact | `pages/contact/contact.html` |
| About | `pages/about/about.html` |
| Thank You (post-submission) | `pages/thank-you/thank-you.html` |
| Privacy Policy | `pages/legal/privacy.html` |
| Terms of Service | `pages/legal/terms.html` |

**Admin pages** (JWT-protected, `Disallow`ed in `robots.txt`)

| Page | Path |
| --- | --- |
| Login | `pages/admin/admin-login.html` |
| Dashboard | `pages/admin/admin-dashboard.html` |

**What happens when a lead is submitted**

1. The browser posts to `POST /api/leads`.
2. `express-validator` validates and sanitises the payload.
3. The lead is saved to MongoDB.
4. A `new_lead` event is emitted over Socket.io, so any open dashboard updates live.
5. A confirmation email goes to the seller and a notification email to the admin.
6. If the seller ticked SMS consent, a confirmation text is sent; the admin is texted either way.
7. The browser redirects to the thank-you page.

Email and SMS failures are logged but never fail the request — the lead is already saved.

---

## Tech stack

**Frontend** — vanilla HTML, CSS, and JavaScript. No framework and no build step. Fonts are
Bebas Neue (display) and Source Sans 3 (body); the palette lives in the `:root` block of
`assets/css/style.css`.

**Backend** — Node.js 18+, Express 4, Mongoose 7, Socket.io 4. Security middleware: `helmet`,
`cors`, `express-rate-limit`, `express-mongo-sanitize`, `express-validator`. Auth is JWT via
`jsonwebtoken` with `bcryptjs` password hashing.

**Database** — MongoDB Atlas (M0 free tier works).

**Integrations** — Nodemailer for email, ClickSend for SMS, Google Gemini for the chat assistant.

---

## Project layout

```
.
├── index.html                  Home page
├── assets/
│   ├── css/style.css           Design system (colors, fonts, components)
│   └── js/
│       ├── config.js           Resolves which API origin to call
│       ├── chat-widget.js      Floating chat assistant (shared by all pages)
│       └── Form.js             Home page lead form
├── pages/                      One folder per page, each with its own assets
├── vercel.json                 Static hosting config (routing, headers, redirects)
├── sitemap.xml / robots.txt
└── backend/
    ├── Server.js               Entry point: middleware, routes, Socket.io, startup
    ├── Init.js                 First-run admin bootstrap (npm run init)
    ├── config/database.js      Mongo URI validation, DNS, connection options
    ├── middleware/Auth.js      authMiddleware (JWT) + authorize (roles)
    ├── models/                 Admin, Lead, Testimonial, ChatLog
    ├── routes/                 admin, leads, chat, sms, testimonials
    ├── utils/                  email.js (Nodemailer), sms.js (ClickSend)
    └── scripts/                One-off admin maintenance scripts
```

Each page folder carries its own copy of `style.css`. They are independent — editing
`assets/css/style.css` does not change `pages/faq/assets/css/style.css`.

---

## Local setup

**Prerequisites:** Node.js 18 or newer, and a MongoDB Atlas cluster (or a local `mongod`).

```bash
git clone <repo-url>
cd cash-home-buyer-website/backend
npm install
cp .env.example .env
```

Then fill in `.env` (see below) and create the first admin user:

```bash
npm run init
```

The frontend has no build step and no dependencies to install.

---

## Environment variables

All backend config lives in `backend/.env`. `backend/.env.example` lists every key with
placeholder values. `.env` is gitignored — never commit real credentials.

### Required

| Variable | Description |
| --- | --- |
| `MONGODB_URI` | Atlas connection string, including the database name. URL-encode any reserved characters in the password. |
| `JWT_SECRET` | Long random string used to sign admin tokens. The server falls back to an insecure default and warns if unset — always set it. |

### Admin bootstrap (used by `npm run init`)

| Variable | Description |
| --- | --- |
| `ADMIN_USERNAME` | Login username |
| `ADMIN_PASSWORD` | Initial password |
| `ADMIN_EMAIL` | Must be a Gmail or Yahoo address — `routes/admin.js` enforces this |
| `ADMIN_FULL_NAME` | Display name (optional) |

### Email (Nodemailer)

| Variable | Description |
| --- | --- |
| `EMAIL_SERVICE` | e.g. `gmail` |
| `EMAIL_USER` | Sending account |
| `EMAIL_PASS` | App password, not the account password |
| `EMAIL_FROM` | From header |
| `ADMIN_EMAIL` | Where lead notifications are sent |

### SMS (ClickSend)

| Variable | Description |
| --- | --- |
| `CLICKSEND_USERNAME` | ClickSend account username |
| `CLICKSEND_API_KEY` | ClickSend API key |
| `CLICKSEND_FROM_NUMBER` | Sender ID or number |
| `ADMIN_PHONE` | Where lead alerts are texted |
| `SEND_SMS` | `false` disables sending — useful in development |

### Chat assistant (Gemini)

| Variable | Default | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Server-side only. Without it `/api/chat` returns 503 and the widget shows its fallback message. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model id |
| `CHAT_RATE_LIMIT_PER_MIN` | `10` | Chat messages allowed per IP per minute |
| `CONTACT_RATE_LIMIT` | `5` | Successful contact-form sends per IP per 15 minutes |
| `CHAT_LOG_ENABLED` | `false` | `true` saves transcripts to the `ChatLog` collection |
| `CHAT_LOG_TTL_DAYS` | `90` | Days transcripts are retained before Mongo expires them |

### Deployment

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `5000` | Server port |
| `NODE_ENV` | `development` | |
| `FRONTEND_URL` | `http://localhost:5000` | Public site URL; always CORS-allowed and used for sitemap/robots |
| `ALLOWED_ORIGINS` | — | Comma-separated extra origins allowed to call the API |
| `ALLOW_VERCEL_PREVIEWS` | `true` | Auto-allow `*.vercel.app` preview deploys; set `false` to lock down |
| `TRUST_PROXY_HOPS` | `1` | Proxy hops to trust for client IPs. Required for correct rate limiting on Render/Railway/Fly. |
| `MONGODB_DNS_SERVERS` | — | Override DNS resolvers for `mongodb+srv` lookups when SRV resolution fails |

---

## Running it

```bash
cd backend
npm run dev      # nodemon, restarts on change
npm start        # plain node
```

Express serves both the API and the static site, so everything is on one origin locally:

- Site — <http://localhost:5000>
- Admin — <http://localhost:5000/pages/admin/admin-login.html>
- Health — <http://localhost:5000/api/health>

Other scripts:

```bash
npm run init         # create the first admin from .env
npm run test-email   # send a test email
npm run test-sms     # send a test SMS
```

To open the HTML files directly (or through a separate static server) instead, set
`PRODUCTION_API_BASE_URL` in `assets/js/config.js` or add
`<meta name="hsd-api-base" content="http://localhost:5000">` to the page — otherwise the
browser has no backend to talk to.

---

## API reference

Base path `/api`. All routes are rate limited to 100 requests per 15 minutes per IP;
`/api/chat` is limited separately and more tightly.

| Method | Endpoint | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Public | Server and database status |
| `POST` | `/api/leads` | Public | Submit a lead from the website form |
| `GET` | `/api/leads` | **JWT** | List leads, with filtering and pagination |
| `GET` | `/api/leads/stats/summary` | **JWT** | Totals, today's count, and counts by status |
| `GET` | `/api/leads/:id` | **JWT** | Single lead |
| `PATCH` | `/api/leads/:id/status` | **JWT** | Update lead status |
| `POST` | `/api/leads/:id/notes` | **JWT** | Add a note to a lead |
| `POST` | `/api/chat` | Public | Send a chat message, get a reply |
| `POST` | `/api/contact` | Public | Send a contact-form message to `ADMIN_EMAIL` |
| `POST` | `/api/admin/login` | Public | Authenticate, returns a JWT |
| `GET` | `/api/admin/logs` | **JWT** | Login audit log |
| `GET` | `/api/testimonials` | Public | Approved testimonials only |
| `POST` | `/api/testimonials` | Public | Submit a testimonial (held for approval) |
| `GET` | `/api/testimonials/admin` | **JWT** | Moderation queue (`?status=pending|approved|all`) |
| `PATCH` | `/api/testimonials/:id/approve` | **JWT** | Approve, unapprove, or feature a review |
| `DELETE` | `/api/testimonials/:id` | **JWT** | Delete a review |
| `POST` | `/api/send-sms` | Public | Send an SMS |

Authenticate by sending the token from `/api/admin/login` as `Authorization: Bearer <token>`.

Every endpoint that reads or mutates lead data requires a valid JWT. To confirm:

```bash
curl -i http://localhost:5000/api/leads          # 401
curl -i -H "Authorization: Bearer <token>" http://localhost:5000/api/leads   # 200
```

---

## Chat assistant

`POST /api/chat` takes `{ message, history, sessionId }` and returns `{ reply }`. `history` is a
short rolling window of recent turns (`{ role: 'user' | 'model', text }`), not the full
transcript — the server keeps the last 8 turns and ignores the rest.

The system instruction in `backend/routes/chat.js` constrains the assistant: it can explain the
process, timelines, fees, and property types, but it must never quote a dollar figure, guarantee
an outcome, or give legal, tax, or financial advice. When a visitor seems ready to sell it points
them to `/pages/sell-your-house/sell.html`. Edit that constant to change the assistant's scope
or tone.

The widget is `assets/js/chat-widget.js`. It injects its own markup and styles, so adding it to a
page is two script tags:

```html
<script src="/assets/js/config.js"></script>
<script src="/assets/js/chat-widget.js" defer></script>
```

The API key is only ever read server-side. The browser talks to your backend, never to Google.

---

## Reviews and moderation

Testimonials submitted from the public page are saved with `isApproved: false` and do not appear
anywhere until an admin approves them. Moderate them in the dashboard under the **Reviews** tab:
filter by pending, approved, or all, then approve, unapprove, or delete. The tab shows a red count
of pending reviews, and a live toast appears when a new one arrives.

`GET /api/testimonials` (the public endpoint) only ever returns `isApproved: true` records and
strips the submitter's email address.

---

## Contact form

`POST /api/contact` takes `{ name, email, phone?, message }`, validated with `express-validator`
the same way the lead form is. On success it emails the message to `ADMIN_EMAIL` with `replyTo`
set to the visitor (so Reply goes straight back to them) and sends the visitor an acknowledgement.
Both use the shared Nodemailer transport in `backend/utils/email.js`.

The form carries a hidden honeypot field; submissions that fill it are rejected. Rate limiting
counts only successful sends, so a mistyped email does not lock someone out.

If the admin email fails to send, the endpoint returns 502 and the page tells the visitor to call
instead — it never claims a message was delivered when it was not.

---

## Deployment

The frontend and backend deploy separately. Socket.io needs a persistent connection, so the
backend cannot run as Vercel serverless functions.

### Backend → Render

1. New Web Service, pointed at this repo, root directory `backend`.
2. Build `npm install`, start `npm start`.
3. Add every variable from `.env.example` in the Render dashboard. Set `NODE_ENV=production`,
   a strong `JWT_SECRET`, `TRUST_PROXY_HOPS=1`, and `FRONTEND_URL` to your Vercel domain.
4. In Atlas, allow Render's outbound IPs (or `0.0.0.0/0` on the free tier).
5. Check `https://<service>.onrender.com/api/health`.

Render's free tier sleeps after inactivity, so the first request after idling takes ~30 seconds.

### Frontend → Vercel

1. Import the repo. Framework preset **Other**, root directory `./`, no build command.
2. `vercel.json` handles routing, redirects from the old URLs, and security headers.
   `.vercelignore` keeps `backend/` off the CDN.
3. Set `PRODUCTION_API_BASE_URL` in `assets/js/config.js` to your Render URL and redeploy.
4. Add the Vercel domain to `ALLOWED_ORIGINS` on Render.

### After deploying

- Submit a test lead and confirm it reaches the dashboard, the email, and the SMS.
- Confirm `GET /api/leads` returns 401 without a token.
- Open the chat widget and send a message.

---

## Troubleshooting

**`MongoDB configuration error` on startup** — `MONGODB_URI` is missing, malformed, or has no
database name. Special characters in the password must be URL-encoded.

**SRV lookup fails** — set `MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8`. Some ISPs and corporate
networks block SRV records.

**`Port 5000 is already in use`** — stop the other process or set a different `PORT`.

**Forms work locally but not in production** — `assets/js/config.js` still points at localhost,
or the Vercel domain is missing from `ALLOWED_ORIGINS`. A CORS rejection is logged server-side as
`Blocked CORS request from origin: ...`.

**Chat replies with the fallback message** — `GEMINI_API_KEY` is unset or invalid. The real error
is in the server log as `Gemini chat error (...)`; the browser only ever sees the friendly text.

**Emails do not send** — Gmail needs an App Password with 2FA enabled, not the account password.
Run `npm run test-email` to check in isolation.

**Admin login rejects a valid-looking email** — `routes/admin.js` only accepts `@gmail.com` and
`@yahoo.com` addresses.

---

## License

MIT — see [LICENSE](LICENSE).
