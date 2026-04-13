import type { AccountIdentity } from '$lib/types/identity';
import { accountPlayerId } from '$lib/types/identity';

const STORAGE_KEY = 'open-poker.device-identity';
const DEFAULT_ANONYMOUS_NAME = 'Anonymous';

type StoredDeviceIdentity = {
  anonymousPlayerId: string;
  anonymousName: string;
};

export interface PlayerIdentity {
  playerId: string;
  playerName: string;
  account: AccountIdentity | null;
}

function sanitizeName(name: string | null | undefined): string {
  const trimmed = name?.trim().slice(0, 20);
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_ANONYMOUS_NAME;
}

function createDefaultIdentity(): StoredDeviceIdentity {
  return {
    anonymousPlayerId: crypto.randomUUID(),
    anonymousName: DEFAULT_ANONYMOUS_NAME,
  };
}

function saveStoredDeviceIdentity(identity: StoredDeviceIdentity): StoredDeviceIdentity {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function getStoredDeviceIdentity(): StoredDeviceIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return saveStoredDeviceIdentity(createDefaultIdentity());

    const parsed = JSON.parse(raw) as Partial<StoredDeviceIdentity>;
    if (typeof parsed.anonymousPlayerId !== 'string' || parsed.anonymousPlayerId.length === 0) {
      return saveStoredDeviceIdentity(createDefaultIdentity());
    }

    return saveStoredDeviceIdentity({
      anonymousPlayerId: parsed.anonymousPlayerId,
      anonymousName: sanitizeName(parsed.anonymousName),
    });
  } catch {
    return saveStoredDeviceIdentity(createDefaultIdentity());
  }
}

export function setAnonymousName(name: string): StoredDeviceIdentity {
  const identity = getStoredDeviceIdentity();
  identity.anonymousName = sanitizeName(name);
  return saveStoredDeviceIdentity(identity);
}

export function resolvePlayerIdentity(
  account: AccountIdentity | null,
  urlName: string | null = null,
): PlayerIdentity {
  if (account) {
    return {
      playerId: accountPlayerId(account.id),
      playerName: account.username,
      account,
    };
  }

  const identity = urlName ? setAnonymousName(urlName) : getStoredDeviceIdentity();
  return {
    playerId: identity.anonymousPlayerId,
    playerName: identity.anonymousName,
    account: null,
  };
}
