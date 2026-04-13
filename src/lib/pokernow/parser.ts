import type {
  PNPlayer,
  PNBuyIn,
  PNCashOut,
  PNHand,
  PNHandAction,
  PNActionType,
  PNCommunityCards,
  PNShowdown,
  PNWinner,
  PNSession,
  PNSettlement,
  PNSessionRecap,
} from './types';

// ── CSV parsing ──────────────────────────────────────────────────

interface RawRow {
  entry: string;
  at: Date;
  order: number;
}

/** Parse the raw CSV text into rows, sorted chronologically (oldest first). */
function parseCSV(text: string): RawRow[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  // Validate header
  const header = lines[0].trim();
  if (header !== 'entry,at,order') {
    throw new Error('Not a PokerNow log: expected "entry,at,order" header');
  }

  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // PokerNow CSV uses quoted fields with escaped inner quotes
    // Format: "entry text",2026-04-12T17:04:10.288Z,177601345028801
    // The entry field may contain commas, quotes (doubled), and newlines
    const match = line.match(/^"(.*)",(\d{4}-\d{2}-\d{2}T[\d:.]+Z),(\d+)$/);
    if (!match) {
      // Try unquoted entry (some rows like header-like lines)
      const simple = line.match(/^([^,]+),(\d{4}-\d{2}-\d{2}T[\d:.]+Z),(\d+)$/);
      if (simple) {
        rows.push({ entry: simple[1], at: new Date(simple[2]), order: Number(simple[3]) });
      }
      // Skip unparseable rows silently
      continue;
    }

    // Unescape doubled quotes in the entry field
    const entry = match[1].replace(/""/g, '"');
    rows.push({ entry, at: new Date(match[2]), order: Number(match[3]) });
  }

  // PokerNow logs are reverse-chronological; sort to chronological
  rows.sort((a, b) => a.order - b.order);
  return rows;
}

// ── Player identity ──────────────────────────────────────────────

// Pattern: "DisplayName @ UniqueID"
const PLAYER_RE = /"([^@]+?) @ ([A-Za-z0-9_-]+)"/;

function parsePlayer(text: string): { name: string; id: string } | null {
  const m = text.match(PLAYER_RE);
  if (!m) return null;
  return { name: m[1].trim(), id: m[2] };
}

function registerPlayer(players: Map<string, PNPlayer>, id: string, name: string): void {
  const existing = players.get(id);
  if (existing) {
    existing.displayName = name;
    if (!existing.aliases.includes(name)) existing.aliases.push(name);
  } else {
    players.set(id, { id, displayName: name, aliases: [name] });
  }
}

// ── Event pattern matchers ───────────────────────────────────────

const STARTING_HAND_RE = /^-- starting hand #(\d+)(?: \(id: ([a-z0-9]+)\))?\s+(.+?) \(dealer: "(.+?) @ ([A-Za-z0-9_-]+)"\) --$/;
const ENDING_HAND_RE = /^-- ending hand #(\d+) --$/;
const PLAYER_STACKS_RE = /^Player stacks: (.+)$/;
const STACK_ENTRY_RE = /#(\d+) "(.+?) @ ([A-Za-z0-9_-]+)" \(([\d.]+)\)/g;

const POST_BLIND_RE = /^"(.+?) @ ([A-Za-z0-9_-]+)" posts a (small|big) blind of ([\d.]+)$/;
const FOLD_RE = /^"(.+?) @ ([A-Za-z0-9_-]+)" folds$/;
const CHECK_RE = /^"(.+?) @ ([A-Za-z0-9_-]+)" checks$/;
const CALL_RE = /^"(.+?) @ ([A-Za-z0-9_-]+)" calls ([\d.]+)$/;
const BET_RE = /^"(.+?) @ ([A-Za-z0-9_-]+)" bets ([\d.]+)$/;
const RAISE_RE = /^"(.+?) @ ([A-Za-z0-9_-]+)" raises to ([\d.]+)$/;
const CALL_ALLIN_RE = /^"(.+?) @ ([A-Za-z0-9_-]+)" calls ([\d.]+) and go all in$/;
const RAISE_ALLIN_RE = /^"(.+?) @ ([A-Za-z0-9_-]+)" raises to ([\d.]+) and go all in$/;

const FLOP_RE = /^Flop:\s+\[(.+?)\]$/;
const TURN_RE = /^Turn: .+ \[(.+?)\]$/;
const RIVER_RE = /^River: .+ \[(.+?)\]$/;

const SHOWS_RE = /^"(.+?) @ ([A-Za-z0-9_-]+)" shows a (.+?)\.$/;
const COLLECTED_RE = /^"(.+?) @ ([A-Za-z0-9_-]+)" collected ([\d.]+) from pot(?:\s+with (.+?))?(?:\s+\(combination: (.+?)\))?$/;
const UNCALLED_RE = /^Uncalled bet of ([\d.]+) returned to "(.+?) @ ([A-Za-z0-9_-]+)"$/;

const JOINED_RE = /^The player "(.+?) @ ([A-Za-z0-9_-]+)" joined the game with a stack of ([\d.]+)\.$/;
const QUIT_RE = /^The player "(.+?) @ ([A-Za-z0-9_-]+)" quits the game with a stack of ([\d.]+)\.$/;
const STANDUP_RE = /^The player "(.+?) @ ([A-Za-z0-9_-]+)" stand up with the stack of ([\d.]+)\.$/;
const ADMIN_STACK_RE = /^The admin updated the player "(.+?) @ ([A-Za-z0-9_-]+)" stack from ([\d.]+) to ([\d.]+)\.$/;

// ── Main parser ──────────────────────────────────────────────────

export function parsePokerNowLog(csvText: string): PNSession {
  const rows = parseCSV(csvText);
  if (rows.length === 0) throw new Error('Empty log file');

  const players = new Map<string, PNPlayer>();
  const buyIns: PNBuyIn[] = [];
  const cashOuts: PNCashOut[] = [];
  const hands: PNHand[] = [];

  let currentHand: Partial<PNHand> | null = null;

  // Track whether each player is currently "active" (has a counted buy-in,
  // hasn't quit since). A "joined" event is a real buy-in ONLY if the player
  // is NOT active. This correctly handles:
  //   - First join → active=false → buy-in, set active
  //   - Stand-up → joined → active=true → skip (sit-back)
  //   - Sit-back → joined → active=true → skip (redundant PokerNow event)
  //   - Quit → joined → active cleared on quit → buy-in (rebuy)
  //   - Admin approval → stand-up → sit-back → joined → active=false → buy-in
  const activePlayers = new Set<string>();

  for (const row of rows) {
    const { entry, at } = row;

    // ── Hand lifecycle ─────────────────────────────────────────
    const startMatch = entry.match(STARTING_HAND_RE);
    if (startMatch) {
      currentHand = {
        handNumber: parseInt(startMatch[1]),
        handId: startMatch[2] || undefined,
        variant: startMatch[3].trim(),
        dealer: { playerName: startMatch[4], playerId: startMatch[5] },
        playerStacks: [],
        actions: [],
        communityCards: {},
        showdowns: [],
        winners: [],
        uncalledBets: [],
        startedAt: at,
        endedAt: at,
      };
      registerPlayer(players, startMatch[5], startMatch[4]);
      continue;
    }

    const endMatch = entry.match(ENDING_HAND_RE);
    if (endMatch && currentHand) {
      currentHand.endedAt = at;
      hands.push(currentHand as PNHand);
      currentHand = null;
      continue;
    }

    // ── Player stacks ──────────────────────────────────────────
    const stackMatch = entry.match(PLAYER_STACKS_RE);
    if (stackMatch && currentHand) {
      const stacksStr = stackMatch[1];
      let m;
      STACK_ENTRY_RE.lastIndex = 0;
      while ((m = STACK_ENTRY_RE.exec(stacksStr)) !== null) {
        currentHand.playerStacks!.push({
          seatNumber: parseInt(m[1]),
          playerName: m[2],
          playerId: m[3],
          stack: parseFloat(m[4]),
        });
        registerPlayer(players, m[3], m[2]);
      }
      continue;
    }

    // ── Player actions ─────────────────────────────────────────
    if (currentHand) {
      let action: PNActionType | null = null;
      let actorName = '';
      let actorId = '';

      let m;
      if ((m = entry.match(POST_BLIND_RE))) {
        [, actorName, actorId] = m;
        action = { type: 'post-blind', blind: m[3] as 'small' | 'big', amount: parseFloat(m[4]) };
      } else if ((m = entry.match(FOLD_RE))) {
        [, actorName, actorId] = m;
        action = { type: 'fold' };
      } else if ((m = entry.match(CHECK_RE))) {
        [, actorName, actorId] = m;
        action = { type: 'check' };
      } else if ((m = entry.match(CALL_ALLIN_RE))) {
        [, actorName, actorId] = m;
        action = { type: 'all-in-call', amount: parseFloat(m[3]) };
      } else if ((m = entry.match(RAISE_ALLIN_RE))) {
        [, actorName, actorId] = m;
        action = { type: 'all-in-raise', amount: parseFloat(m[3]) };
      } else if ((m = entry.match(CALL_RE))) {
        [, actorName, actorId] = m;
        action = { type: 'call', amount: parseFloat(m[3]) };
      } else if ((m = entry.match(BET_RE))) {
        [, actorName, actorId] = m;
        action = { type: 'bet', amount: parseFloat(m[3]) };
      } else if ((m = entry.match(RAISE_RE))) {
        [, actorName, actorId] = m;
        action = { type: 'raise', amount: parseFloat(m[3]) };
      }

      if (action) {
        currentHand.actions!.push({ playerId: actorId, playerName: actorName, action, timestamp: at });
        registerPlayer(players, actorId, actorName);
        continue;
      }

      // ── Community cards ────────────────────────────────────────
      const flopMatch = entry.match(FLOP_RE);
      if (flopMatch) {
        const cards = flopMatch[1].split(',').map(c => c.trim());
        currentHand.communityCards!.flop = cards as [string, string, string];
        continue;
      }
      const turnMatch = entry.match(TURN_RE);
      if (turnMatch) {
        currentHand.communityCards!.turn = turnMatch[1].trim();
        continue;
      }
      const riverMatch = entry.match(RIVER_RE);
      if (riverMatch) {
        currentHand.communityCards!.river = riverMatch[1].trim();
        continue;
      }

      // ── Showdown ───────────────────────────────────────────────
      const showsMatch = entry.match(SHOWS_RE);
      if (showsMatch) {
        const cards = showsMatch[3].split(',').map(c => c.trim()) as [string, string];
        currentHand.showdowns!.push({ playerId: showsMatch[2], playerName: showsMatch[1], cards });
        registerPlayer(players, showsMatch[2], showsMatch[1]);
        continue;
      }

      const collectedMatch = entry.match(COLLECTED_RE);
      if (collectedMatch) {
        currentHand.winners!.push({
          playerId: collectedMatch[2],
          playerName: collectedMatch[1],
          amount: parseFloat(collectedMatch[3]),
          handDescription: collectedMatch[4] || undefined,
          combination: collectedMatch[5] || undefined,
        });
        registerPlayer(players, collectedMatch[2], collectedMatch[1]);
        continue;
      }

      const uncalledMatch = entry.match(UNCALLED_RE);
      if (uncalledMatch) {
        currentHand.uncalledBets!.push({
          playerId: uncalledMatch[3],
          amount: parseFloat(uncalledMatch[1]),
        });
        continue;
      }
    }

    // ── Session-level events ───────────────────────────────────
    const joinMatch = entry.match(JOINED_RE);
    if (joinMatch) {
      const [, name, id, stack] = joinMatch;
      registerPlayer(players, id, name);

      if (activePlayers.has(id)) {
        // Player is already active (hasn't quit since last buy-in).
        // This "joined" is a sit-back or redundant event, not new money.
      } else {
        // Player is not active: first join or re-entry after quit = real buy-in.
        buyIns.push({ playerId: id, playerName: name, amount: parseFloat(stack), timestamp: at });
        activePlayers.add(id);
      }
      continue;
    }

    const quitMatch = entry.match(QUIT_RE);
    if (quitMatch) {
      const [, name, id, stack] = quitMatch;
      cashOuts.push({ playerId: id, playerName: name, amount: parseFloat(stack), timestamp: at });
      registerPlayer(players, id, name);
      // Player fully left — clear active state so next join is a real buy-in.
      activePlayers.delete(id);
      continue;
    }

    const standMatch = entry.match(STANDUP_RE);
    if (standMatch) {
      // Stand-up = player temporarily left. They remain "active" (don't clear
      // activePlayers) because they haven't quit. If they rejoin, the "joined"
      // event will be correctly skipped as a sit-back.
      registerPlayer(players, standMatch[2], standMatch[1]);
      continue;
    }

    // Admin stack adjustments are rebuys/add-ons done outside the join/quit flow
    const adminStackMatch = entry.match(ADMIN_STACK_RE);
    if (adminStackMatch) {
      const [, name, id, fromStr, toStr] = adminStackMatch;
      const from = parseFloat(fromStr);
      const to = parseFloat(toStr);
      if (to > from) {
        // Positive adjustment = chips added = rebuy/add-on
        buyIns.push({ playerId: id, playerName: name, amount: to - from, timestamp: at });
        registerPlayer(players, id, name);
      }
      continue;
    }

    // Other events (config changes, seat requests, etc.) are skipped
  }

  const timestamps = rows.map(r => r.at.getTime());
  return {
    hands,
    buyIns,
    cashOuts,
    players,
    startedAt: new Date(Math.min(...timestamps)),
    endedAt: new Date(Math.max(...timestamps)),
  };
}

// ── Settlement computation ───────────────────────────────────────

export function computeSettlements(session: PNSession): PNSettlement[] {
  const settlements: PNSettlement[] = [];

  // Build a map of last known stack per player from the most recent hand
  const lastKnownStacks = new Map<string, number>();
  for (const hand of session.hands) {
    for (const ps of hand.playerStacks) {
      lastKnownStacks.set(ps.playerId, ps.stack);
    }
  }

  // Determine if each player is still at the table by checking whether
  // their last lifecycle event is a join (no subsequent quit).
  // Timeline: join/quit events sorted chronologically.
  type LifecycleEvent = { type: 'join' | 'quit'; timestamp: Date; amount: number };
  const lifecycles = new Map<string, LifecycleEvent[]>();

  for (const b of session.buyIns) {
    const events = lifecycles.get(b.playerId) ?? [];
    events.push({ type: 'join', timestamp: b.timestamp, amount: b.amount });
    lifecycles.set(b.playerId, events);
  }
  for (const c of session.cashOuts) {
    const events = lifecycles.get(c.playerId) ?? [];
    events.push({ type: 'quit', timestamp: c.timestamp, amount: c.amount });
    lifecycles.set(c.playerId, events);
  }
  for (const events of lifecycles.values()) {
    events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  for (const [playerId, player] of session.players) {
    const events = lifecycles.get(playerId) ?? [];
    const totalBuyIn = events.filter(e => e.type === 'join').reduce((sum, e) => sum + e.amount, 0);
    let totalCashOut = events.filter(e => e.type === 'quit').reduce((sum, e) => sum + e.amount, 0);

    // If the player's last event is a join (still at the table), add their
    // last known stack from the most recent hand they appeared in.
    const lastEvent = events[events.length - 1];
    const stillAtTable = lastEvent?.type === 'join';
    if (stillAtTable && lastKnownStacks.has(playerId)) {
      totalCashOut += lastKnownStacks.get(playerId)!;
    }

    const handsPlayed = session.hands.filter(h =>
      h.playerStacks.some(s => s.playerId === playerId)
    ).length;

    // Skip players with no buy-in and no hands (observers, admins)
    if (totalBuyIn === 0 && handsPlayed === 0) continue;

    settlements.push({
      player,
      totalBuyIn,
      totalCashOut,
      netResult: totalCashOut - totalBuyIn,
      handsPlayed,
    });
  }

  settlements.sort((a, b) => b.netResult - a.netResult);
  return settlements;
}

// ── Session recap ────────────────────────────────────────────────

export function buildRecap(session: PNSession): PNSessionRecap {
  const settlements = computeSettlements(session);

  // Find biggest pot by summing collected amounts per hand
  let biggestPot = { handNumber: 0, amount: 0 };
  for (const hand of session.hands) {
    const potTotal = hand.winners.reduce((sum, w) => sum + w.amount, 0);
    if (potTotal > biggestPot.amount) {
      biggestPot = { handNumber: hand.handNumber, amount: potTotal };
    }
  }

  const withHands = settlements.filter(s => s.handsPlayed > 0);

  return {
    session,
    settlements,
    stats: {
      totalHands: session.hands.length,
      durationMs: session.endedAt.getTime() - session.startedAt.getTime(),
      biggestPot,
      biggestWinner: withHands.length > 0 ? withHands[0] : null,
      biggestLoser: withHands.length > 0 ? withHands[withHands.length - 1] : null,
    },
  };
}
