'use strict';
// Quick status check: open https://<your-app>.vercel.app/api/health
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    ok: true,
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    appKey: Boolean(process.env.MINAR_APP_KEY),
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
  });
};
