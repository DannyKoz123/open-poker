import type { Plugin } from 'vite';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { getOrCreateRoom } from '../room/room-registry';
import type { ClientMessage } from '../../types/messages';
import { getAuthStore, AUTH_COOKIE_NAME } from '../auth/store';
import { accountPlayerId, isAccountPlayerId } from '../../types/identity';

const WS_PORT = 5174;

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;

  for (const cookie of header.split(';')) {
    const [cookieName, ...valueParts] = cookie.trim().split('=');
    if (cookieName === name) {
      return decodeURIComponent(valueParts.join('='));
    }
  }

  return null;
}

export function webSocketServer(): Plugin {
  let started = false;
  return {
    name: 'poker-websocket',
    configureServer() {
      if (started) return;
      started = true;

      const httpServer = createServer();
      const wss = new WebSocketServer({ server: httpServer });

      wss.on('connection', (ws, request) => {
        const url = new URL(request.url || '', `http://localhost:${WS_PORT}`);
        const match = url.pathname.match(/^\/ws\/game\/(.+)$/);
        if (!match) {
          ws.close(1008, 'Invalid path');
          return;
        }

        const roomId = match[1];
        const account = getAuthStore().getAccountForSessionToken(
          readCookie(request.headers.cookie, AUTH_COOKIE_NAME),
        );
        let playerId: string;
        if (account) {
          playerId = accountPlayerId(account.id);
        } else {
          const queryId = url.searchParams.get('playerId');
          // Reject account: prefix from unauthenticated connections to prevent impersonation
          playerId = queryId && !isAccountPlayerId(queryId) ? queryId : crypto.randomUUID();
        }
        const room = getOrCreateRoom(roomId);

        // Access hostSession dynamically so routing stays correct if it changes
        const hs = () => room.hostSession;

        if (hs()) {
          hs()!.handleConnection(ws as unknown as WebSocket, playerId);
        } else {
          room.handleConnection(ws as unknown as WebSocket, playerId);
        }

        ws.on('message', (data) => {
          try {
            const parsed = JSON.parse(data.toString()) as ClientMessage;
            const msg: ClientMessage =
              account && parsed.type === 'join'
                ? { ...parsed, name: account.username }
                : parsed;
            if (hs()) {
              hs()!.handleMessage(playerId, msg);
            } else {
              room.handleMessage(playerId, msg);
            }
          } catch {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
          }
        });

        ws.on('close', () => {
          if (hs()) {
            hs()!.handleDisconnect(playerId, ws as unknown as WebSocket);
          } else {
            room.handleDisconnect(playerId, ws as unknown as WebSocket);
          }
        });
      });

      httpServer.listen(WS_PORT, () => {
        console.log(`Poker WebSocket server listening on ws://localhost:${WS_PORT}`);
      });
    },
  };
}
