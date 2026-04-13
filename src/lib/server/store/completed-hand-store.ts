import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CompletedHandStore, PersistedHandRecord } from './types';

/** Reject handIds that would escape the target directory via path traversal. */
function assertSafeHandId(handId: string): void {
  if (/[\/\\]|\.\./.test(handId)) {
    throw new Error(`Invalid handId: ${handId}`);
  }
}

const DATA_DIR_ENV = 'OPEN_POKER_DATA_DIR';
const DEFAULT_DATA_DIRNAME = '.open-poker';

function writeJsonAtomic(path: string, value: unknown) {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, path);
}

export function resolveOpenPokerDataDir(): string {
  const configured = process.env[DATA_DIR_ENV]?.trim();
  if (configured) return configured;
  return join(process.cwd(), DEFAULT_DATA_DIRNAME);
}

export class FileSystemCompletedHandStore implements CompletedHandStore {
  private readonly handsDir: string;
  private readonly completedDir: string;
  private readonly inProgressDir: string;

  constructor(private readonly dataDir: string = resolveOpenPokerDataDir()) {
    this.handsDir = resolve(join(this.dataDir, 'hands'));
    this.completedDir = resolve(join(this.handsDir, 'completed'));
    this.inProgressDir = resolve(join(this.handsDir, 'in-progress'));

    mkdirSync(this.completedDir, { recursive: true });
    mkdirSync(this.inProgressDir, { recursive: true });
  }

  saveInProgressHand(hand: PersistedHandRecord): void {
    assertSafeHandId(hand.handId);
    writeJsonAtomic(this.inProgressPath(hand.handId), hand);
  }

  saveCompletedHand(hand: PersistedHandRecord): void {
    assertSafeHandId(hand.handId);
    writeJsonAtomic(this.completedPath(hand.handId), hand);
    rmSync(this.inProgressPath(hand.handId), { force: true });
  }

  loadCompletedHand(handId: string): PersistedHandRecord | null {
    assertSafeHandId(handId);
    try {
      return JSON.parse(readFileSync(this.completedPath(handId), 'utf8')) as PersistedHandRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private completedPath(handId: string): string {
    const resolved = resolve(this.completedDir, `${handId}.json`);
    if (!resolved.startsWith(this.completedDir)) {
      throw new Error(`Path traversal detected for handId: ${handId}`);
    }
    return resolved;
  }

  private inProgressPath(handId: string): string {
    const resolved = resolve(this.inProgressDir, `${handId}.json`);
    if (!resolved.startsWith(this.inProgressDir)) {
      throw new Error(`Path traversal detected for handId: ${handId}`);
    }
    return resolved;
  }
}

export const NOOP_COMPLETED_HAND_STORE: CompletedHandStore = {
  saveInProgressHand() {},
  saveCompletedHand() {},
  loadCompletedHand() {
    return null;
  },
};

let defaultCompletedHandStore: CompletedHandStore | null = null;

export function getCompletedHandStore(): CompletedHandStore {
  if (!defaultCompletedHandStore) {
    defaultCompletedHandStore = new FileSystemCompletedHandStore();
  }
  return defaultCompletedHandStore;
}

export function setCompletedHandStore(store: CompletedHandStore | null): void {
  defaultCompletedHandStore = store;
}
