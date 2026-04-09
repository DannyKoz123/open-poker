import type { Server } from 'node:http';

export interface UpgradeGateway {
  attach(playerId: string, playerSecret: string | null, ws: WebSocket): void;
}

export interface AttachWsUpgradeOptions {
  origin?: string | null;
}

export function attachWsUpgrade(
  _server: Server,
  _gateway: UpgradeGateway,
  _options: AttachWsUpgradeOptions = {}
): void {
  // Reserved for the unified HTTP + WebSocket server path described in docs.
}
