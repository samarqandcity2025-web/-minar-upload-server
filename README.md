# Minar upload server (Vercel)

Serverless functions that let the Minar app forward an opened CAD file to the
company Telegram — built for Vercel's free Hobby plan.

Because Vercel functions cap the request body at ~4.5 MB, large CAD files go
**straight from the browser to Vercel Blob**, and the function then asks Telegram
to fetch that file (Telegram URL mode, up to 20 MB) and posts it to the chat,
with the user's login and the time. The blob is deleted right after.

```
browser --(big file)--> Vercel Blob
browser --(blobUrl + login)--> /api/notify --> Telegram sendDocument(url) --> chat
```

Accounts (register once, then login) are handled **inside the app on each
computer** — no database needed here.

## Functions

- `POST /api/blob-upload` — issues a short-lived Blob upload token (checks `MINAR_APP_KEY`)
- `POST /api/notify` — `{appKey, login, name, time, blobUrl}` → Telegram, then deletes the blob
- `GET /api/health` — status: are the env vars present?

## Deploy

1. Push this folder to GitHub (already done for this project).
2. On **vercel.com** → **Add New… → Project** → import the GitHub repo.
3. **Storage → Create → Blob** store, and connect it to this project. Vercel then
   adds `BLOB_READ_WRITE_TOKEN` automatically.
4. **Settings → Environment Variables** — add:
   | Name | Value |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | bot token from BotFather |
   | `TELEGRAM_CHAT_ID` | `6156628475` |
   | `MINAR_APP_KEY` | the same long random string set in `minar-app/minar-upload.js` |
5. **Redeploy** so the env vars take effect.
6. Check: open `https://<your-app>.vercel.app/api/health` →
   `{"ok":true,"telegram":true,"appKey":true,"blob":true}`.

## Point the app at the server

In Minar's login screen → **Server address** → paste `https://<your-app>.vercel.app`.
The `MINAR_APP_KEY` is set in `minar-app/minar-upload.js` (`APP_KEY`).

## Limits

- Telegram URL mode: file must be ≤ 20 MB.
- Vercel Blob free tier covers storage + bandwidth for moderate team use; each
  file costs ~2× its size in bandwidth (upload + Telegram fetch).
- Accounts live per computer (matches “saved on this computer”); the same person
  registers again on another machine.
