'use strict';
// A Blob URL that a program may hand to this server (security review, 20 Nov 2026). The programs only upload where
// api/blob-upload lets the app key write — minar/<login>/<file> (Minar drawings) and minar-3d/<n>.json (3D links) — so a URL
// the server fetches or deletes for a program must be a Vercel Blob URL under one of those paths. Anything else (another
// prefix such as minar-bot/, minar-accounts/, minar2-backup/, minar-docs/ or minar2-update/, plain http, any other host) is
// refused: no server-side fetch of arbitrary URLs and no deleting of the server's own files by URL.
const ALLOWED = ['minar/', 'minar-3d/'];

function ownUpload(url, prefixes = ALLOWED) {
  let u;
  try { u = new URL(String(url || '')); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.port) return false;
  if (!/^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/.test(u.hostname)) return false;
  let path;
  try { path = decodeURIComponent(u.pathname.slice(1)); } catch { return false; }
  if (path.includes('..') || path.includes('\\')) return false;
  return prefixes.some((p) => path.startsWith(p));
}

module.exports = { ownUpload, ALLOWED };
