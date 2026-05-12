# Fish Farm Inventory Management System

WhatsApp-driven operations system for a catfish and tilapia farm in Ghana.
Workers log daily activity via WhatsApp; the farm owner receives automated
alerts, daily summaries, and AI-generated weekly recommendations. A
mobile-friendly web dashboard provides a real-time overview.

## Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: Supabase (PostgreSQL)
- **WhatsApp**: Meta WhatsApp Cloud API (webhook)
- **AI**: Anthropic Claude API
- **Scheduler**: node-cron

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in all values in `.env`:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (not the anon key) |
| `WHATSAPP_PHONE_ID` | Meta phone number ID |
| `WHATSAPP_TOKEN` | Meta permanent access token |
| `WHATSAPP_VERIFY_TOKEN` | Any random string — used to verify the webhook |
| `OWNER_PHONE` | Farm owner's WhatsApp number with country code, e.g. `233241234567` |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `PORT` | Server port (default 3000) |

### 3. Run the database migration

Copy the contents of `supabase/migrations/001_initial_schema.sql` and run
it in the Supabase SQL editor, or use the Supabase CLI:

```bash
supabase db push
```

### 4. Configure the WhatsApp webhook

In Meta for Developers → WhatsApp → Configuration:
- **Callback URL**: `https://your-domain/webhook`
- **Verify token**: the value you set for `WHATSAPP_VERIFY_TOKEN`
- Subscribe to the **messages** webhook field

### 5. Start the server

```bash
npm start
# or for dev with auto-restart:
npm run dev
```

The dashboard is available at `http://localhost:3000/dashboard`.

---

## WhatsApp Commands

| Command | Example | Description |
|---|---|---|
| `feed [pond] [kg]` | `feed A1 50` | Log feeding |
| `dead [pond] [count]` | `dead A1 3` | Log mortalities |
| `count [pond] [number]` | `count A1 480` | Update fish count |
| `harvest [pond] [kg] [count] [buyer] [price]` | `harvest A1 200 150 AcraFish 30` | Log harvest |
| `stock` | `stock` | Check feed inventory |
| `ponds` | `ponds` | List active ponds |
| `help` | `help` | Show command list |

---

## Automated Reports

| Time (UTC / Ghana) | Event |
|---|---|
| 6:00 AM daily | Feed runway alert if < 10 days remaining; missed feeding check; mortality spike check |
| 7:00 PM daily | Daily summary to owner: total feed, mortalities, missed ponds, feed snapshot |
| 8:00 PM Sunday | AI-generated weekly report via Claude |

---

## Deploy on Railway

1. Push this repo to GitHub
2. Create a new Railway project from the repo
3. Set all environment variables in Railway's Variables tab
4. Railway auto-detects Node.js — it will run `npm start`
5. Point your WhatsApp webhook to the Railway-provided public URL

---

## Project Structure

```
fishfarm-system/
├── src/
│   ├── server.js          # Express entrypoint + WhatsApp webhook
│   ├── parser.js          # WhatsApp command parser
│   ├── whatsapp.js        # Meta API send/receive utilities
│   ├── scheduler.js       # Cron jobs for alerts and reports
│   ├── ai.js              # Claude API weekly report
│   ├── handlers/
│   │   ├── feed.js
│   │   ├── mortality.js
│   │   ├── harvest.js
│   │   ├── stock.js
│   │   ├── ponds.js
│   │   └── count.js
│   ├── db/
│   │   └── supabase.js    # All DB query functions
│   ├── alerts/
│   │   └── stockAlert.js  # Feed runway + mortality + missed feeding alerts
│   └── api/
│       └── routes.js      # Dashboard REST endpoints
├── dashboard/
│   └── index.html         # Single-page dashboard
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
├── .env.example
└── package.json
```
