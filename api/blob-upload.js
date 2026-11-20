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
        // Minar 2 update files (user, 17 Nov 2026: automatic update): only with the release key, only under minar2-update/, fixed names.
        const REL = process.env.MINAR2_RELEASE_KEY || '';
        if (p.release !== undefined) {
          const ok = REL.length >= 16 && typeof p.release === 'string' && p.release.length === REL.length && require('crypto').timingSafeEqual(Buffer.from(p.release), Buffer.from(REL));
          if (!ok || !/^minar2-update\/[A-Za-z0-9._-]+$/.test(pathname)) throw new Error('unauthorized');
          return { allowedContentTypes: ['application/octet-stream', 'text/yaml'], maximumSizeInBytes: 400 * 1024 * 1024, addRandomSuffix: false, cacheControlMaxAge: 60 };
        }
        if (!APP_KEY || p.appKey !== APP_KEY) throw new Error('unauthorized');
        // The app key ships inside the programs, so it may only write where the programs write (security review, 20 Nov 2026:
        // any pathname let a key holder plant minar-bot/state-*, minar-accounts/*, minar2-backup/*, minar-docs/*, minar2-update/*):
        // Minar's drawings minar/<login>/<time>-<name> and the 3D links minar-3d/<n>.json — always with a random suffix.
        if (!/^minar\/[^/]{1,200}\/[^/]{1,300}$/.test(pathname) && !/^minar-3d\/\d{1,16}\.json$/.test(pathname)) throw new Error('unauthorized');
        return {
          addRandomSuffix: true,
          allowedContentTypes: [
            'application/octet-stream', 'application/pdf',
            'image/vnd.dwg', 'application/acad', 'application/dxf', 'text/plain', 'application/json',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
