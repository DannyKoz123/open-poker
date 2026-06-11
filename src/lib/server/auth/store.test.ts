import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStoreError, FileSystemAuthStore } from './store';

describe('FileSystemAuthStore', () => {
  let dataDir: string;
  let store: FileSystemAuthStore;

  beforeEach(() => {
    dataDir = join(tmpdir(), `open-poker-auth-${crypto.randomUUID()}`);
    store = new FileSystemAuthStore(dataDir);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates an account and resolves it back from the issued session token', () => {
    const result = store.signup('alice_1', 'password123');

    expect(result.account.username).toBe('alice_1');
    expect(result.sessionToken.length).toBeGreaterThan(10);
    expect(store.getAccountForSessionToken(result.sessionToken)).toEqual(result.account);
  });

  it('logs in with the correct password and rejects the wrong one', () => {
    store.signup('bob_1', 'password123');

    const login = store.login('bob_1', 'password123');
    expect(login.account.username).toBe('bob_1');

    expect(() => store.login('bob_1', 'wrong-pass')).toThrow(AuthStoreError);
  });

  it('rejects duplicate usernames case-insensitively', () => {
    store.signup('CaseTest', 'password123');

    expect(() => store.signup('casetest', 'password123')).toThrow(AuthStoreError);
  });

  it('deletes a session token cleanly', () => {
    const { sessionToken } = store.signup('charlie_1', 'password123');
    expect(store.getAccountForSessionToken(sessionToken)).not.toBeNull();

    store.deleteSession(sessionToken);
    expect(store.getAccountForSessionToken(sessionToken)).toBeNull();
  });
});
