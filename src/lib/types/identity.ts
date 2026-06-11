export interface AccountIdentity {
  id: string;
  username: string;
  createdAt: number;
}

export interface AuthSessionData {
  account: AccountIdentity | null;
}

export const ACCOUNT_PLAYER_PREFIX = 'account:';

export function accountPlayerId(accountId: string): string {
  return `${ACCOUNT_PLAYER_PREFIX}${accountId}`;
}

export function isAccountPlayerId(playerId: string): boolean {
  return playerId.startsWith(ACCOUNT_PLAYER_PREFIX);
}
