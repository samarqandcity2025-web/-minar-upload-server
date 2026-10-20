'use strict';
// Vercel serverless function: issues a short-lived client token so the browser
// can upload a large file straight to Vercel Blob (bypassing the 4.5 MB request
// limit on serverless functions). Protected by the shared MINAR_APP_KEY.
const { handleUpload } = require('@vercel/blob/client');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }

  const APP_KEY = process.env.MINAR_APP_KEY || '';
  try {
    const json = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let p = {};
        try { p = clientPayload ? JSON.parse(clientPayload) : {}; } catch {}
        if (!APP_KEY || p.appKey !== APP_KEY) throw new Error('unauthorized');
        return {
          allowedContentTypes: [
            'application/octet-stream', 'application/pdf',
            'image/vnd.dwg', 'application/acad', 'application/dxf', 'text/plain',
          ],
          maximumSizeInBytes: 25 * 1024 * 1024,
          tokenPayload: JSON.stringify({ login: p.login || '' }),
        };
      },
      // The browser calls /api/notify itself after the upload, so no server
      // completion callback is needed here.
      onUploadCompleted: async () => {},
    });
    res.status(200).json(json);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
};
