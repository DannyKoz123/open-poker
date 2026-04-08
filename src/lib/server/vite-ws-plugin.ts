import type { Plugin } from 'vite';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { getOrCreateRoom } from './rooms';
import type { ClientMessage } from '../types/messages';

const WS_PORT = 5174;

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
        const playerId = url.searchParams.get('playerId') || crypto.randomUUID();
        const room = getOrCreateRoom(roomId);

        room.handleConnection(ws as unknown as WebSocket, playerId);

        ws.on('message', (data) => {
          try {
            const msg: ClientMessage = JSON.parse(data.toString());
            room.handleMessage(playerId, msg);
          } catch (e) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
          }
        });

        ws.on('close', () => {
          room.handleDisconnect(playerId, ws as unknown as WebSocket);
        });
      });

      httpServer.listen(WS_PORT, () => {
        console.log(`Poker WebSocket server listening on ws://localhost:${WS_PORT}`);
      });
    },
  };
}
