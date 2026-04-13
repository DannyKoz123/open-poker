import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Room } from '../room/Room';
import { HostSession } from './HostSession';
import type { ClientMessage, ServerMessage } from '../../types/messages';

// ── Mock WebSocket ───────────────────────────────────────────────

class MockWebSocket {
  readyState = 1; // WebSocket.OPEN
  sent: ServerMessage[] = [];
  closed = false;

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = 3; // WebSocket.CLOSED
    this.closed = true;
  }

  lastMessage(): ServerMessage | undefined {
    return this.sent[this.sent.length - 1];
  }

  messagesOfType<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }

  clear() {
    this.sent = [];
  }
}

// Bun's test env doesn't have a global WebSocket with OPEN constant.
// Room checks ws.readyState === WebSocket.OPEN (1). Our mock returns 1.
// But we need the global WebSocket symbol for Room's comparisons.
if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as Record<string, unknown>).WebSocket = { OPEN: 1, CLOSED: 3 } as unknown;
}

// ── Helpers ──────────────────────────────────────────────────────

function createHostRoom(opts?: { smallBlind?: number; bigBlind?: number }) {
  const room = new Room('test-room', { smallBlind: opts?.smallBlind ?? 5, bigBlind: opts?.bigBlind ?? 10 });
  const session = new HostSession(room, 'host-1', 'Danny');
  room.hostSession = session;
  return { room, session };
}

function connectPlayer(session: HostSession, playerId: string, name: string): MockWebSocket {
  const ws = new MockWebSocket();
  session.handleConnection(ws as unknown as WebSocket, playerId);
  session.handleMessage(playerId, { type: 'join', name });
  return ws;
}

function seatViaHost(session: HostSession, playerId: string, seatIndex: number) {
  // Player requests seat
  session.handleMessage(playerId, { type: 'sit', seatIndex });
  // Host approves
  session.handleMessage('host-1', { type: 'host-approve-seat', playerId });
}

// ── Tests ────────────────────────────────────────────────────────

describe('Room backward compatibility (no HostSession)', () => {
  it('non-host room: start-game from any player works', () => {
    const room = new Room('no-host-room', { smallBlind: 5, bigBlind: 10 });
    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();

    room.handleConnection(ws1 as unknown as WebSocket, 'p1');
    room.handleMessage('p1', { type: 'join', name: 'Alice' });
    room.handleMessage('p1', { type: 'sit', seatIndex: 0 });

    room.handleConnection(ws2 as unknown as WebSocket, 'p2');
    room.handleMessage('p2', { type: 'join', name: 'Bob' });
    room.handleMessage('p2', { type: 'sit', seatIndex: 1 });

    room.handleMessage('p2', { type: 'start-game' });

    // p2 (non-host, non-creator) should be able to start the game
    const gameStates = ws1.messagesOfType('game-state');
    expect(gameStates.length).toBeGreaterThan(0);
  });

  it('non-host room: direct seating (no queue)', () => {
    const room = new Room('no-host-room-2');
    const ws = new MockWebSocket();
    room.handleConnection(ws as unknown as WebSocket, 'p1');
    room.handleMessage('p1', { type: 'join', name: 'Alice' });
    room.handleMessage('p1', { type: 'sit', seatIndex: 3 });

    const satMessages = ws.messagesOfType('player-sat');
    expect(satMessages.length).toBe(1);
    expect(satMessages[0].seatIndex).toBe(3);
  });

  it('non-host room: RoomInfo has hostId=null', () => {
    const room = new Room('no-host-room-3');
    const ws = new MockWebSocket();
    room.handleConnection(ws as unknown as WebSocket, 'p1');

    const roomStates = ws.messagesOfType('room-state');
    expect(roomStates.length).toBeGreaterThan(0);
    expect(roomStates[0].room.hostId).toBeNull();
    expect(roomStates[0].room.sessionPhase).toBeNull();
  });
});

describe('HostSession creation', () => {
  it('sets host properties on creation', () => {
    const { session } = createHostRoom();
    expect(session.hostId).toBe('host-1');
    expect(session.hostName).toBe('Danny');
    expect(session.sessionPhase).toBe('lobby');
  });

  it('RoomInfo includes hostId and sessionPhase', () => {
    const { session } = createHostRoom();
    const ws = connectPlayer(session, 'host-1', 'Danny');

    const roomStates = ws.messagesOfType('room-state');
    expect(roomStates.length).toBeGreaterThan(0);
    const info = roomStates[0].room;
    expect(info.hostId).toBe('host-1');
    expect(info.sessionPhase).toBe('lobby');
  });
});

describe('Mid-hand sit guard (TODO #4)', () => {
  it('rejects sit during active hand', () => {
    const room = new Room('guard-test');
    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    const ws3 = new MockWebSocket();

    room.handleConnection(ws1 as unknown as WebSocket, 'p1');
    room.handleMessage('p1', { type: 'join', name: 'Alice' });
    room.handleMessage('p1', { type: 'sit', seatIndex: 0 });

    room.handleConnection(ws2 as unknown as WebSocket, 'p2');
    room.handleMessage('p2', { type: 'join', name: 'Bob' });
    room.handleMessage('p2', { type: 'sit', seatIndex: 1 });

    room.handleMessage('p1', { type: 'start-game' });
    expect(room.gameState).not.toBeNull();

    // p3 tries to sit during a hand
    room.handleConnection(ws3 as unknown as WebSocket, 'p3');
    room.handleMessage('p3', { type: 'join', name: 'Charlie' });
    room.handleMessage('p3', { type: 'sit', seatIndex: 2 });

    const errors = ws3.messagesOfType('error');
    expect(errors.some(e => e.message.includes('Cannot sit during a hand'))).toBe(true);
  });

  it('allows sit between hands', () => {
    const room = new Room('guard-test-2');
    const ws = new MockWebSocket();

    room.handleConnection(ws as unknown as WebSocket, 'p1');
    room.handleMessage('p1', { type: 'join', name: 'Alice' });

    expect(room.gameState).toBeNull();
    room.handleMessage('p1', { type: 'sit', seatIndex: 0 });

    const satMessages = ws.messagesOfType('player-sat');
    expect(satMessages.length).toBe(1);
  });
});

describe('Seat queue', () => {
  it('non-host sit queues instead of seating', () => {
    const { session } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    const playerWs = connectPlayer(session, 'player-1', 'Alex');

    session.handleMessage('player-1', { type: 'sit', seatIndex: 2 });

    // Player should NOT be seated directly
    const satMessages = playerWs.messagesOfType('player-sat');
    const seatApproved = playerWs.messagesOfType('seat-approved');
    expect(satMessages.length).toBe(0);
    expect(seatApproved.length).toBe(0);

    // Should be in the queue
    const hostStates = playerWs.messagesOfType('host-state');
    const latest = hostStates[hostStates.length - 1];
    expect(latest.hostState.seatQueue.length).toBe(1);
    expect(latest.hostState.seatQueue[0].playerId).toBe('player-1');
    expect(latest.hostState.seatQueue[0].seatIndex).toBe(2);
  });

  it('host approves seat: player seated + buy-in ledger entry', () => {
    const { session, room } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    const playerWs = connectPlayer(session, 'player-1', 'Alex');

    session.handleMessage('player-1', { type: 'sit', seatIndex: 2 });
    playerWs.clear();

    session.handleMessage('host-1', { type: 'host-approve-seat', playerId: 'player-1' });

    // Player should now be seated
    const approved = playerWs.messagesOfType('seat-approved');
    expect(approved.length).toBe(1);
    expect(approved[0].seatIndex).toBe(2);

    // Ledger should have buy-in entry
    expect(session.ledger.length).toBe(1);
    expect(session.ledger[0].type).toBe('buy-in');
    expect(session.ledger[0].playerId).toBe('player-1');
    expect(session.ledger[0].amount).toBe(room.startingChips);

    // Participant should be registered
    expect(session.participants.has('player-1')).toBe(true);
  });

  it('seat approval during active hand fails without recording buy-in', () => {
    const { session, room } = createHostRoom();
    const hostWs = connectPlayer(session, 'host-1', 'Danny');
    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });

    connectPlayer(session, 'player-1', 'Alex');
    seatViaHost(session, 'player-1', 1);

    // A third player requests a seat
    connectPlayer(session, 'player-2', 'Bob');
    session.handleMessage('player-2', { type: 'sit', seatIndex: 2 });
    expect(session.seatQueue.length).toBe(1);

    // Start session and force a hand to be in progress
    session.handleMessage('host-1', { type: 'host-start-session' });
    room.handleMessage('host-1', { type: 'start-game' });
    expect(room.gameState).not.toBeNull();

    const ledgerBefore = session.ledger.length;
    hostWs.clear();

    // Host tries to approve seat during active hand — Room's mid-hand guard rejects
    session.handleMessage('host-1', { type: 'host-approve-seat', playerId: 'player-2' });

    // No buy-in should be recorded
    expect(session.ledger.length).toBe(ledgerBefore);
    expect(session.participants.has('player-2')).toBe(false);

    // Request should remain in queue for retry after hand
    expect(session.seatQueue.length).toBe(1);
    expect(session.seatQueue[0].playerId).toBe('player-2');

    // Host should see an error
    const errors = hostWs.messagesOfType('error');
    expect(errors.some(e => e.message.includes('Cannot seat during a hand'))).toBe(true);
  });

  it('host denies seat: player removed from queue and notified', () => {
    const { session } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    const playerWs = connectPlayer(session, 'player-1', 'Alex');

    session.handleMessage('player-1', { type: 'sit', seatIndex: 0 });
    playerWs.clear();

    session.handleMessage('host-1', { type: 'host-deny-seat', playerId: 'player-1' });

    const denied = playerWs.messagesOfType('seat-denied');
    expect(denied.length).toBe(1);
    expect(session.seatQueue.length).toBe(0);
  });

  it('host failed sit does not record buy-in', () => {
    const { session } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');

    // Sit at an out-of-range seat
    session.handleMessage('host-1', { type: 'sit', seatIndex: 99 });

    // No ledger entry or participant should exist
    expect(session.ledger.length).toBe(0);
    expect(session.participants.size).toBe(0);
  });

  it('host sit at taken seat does not record buy-in', () => {
    const { session } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    connectPlayer(session, 'player-1', 'Alex');

    // Seat player-1 at seat 0 via host approval
    seatViaHost(session, 'player-1', 0);

    // Host tries to sit at seat 0 (already taken)
    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });

    // Only player-1's buy-in should exist, not the host's
    expect(session.ledger.length).toBe(1);
    expect(session.ledger[0].playerId).toBe('player-1');
    expect(session.participants.has('host-1')).toBe(false);
  });

  it('host self-seats directly (bypass queue) with buy-in recorded', () => {
    const { session, room } = createHostRoom();
    const hostWs = connectPlayer(session, 'host-1', 'Danny');

    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });

    // Host should be seated directly, no queue
    const satMessages = hostWs.messagesOfType('player-sat');
    expect(satMessages.length).toBe(1);
    expect(satMessages[0].seatIndex).toBe(0);
    expect(session.seatQueue.length).toBe(0);

    // Buy-in should be recorded in ledger
    expect(session.ledger.length).toBe(1);
    expect(session.ledger[0].type).toBe('buy-in');
    expect(session.ledger[0].playerId).toBe('host-1');
    expect(session.ledger[0].amount).toBe(room.startingChips);

    // Participant should be registered
    expect(session.participants.has('host-1')).toBe(true);
  });
});

describe('Rebuy flow', () => {
  it('player requests rebuy: enters rebuy queue', () => {
    const { session } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });

    const playerWs = connectPlayer(session, 'player-1', 'Alex');
    seatViaHost(session, 'player-1', 1);

    // Start session so rebuys are allowed
    session.handleMessage('host-1', { type: 'host-start-session' });
    playerWs.clear();

    session.handleMessage('player-1', { type: 'rebuy-request', amount: 500 });

    const hostStates = playerWs.messagesOfType('host-state');
    const latest = hostStates[hostStates.length - 1];
    expect(latest.hostState.rebuyQueue.length).toBe(1);
    expect(latest.hostState.rebuyQueue[0].amount).toBe(500);
  });

  it('host approves rebuy: chips added + ledger entry', () => {
    const { session, room } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });

    connectPlayer(session, 'player-1', 'Alex');
    seatViaHost(session, 'player-1', 1);

    session.handleMessage('host-1', { type: 'host-start-session' });

    const chipsBefore = room.chipStacks.get('player-1') ?? 0;
    session.handleMessage('player-1', { type: 'rebuy-request', amount: 500 });
    session.handleMessage('host-1', { type: 'host-approve-rebuy', playerId: 'player-1' });

    const chipsAfter = room.chipStacks.get('player-1') ?? 0;
    expect(chipsAfter).toBe(chipsBefore + 500);

    // Ledger should have buy-in + rebuy
    const rebuyEntries = session.ledger.filter(e => e.type === 'rebuy');
    expect(rebuyEntries.length).toBe(1);
    expect(rebuyEntries[0].amount).toBe(500);
  });

  it('host denies rebuy: removed from queue', () => {
    const { session } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });

    const playerWs = connectPlayer(session, 'player-1', 'Alex');
    seatViaHost(session, 'player-1', 1);

    session.handleMessage('host-1', { type: 'host-start-session' });
    session.handleMessage('player-1', { type: 'rebuy-request', amount: 500 });
    session.handleMessage('host-1', { type: 'host-deny-rebuy', playerId: 'player-1' });

    expect(session.rebuyQueue.length).toBe(0);
    const denied = playerWs.messagesOfType('rebuy-denied');
    expect(denied.length).toBe(1);
  });
});

describe('Session lifecycle', () => {
  it('lobby → playing on host-start-session', () => {
    const { session } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });

    connectPlayer(session, 'player-1', 'Alex');
    seatViaHost(session, 'player-1', 1);

    expect(session.sessionPhase).toBe('lobby');
    session.handleMessage('host-1', { type: 'host-start-session' });
    expect(session.sessionPhase).toBe('playing');
  });

  it('playing → paused → playing on host-pause-deal toggle', () => {
    const { session } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });
    connectPlayer(session, 'player-1', 'Alex');
    seatViaHost(session, 'player-1', 1);

    session.handleMessage('host-1', { type: 'host-start-session' });
    expect(session.sessionPhase).toBe('playing');

    session.handleMessage('host-1', { type: 'host-pause-deal' });
    expect(session.sessionPhase).toBe('paused');

    session.handleMessage('host-1', { type: 'host-pause-deal' });
    expect(session.sessionPhase).toBe('playing');
  });

  it('playing → closed on host-end-game (no hand in progress)', () => {
    const { session, room } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });
    connectPlayer(session, 'player-1', 'Alex');
    seatViaHost(session, 'player-1', 1);

    session.handleMessage('host-1', { type: 'host-start-session' });
    expect(room.gameState).toBeNull(); // auto-deal hasn't fired yet (3s delay)

    session.handleMessage('host-1', { type: 'host-end-game' });
    expect(session.sessionPhase).toBe('closed');
  });

  it('playing → ending → closed when end-game during hand', () => {
    const { session, room } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });
    connectPlayer(session, 'player-1', 'Alex');
    seatViaHost(session, 'player-1', 1);

    session.handleMessage('host-1', { type: 'host-start-session' });

    // Manually start a game to get a hand in progress
    room.handleMessage('host-1', { type: 'start-game' });
    expect(room.gameState).not.toBeNull();

    session.handleMessage('host-1', { type: 'host-end-game' });
    expect(session.sessionPhase).toBe('ending');

    // Complete the hand by folding
    const activePlayer = room.gameState!.players[room.gameState!.activePlayerIndex];
    room.handleMessage(activePlayer.id, { type: 'action', action: 'fold' });

    // After hand completes, onHandComplete fires → closeSession
    expect(session.sessionPhase).toBe('closed');
  });
});

describe('Auto-deal timer', () => {
  afterEach(() => {
    // Clean up any pending timers
  });

  it('auto-deal fires after delay when session is playing', async () => {
    const { session, room } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });
    connectPlayer(session, 'player-1', 'Alex');
    seatViaHost(session, 'player-1', 1);

    session.handleMessage('host-1', { type: 'host-start-session' });
    expect(room.gameState).toBeNull();

    // Wait for auto-deal timer (3s + small buffer)
    await new Promise(resolve => setTimeout(resolve, 3200));

    expect(room.gameState).not.toBeNull();
    expect(session.handsDealt).toBe(0); // hand hasn't completed yet
  });

  it('paused state prevents auto-deal', async () => {
    const { session, room } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });
    connectPlayer(session, 'player-1', 'Alex');
    seatViaHost(session, 'player-1', 1);

    session.handleMessage('host-1', { type: 'host-start-session' });
    session.handleMessage('host-1', { type: 'host-pause-deal' });
    expect(session.sessionPhase).toBe('paused');

    await new Promise(resolve => setTimeout(resolve, 3500));

    expect(room.gameState).toBeNull();
  });

  it('end-game cancels auto-deal timer', async () => {
    const { session, room } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });
    connectPlayer(session, 'player-1', 'Alex');
    seatViaHost(session, 'player-1', 1);

    session.handleMessage('host-1', { type: 'host-start-session' });
    // End immediately before auto-deal fires
    session.handleMessage('host-1', { type: 'host-end-game' });
    expect(session.sessionPhase).toBe('closed');

    await new Promise(resolve => setTimeout(resolve, 3500));

    // No game should have started
    expect(room.gameState).toBeNull();
  });
});

describe('Host disconnect', () => {
  it('auto-pauses session when host disconnects', () => {
    const { session } = createHostRoom();
    const hostWs = connectPlayer(session, 'host-1', 'Danny');
    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });
    connectPlayer(session, 'player-1', 'Alex');
    seatViaHost(session, 'player-1', 1);

    session.handleMessage('host-1', { type: 'host-start-session' });
    expect(session.sessionPhase).toBe('playing');

    session.handleDisconnect('host-1', hostWs as unknown as WebSocket);
    expect(session.sessionPhase).toBe('paused');
  });

  it('auto-resumes session when host reconnects via handleConnection', () => {
    const { session } = createHostRoom();
    const hostWs = connectPlayer(session, 'host-1', 'Danny');
    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });
    connectPlayer(session, 'player-1', 'Alex');
    seatViaHost(session, 'player-1', 1);

    session.handleMessage('host-1', { type: 'host-start-session' });
    session.handleDisconnect('host-1', hostWs as unknown as WebSocket);
    expect(session.sessionPhase).toBe('paused');

    // Host reconnects via a new WS connection (same path the gateway uses)
    const newHostWs = new MockWebSocket();
    session.handleConnection(newHostWs as unknown as WebSocket, 'host-1');
    expect(session.sessionPhase).toBe('playing');
  });
});

describe('Settlement math', () => {
  it('correct net result: buy-in + rebuys vs final chips', () => {
    const { session, room } = createHostRoom({ smallBlind: 5, bigBlind: 10 });
    // startingChips = 100 * 10 = 1000

    connectPlayer(session, 'host-1', 'Danny');
    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });
    // Host self-seat now auto-registers participant + buy-in ledger entry

    connectPlayer(session, 'player-1', 'Alex');
    seatViaHost(session, 'player-1', 1);

    // Simulate: player-1 does a rebuy
    session.handleMessage('host-1', { type: 'host-start-session' });
    session.handleMessage('player-1', { type: 'rebuy-request', amount: 500 });
    session.handleMessage('host-1', { type: 'host-approve-rebuy', playerId: 'player-1' });

    // Set final chip counts manually to test settlement
    room.chipStacks.set('host-1', 1800);
    room.chipStacks.set('player-1', 700);

    // End session
    session.handleMessage('host-1', { type: 'host-end-game' });

    const hostStates = session.getHostRoomState();
    expect(hostStates.sessionPhase).toBe('closed');

    // Verify settlement from ledger
    // host-1: bought in for 1000, final 1800, net +800
    // player-1: bought in for 1000 + rebuy 500 = 1500, final 700, net -800
    const hostEntry = session.ledger.filter(e => e.playerId === 'host-1');
    const playerEntry = session.ledger.filter(e => e.playerId === 'player-1');

    const hostBuyIn = hostEntry.reduce((s, e) => s + e.amount, 0);
    const playerBuyIn = playerEntry.reduce((s, e) => s + e.amount, 0);

    expect(hostBuyIn).toBe(1000);
    expect(playerBuyIn).toBe(1500); // 1000 buy-in + 500 rebuy
    expect(1800 - hostBuyIn).toBe(800); // net +800
    expect(700 - playerBuyIn).toBe(-800); // net -800
  });

  it('disconnected player uses last-known chip count', () => {
    const { session, room } = createHostRoom({ smallBlind: 5, bigBlind: 10 });

    connectPlayer(session, 'host-1', 'Danny');
    session.handleMessage('host-1', { type: 'sit', seatIndex: 0 });

    const playerWs = connectPlayer(session, 'player-1', 'Alex');
    seatViaHost(session, 'player-1', 1);

    session.handleMessage('host-1', { type: 'host-start-session' });

    // Set chip counts, then simulate player disconnect
    room.chipStacks.set('host-1', 1300);
    room.chipStacks.set('player-1', 700);

    // Player disconnects (chipStacks survives)
    session.handleDisconnect('player-1', playerWs as unknown as WebSocket);

    // End session
    session.handleMessage('host-1', { type: 'host-end-game' });

    // chipStacks should still have player-1's last known chips
    expect(room.chipStacks.get('player-1')).toBe(700);
  });
});

describe('Host guards', () => {
  it('non-host cannot start session', () => {
    const { session } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    const playerWs = connectPlayer(session, 'player-1', 'Alex');

    session.handleMessage('player-1', { type: 'host-start-session' });

    const errors = playerWs.messagesOfType('error');
    expect(errors.some(e => e.message.includes('Only the host'))).toBe(true);
    expect(session.sessionPhase).toBe('lobby');
  });

  it('non-host cannot approve seats', () => {
    const { session } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    const playerWs = connectPlayer(session, 'player-1', 'Alex');
    connectPlayer(session, 'player-2', 'Bob');

    session.handleMessage('player-2', { type: 'sit', seatIndex: 0 });

    // player-1 tries to approve (not the host)
    session.handleMessage('player-1', { type: 'host-approve-seat', playerId: 'player-2' });

    const errors = playerWs.messagesOfType('error');
    expect(errors.some(e => e.message.includes('Only the host'))).toBe(true);
    // player-2 should still be in queue
    expect(session.seatQueue.length).toBe(1);
  });

  it('non-host start-game is blocked', () => {
    const { session } = createHostRoom();
    connectPlayer(session, 'host-1', 'Danny');
    const playerWs = connectPlayer(session, 'player-1', 'Alex');

    session.handleMessage('player-1', { type: 'start-game' });

    const errors = playerWs.messagesOfType('error');
    expect(errors.some(e => e.message.includes('Only the host'))).toBe(true);
  });
});
