# Minar upload server

Small zero-dependency Node server for the Minar app. It handles:

- `POST /api/register` — one-time account creation (requires `consent: true`)
- `POST /api/login` — returns a signed session token
- `POST /api/upload` — receives an uploaded file (base64) with the user's login
  and the time, and forwards it to a Telegram chat as a document
- `GET /api/health` — quick status check

The Telegram bot token lives **only on the server** (environment variables),
never in the browser app.

## 1. Create the Telegram bot

1. In Telegram open **@BotFather** → `/newbot` → follow the prompts → copy the
   **bot token**.
2. Start a chat with your new bot and send it any message (so it can message you).
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and copy
   the `chat.id` value. That is your `TELEGRAM_CHAT_ID`.
   (For a group/channel, add the bot there and read the negative chat id.)

## 2. Environment variables

Copy `.env.example` → `.env` (local) or set these in your host dashboard:

| Variable | Required | Meaning |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | bot token from BotFather |
| `TELEGRAM_CHAT_ID` | yes | chat that receives the files |
| `MINAR_SECRET` | yes | long random string, signs login tokens |
| `PORT` | no | default 8787 |
| `MINAR_DATA_DIR` | no | where `users.json` is stored (default `./data`) |
| `MINAR_MAX_BYTES` | no | max request body, default 60 MB |

## 3. Run locally

```
cd minar-upload-server
# set the env vars first, then:
npm start
```

Check: open `http://localhost:8787/api/health`.

## 4. Deploy

**Recommended: Railway or Render** (they run a normal long-lived Node server, so
large CAD files pass through).

Railway: New Project → Deploy from repo (or `railway up`) → set the env vars →
start command `node server.js`. Add a persistent **Volume** mounted at a folder
and point `MINAR_DATA_DIR` there, so `users.json` survives restarts.

Render: New → Web Service → Build command empty, Start command `node server.js`
→ add env vars → add a Disk for `MINAR_DATA_DIR`.

### About Vercel / Netlify

Their serverless functions cap the **request body at about 4.5–6 MB**, and the
filesystem is not persistent (so `users.json` would be lost). Minar CAD files
are often 12 MB or more, so the plain `/api/upload` here will fail there.

If you must use Vercel/Netlify, two changes are needed (ask and I will add them):

1. Store users in a hosted database (e.g. Vercel KV / Postgres) instead of a file.
2. Upload large files to blob storage (e.g. Vercel Blob) from the browser, then
   have the function pass that URL to Telegram's `sendDocument` (URL mode, up to
   20 MB). This avoids the body-size cap.

## 5. Point the app at the server

Open Minar → on the login screen expand **“Server address”** and paste your
deployed URL (e.g. `https://minar-upload.up.railway.app`). It is remembered in
that browser. You can also hard-code it in `minar-app/minar-upload.js`
(`DEFAULT_SERVER_URL`).

## Notes / limits

- `users.json` is a simple store; fine for a company team. For many users or
  serverless hosting, switch to a real database.
- Passwords are hashed with scrypt; tokens are HMAC-signed and expire in 180 days.
- The upload endpoint only runs after a successful login (valid token).
- CORS is open (`*`) so the local `index.html` / EXE can reach it. Restrict the
  origin if you want to lock it to specific deployments.
