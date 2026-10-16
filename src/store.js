// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container): the session of the Total Connect Comfort account (access token,
// its expiry, refresh token) and the user id, with the account they belong to
// (a hash of the e-mail). Honeywell limits sign-ins hard: a restart reuses the
// tokens instead of signing in again.
// -----------------------------------------------------------------------------

import { readFile, rename, writeFile } from 'node:fs/promises';

export const STATE_FILE = '/data/evohome-state.json';

export function fileStore(path = STATE_FILE) {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return null;
      }
    },
    async save(data) {
      const temporary = `${path}.tmp`;
      await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
      await rename(temporary, path);
    },
  };
}

const text = (value) => (typeof value === 'string' && value !== '' ? value : undefined);

/** The persisted state, repaired: `{ session }`, the session null when unusable. */
export function normalizeMemory(raw) {
  const s = raw?.session;
  const account = text(s?.account);
  const accessToken = text(s?.accessToken);
  const refreshToken = text(s?.refreshToken);
  const session =
    account && (accessToken || refreshToken)
      ? {
          account,
          accessToken: accessToken ?? null,
          expiresAt: Number.isFinite(s.expiresAt) ? s.expiresAt : 0,
          refreshToken: refreshToken ?? null,
          userId: text(s.userId) ?? null,
        }
      : null;
  return { session };
}
