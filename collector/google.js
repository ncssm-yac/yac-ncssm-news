// Read-only access to the "NCSSM News inbox" Drive folder, as the yakkety
// service account. No packages: the sign-in is a signed JWT exchanged for an
// access token (same approach as yac-attendance). The key is never printed.
'use strict';

const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE = 'https://www.googleapis.com/drive/v3';

const b64 = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');

function signedJwt(key, nowMs) {
  const iat = Math.floor(nowMs / 1000);
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' +
    b64({ iss: key.client_email, scope: SCOPE, aud: key.token_uri || TOKEN_URL, iat, exp: iat + 3600 });
  return unsigned + '.' + crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
}

async function check(res, what) {
  if (res.ok) return res;
  let detail = '';
  try { const body = await res.json(); detail = (body.error && (body.error.message || body.error_description || body.error)) || ''; } catch (e) { /* not JSON */ }
  throw new Error(what + ' failed: ' + res.status + (detail ? ' ' + String(detail).slice(0, 200) : ''));
}

/** Sign in and return { listFolder, readJson }. */
async function connect(keyJson, { fetch: f = fetch, now = Date.now() } = {}) {
  let key;
  try { key = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson; } catch (e) { throw new Error('YAKKETY_GOOGLE_KEY is not valid JSON'); }
  if (!key || !key.client_email || !key.private_key) throw new Error('YAKKETY_GOOGLE_KEY is missing client_email or private_key');

  const res = await check(await f(key.token_uri || TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signedJwt(key, now) }).toString()
  }), 'Google sign-in');
  const { access_token: token } = await res.json();
  const auth = { Authorization: 'Bearer ' + token };

  return {
    /** Files directly in a folder: [{ id, name, modifiedTime }]. */
    async listFolder(folderId) {
      const files = [];
      let pageToken = '';
      do {
        const params = new URLSearchParams({
          q: "'" + folderId + "' in parents and trashed = false", fields: 'nextPageToken,files(id,name,modifiedTime)',
          pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true'
        });
        if (pageToken) params.set('pageToken', pageToken);
        const body = await (await check(await f(DRIVE + '/files?' + params, { headers: auth }), 'Listing the inbox folder')).json();
        files.push(...(body.files || []));
        pageToken = body.nextPageToken || '';
      } while (pageToken);
      return files;
    },
    /** A JSON file's contents. */
    async readJson(fileId) {
      const res = await check(await f(DRIVE + '/files/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true', { headers: auth }), 'Reading an inbox file');
      return JSON.parse(await res.text());
    }
  };
}

module.exports = { connect, signedJwt, SCOPE, TOKEN_URL };
