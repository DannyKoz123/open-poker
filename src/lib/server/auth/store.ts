import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveOpenPokerDataDir } from '../store/completed-hand-store';
import type { AccountIdentity } from '../../types/identity';

const AUTH_DIRNAME = 'auth';
const ACCOUNTS_FILENAME = 'accounts.json';
const SESSIONS_FILENAME = 'sessions.json';

export const AUTH_COOKIE_NAME = 'open_poker_session';
export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const AUTH_SESSION_TTL_MS = AUTH_SESSION_MAX_AGE_SECONDS * 1000;

type StoredAccount = AccountIdentity & {
  usernameKey: string;
  passwordSalt: string;
  passwordHash: string;
};

type StoredSession = {
  sessionHash: string;
  accountId: string;
  createdAt: number;
  expiresAt: number;
};

type AccountsFile = { accounts: StoredAccount[] };
type SessionsFile = { sessions: StoredSession[] };

export class AuthStoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AuthStoreError';
  }
}

function writeJsonAtomic(path: string, value: unknown) {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, path);
}

function readJsonFile<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

function normalizeUsername(username: string): { username: string; key: string } {
  const trimmed = username.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(trimmed)) {
    throw new AuthStoreError(
      'Username must be 3-20 characters using letters, numbers, or underscores.',
      400,
    );
  }

  return {
    username: trimmed,
    key: trimmed.toLowerCase(),
  };
}

function validatePassword(password: string) {
  if (password.length < 8) {
    throw new AuthStoreError('Password must be at least 8 characters.', 400);
  }
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex');
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const aBytes = Buffer.from(a, 'hex');
  const bBytes = Buffer.from(b, 'hex');
  return aBytes.length === bBytes.length && timingSafeEqual(aBytes, bBytes);
}

function toPublicAccount(account: StoredAccount): AccountIdentity {
  return {
    id: account.id,
    username: account.username,
    createdAt: account.createdAt,
  };
}

export class FileSystemAuthStore {
  private readonly accountsPath: string;
  private readonly sessionsPath: string;

  constructor(dataDir = resolveOpenPokerDataDir()) {
    const authDir = join(dataDir, AUTH_DIRNAME);
    mkdirSync(authDir, { recursive: true });
    this.accountsPath = join(authDir, ACCOUNTS_FILENAME);
    this.sessionsPath = join(authDir, SESSIONS_FILENAME);
  }

  signup(username: string, password: string): { account: AccountIdentity; sessionToken: string } {
    const { username: canonicalUsername, key } = normalizeUsername(username);
    validatePassword(password);

    const accountsFile = this.readAccounts();
    if (accountsFile.accounts.some(account => account.usernameKey === key)) {
      throw new AuthStoreError('That username is already taken.', 409);
    }

    const account: StoredAccount = {
      id: randomUUID(),
      username: canonicalUsername,
      usernameKey: key,
      createdAt: Date.now(),
      passwordSalt: randomBytes(16).toString('hex'),
      passwordHash: '',
    };
    account.passwordHash = hashPassword(password, account.passwordSalt);
    accountsFile.accounts.push(account);
    this.writeAccounts(accountsFile);

    return {
      account: toPublicAccount(account),
      sessionToken: this.createSession(account.id),
    };
  }

  login(username: string, password: string): { account: AccountIdentity; sessionToken: string } {
    const { key } = normalizeUsername(username);
    const accountsFile = this.readAccounts();
    const account = accountsFile.accounts.find(candidate => candidate.usernameKey === key);
    if (!account) {
      throw new AuthStoreError('Invalid username or password.', 401);
    }

    const attemptedHash = hashPassword(password, account.passwordSalt);
    if (!safeEqual(account.passwordHash, attemptedHash)) {
      throw new AuthStoreError('Invalid username or password.', 401);
    }

    return {
      account: toPublicAccount(account),
      sessionToken: this.createSession(account.id),
    };
  }

  getAccountForSessionToken(sessionToken: string | null | undefined): AccountIdentity | null {
    if (!sessionToken) return null;

    const sessionsFile = this.readSessions();
    const now = Date.now();
    const sessionHash = hashSessionToken(sessionToken);
    let sessionsChanged = false;

    const activeSessions = sessionsFile.sessions.filter(session => {
      const expired = session.expiresAt <= now;
      sessionsChanged = sessionsChanged || expired;
      return !expired;
    });

    const session = activeSessions.find(candidate => safeEqual(candidate.sessionHash, sessionHash));
    if (sessionsChanged) {
      this.writeSessions({ sessions: activeSessions });
    }
    if (!session) return null;

    const accountsFile = this.readAccounts();
    const account = accountsFile.accounts.find(candidate => candidate.id === session.accountId);
    return account ? toPublicAccount(account) : null;
  }

  deleteSession(sessionToken: string | null | undefined): void {
    if (!sessionToken) return;

    const sessionHash = hashSessionToken(sessionToken);
    const sessionsFile = this.readSessions();
    const filtered = sessionsFile.sessions.filter(session => session.sessionHash !== sessionHash);

    if (filtered.length !== sessionsFile.sessions.length) {
      this.writeSessions({ sessions: filtered });
    }
  }

  private createSession(accountId: string): string {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const sessionsFile = this.readSessions();

    sessionsFile.sessions = sessionsFile.sessions.filter(session => session.expiresAt > now);
    sessionsFile.sessions.push({
      sessionHash: hashSessionToken(token),
      accountId,
      createdAt: now,
      expiresAt: now + AUTH_SESSION_TTL_MS,
    });
    this.writeSessions(sessionsFile);

    return token;
  }

  private readAccounts(): AccountsFile {
    return readJsonFile(this.accountsPath, { accounts: [] });
  }

  private writeAccounts(file: AccountsFile) {
    writeJsonAtomic(this.accountsPath, file);
  }

  private readSessions(): SessionsFile {
    return readJsonFile(this.sessionsPath, { sessions: [] });
  }

  private writeSessions(file: SessionsFile) {
    writeJsonAtomic(this.sessionsPath, file);
  }
}

let authStore: FileSystemAuthStore | null = null;

export function getAuthStore(): FileSystemAuthStore {
  if (!authStore) {
    authStore = new FileSystemAuthStore();
  }
  return authStore;
}
