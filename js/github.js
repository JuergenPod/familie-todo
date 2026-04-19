// GitHub Contents API wrapper with UTF-8 safe base64 and retry.

import { config } from './config.js';

const API = 'https://api.github.com';

function headers() {
  const pat = config.get('pat');
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${pat}`,
  };
}

function b64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64Decode(b64) {
  const clean = (b64 || '').replace(/\n/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function url() {
  const { owner, repo, path } = config.getAll();
  return `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function mkErr(code, message, cause) {
  const e = new Error(message);
  e.code = code;
  if (cause) e.cause = cause;
  return e;
}

async function withRetry(fn, { retries = 2 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err.code === 'AUTH' || err.code === 'CONFLICT' || err.code === 'NOT_FOUND') throw err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
  }
  throw lastErr;
}

export const github = {
  async getFile() {
    return withRetry(async () => {
      let res;
      try {
        res = await fetch(url(), { headers: headers(), cache: 'no-store' });
      } catch (err) {
        throw mkErr('NETWORK', 'Netzwerkfehler beim Laden.', err);
      }
      if (res.status === 404) throw mkErr('NOT_FOUND', 'Datei existiert noch nicht.', null);
      if (res.status === 401 || res.status === 403) throw mkErr('AUTH', 'PAT ungültig oder unzureichende Rechte.');
      if (!res.ok) throw mkErr('NETWORK', `GitHub antwortete mit ${res.status}.`);
      const j = await res.json();
      const content = b64Decode(j.content || '');
      let json;
      try { json = JSON.parse(content || '{}'); } catch { json = {}; }
      return { json, sha: j.sha };
    });
  },

  async putFile(jsonValue, sha, message) {
    return withRetry(async () => {
      const body = {
        message: message || `Update ${config.get('path')} via Familie ToDo`,
        content: b64Encode(JSON.stringify(jsonValue, null, 2) + '\n'),
      };
      if (sha) body.sha = sha;
      let res;
      try {
        res = await fetch(url(), {
          method: 'PUT',
          headers: { ...headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (err) {
        throw mkErr('NETWORK', 'Netzwerkfehler beim Speichern.', err);
      }
      if (res.status === 409 || res.status === 422) throw mkErr('CONFLICT', 'Remote wurde zwischenzeitlich geändert.');
      if (res.status === 401 || res.status === 403) throw mkErr('AUTH', 'PAT ungültig oder unzureichende Rechte.');
      if (res.status === 404) throw mkErr('NOT_FOUND', 'Zielpfad existiert nicht (Ordner im Repo anlegen).');
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw mkErr('NETWORK', `GitHub antwortete mit ${res.status}. ${text.slice(0, 200)}`);
      }
      const j = await res.json();
      return { sha: j?.content?.sha };
    });
  },
};
