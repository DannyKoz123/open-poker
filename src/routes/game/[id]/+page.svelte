<script lang="ts">
  import { page } from '$app/state';
  import { browser } from '$app/environment';
  import { formatStakePair, formatChips, centsToDollars, dollarsToCents } from '$lib/chips';
  import { resolvePlayerIdentity } from '$lib/identity/device';
  import type { ClientMessage, ServerMessage, RoomInfo } from '$lib/types/messages';
  import type { AccountIdentity } from '$lib/types/identity';
  import type { GameState, AvailableActions, Card, ActionType } from '$lib/types/poker';

  let ws: WebSocket | null = null;
  let playerId = $state('');
  let playerName = $state('');
  let room = $state<RoomInfo | null>(null);
  let gameState = $state<GameState | null>(null);
  let availableActions = $state<AvailableActions | null>(null);
  let raiseAmount = $state(0);
  let connected = $state(false);
  let seated = $state(false);
  let winners = $state<{ playerId: string; amount: number; description?: string }[]>([]);
  let lastCompletedHandId = $state<string | null>(null);
  let showWinners = $state(false);
  let identityReady = $state(false);
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const roomId = $derived(page.params.id);
  const authAccount = $derived((page.data.auth?.account as AccountIdentity | null | undefined) ?? null);
  let activeIdentityKey = '';

  $effect(() => {
    if (!browser) return;

    const urlName = new URL(window.location.href).searchParams.get('name');
    const identity = resolvePlayerIdentity(authAccount, urlName);
    const identityKey = `${identity.playerId}:${identity.playerName}`;

    playerId = identity.playerId;
    playerName = identity.playerName;
    identityReady = true;

    if (identityKey !== activeIdentityKey) {
      activeIdentityKey = identityKey;
      connect();
    }

    return () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        const existing = ws;
        ws = null;
        existing.onclose = null;
        existing.close();
      }
    };
  });

  function connect() {
    if (!playerId || !playerName) return;

    if (ws) {
      const old = ws;
      ws = null;
      old.onclose = null;
      old.close();
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // In dev mode, WS server runs on a separate port
    const isDev = window.location.port === '5173';
    const wsHost = isDev ? `${window.location.hostname}:5174` : window.location.host;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${wsHost}/ws/game/${roomId}?playerId=${playerId}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      connected = true;
      ws!.send(JSON.stringify({ type: 'join', name: playerName }));
    };

    ws.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data);
      handleMessage(msg);
    };

    ws.onclose = () => {
      connected = false;
      reconnectTimer = setTimeout(connect, 2000);
    };
  }

  function handleMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'room-state':
        room = msg.room;
        seated = room.seats.some(s => s?.playerId === playerId);
        break;
      case 'game-state':
        gameState = msg.state;
        availableActions = msg.availableActions;
        if (availableActions) {
          raiseAmount = availableActions.minRaise;
        }
        showWinners = false;
        break;
      case 'hand-complete':
        lastCompletedHandId = msg.handId;
        winners = msg.winners;
        showWinners = true;
        gameState = null;
        availableActions = null;
        break;
      case 'error':
        console.error('Server error:', msg.message);
        break;
    }
  }

  function send(msg: ClientMessage) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function sitDown(seatIndex: number) {
    send({ type: 'sit', seatIndex });
  }

  function doAction(type: ActionType, amount?: number) {
    send({ type: 'action', action: type, amount });
  }

  function clampRaise(value: number): number {
    if (!availableActions) return value;
    return Math.max(
      availableActions.minRaise,
      Math.min(availableActions.maxRaise, Math.round(value))
    );
  }

  function setRaise(value: number) {
    raiseAmount = clampRaise(value);
  }

  // Pot-fraction raise-to amount. pots[].amount already includes live bets
  // from the current round (the engine accumulates into pot[0] on every
  // bet/call/raise), so we must NOT add currentBet sums on top.
  // Pot-sized raise = the increment on top of a call equals the pot after calling.
  function potRaiseTo(fraction: number): number {
    if (!gameState || !availableActions) return 0;
    const pot = gameState.pots.reduce((s, p) => s + p.amount, 0);
    return gameState.currentBet + fraction * (pot + availableActions.callAmount);
  }

  function submitRaise() {
    if (!availableActions) return;
    doAction('raise', clampRaise(raiseAmount));
  }

  function startGame() {
    send({ type: 'start-game' });
  }

  function cardDisplay(card: Card): string {
    const suitSymbols: Record<string, string> = { h: '♥', d: '♦', c: '♣', s: '♠' };
    return `${card.rank}${suitSymbols[card.suit]}`;
  }

  function suitColor(card: Card): string {
    return card.suit === 'h' || card.suit === 'd' ? '#e94560' : '#e0e0e0';
  }

  function isMyTurn(): boolean {
    return availableActions !== null;
  }

  function seatedPlayerCount(): number {
    return room?.seats.filter(s => s !== null).length || 0;
  }

  function handReplayHref(handId: string): string {
    return `/hand/${encodeURIComponent(handId)}`;
  }
</script>

<svelte:head>
  <title>Open Poker - Table {roomId}</title>
</svelte:head>

{#if !identityReady}
  <div class="name-prompt">
    <h2>Loading table</h2>
    <p>Restoring your identity on this device.</p>
  </div>
{:else}
  <div class="game-layout">
    <!-- Table area -->
    <div class="table-area">
      <div class="poker-table">
        <!-- Community cards -->
        <div class="community">
          {#if gameState && gameState.communityCards.length > 0}
            {#each gameState.communityCards as card}
              <div class="card" style="color: {suitColor(card)}">{cardDisplay(card)}</div>
            {/each}
          {/if}
          {#if gameState}
            <div class="pot-display">
              Pot: {formatChips(gameState.pots.reduce((s, p) => s + p.amount, 0))}
            </div>
          {/if}
        </div>

        <!-- Winners overlay -->
        {#if showWinners && winners.length > 0}
          <div class="winners-overlay">
            {#each winners as w}
              <div class="winner-line">
                {room?.seats.find(s => s?.playerId === w.playerId)?.name || 'Unknown'} wins {formatChips(w.amount)}
                {#if w.description} with {w.description}{/if}
              </div>
            {/each}
          </div>
        {/if}

        <!-- Seats -->
        <div class="seats">
          {#each Array(room?.maxSeats || 9) as _, i}
            {@const seat = room?.seats[i]}
            {@const gamePlayer = gameState?.players.find(p => p.id === seat?.playerId)}
            <div
              class="seat"
              class:occupied={seat !== null}
              class:active-turn={gameState && gamePlayer && gameState.players[gameState.activePlayerIndex]?.id === seat?.playerId}
              class:dealer={gameState && gameState.dealerIndex === i}
              class:folded={gamePlayer?.status === 'folded'}
            >
              {#if seat}
                <div class="seat-name">{seat.name}</div>
                <div class="seat-chips">{formatChips(gamePlayer?.chips ?? seat.chips)}</div>
                {#if gamePlayer?.holeCards}
                  <div class="hole-cards">
                    {#each gamePlayer.holeCards as card}
                      <span class="card small" style="color: {suitColor(card)}">{cardDisplay(card)}</span>
                    {/each}
                  </div>
                {:else if gamePlayer && gamePlayer.status !== 'folded' && gamePlayer.status !== 'sitting-out'}
                  <div class="hole-cards">
                    <span class="card small face-down">🂠</span>
                    <span class="card small face-down">🂠</span>
                  </div>
                {/if}
                {#if gamePlayer && gamePlayer.currentBet > 0}
                  <div class="bet-amount">{formatChips(gamePlayer.currentBet)}</div>
                {/if}
                {#if gameState && gameState.dealerIndex === gameState.players.indexOf(gamePlayer!)}
                  <div class="dealer-button">D</div>
                {/if}
              {:else if !seated && !gameState}
                <button class="sit-btn" onclick={() => sitDown(i)}>Sit</button>
              {:else}
                <div class="empty-seat">Empty</div>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <!-- Actions -->
      {#if isMyTurn() && availableActions}
        <div class="actions">
          {#if availableActions.canFold}
            <button class="action-btn fold" onclick={() => doAction('fold')}>Fold</button>
          {/if}
          {#if availableActions.canCheck}
            <button class="action-btn check" onclick={() => doAction('check')}>Check</button>
          {/if}
          {#if availableActions.canCall}
            <button class="action-btn call" onclick={() => doAction('call')}>
              Call {formatChips(availableActions.callAmount)}
            </button>
          {/if}
          {#if availableActions.canRaise}
            {@const raiseActions = availableActions}
            <div class="raise-control">
              <div class="preset-row">
                <button class="preset-btn" onclick={() => setRaise(raiseActions.minRaise)}>
                  Min
                </button>
                <button class="preset-btn" onclick={() => setRaise(potRaiseTo(0.5))}>
                  ½ Pot
                </button>
                <button class="preset-btn" onclick={() => setRaise(potRaiseTo(0.75))}>
                  ¾ Pot
                </button>
                <button class="preset-btn" onclick={() => setRaise(potRaiseTo(1))}>
                  Pot
                </button>
                <button class="preset-btn" onclick={() => setRaise(raiseActions.maxRaise)}>
                  All In
                </button>
              </div>
              <div class="amount-row">
                <input
                  type="range"
                  min={raiseActions.minRaise}
                  max={raiseActions.maxRaise}
                  bind:value={raiseAmount}
                />
                <input
                  type="number"
                  class="amount-input"
                  min={centsToDollars(raiseActions.minRaise)}
                  max={centsToDollars(raiseActions.maxRaise)}
                  step="0.01"
                  value={centsToDollars(raiseAmount)}
                  onchange={(e) => setRaise(dollarsToCents(parseFloat(e.currentTarget.value) || 0))}
                />
                <button class="action-btn raise" onclick={submitRaise}>
                  Raise to {formatChips(clampRaise(raiseAmount))}
                </button>
              </div>
            </div>
          {/if}
          {#if availableActions.canAllIn}
            <button class="action-btn allin" onclick={() => doAction('all-in')}>
              All In {formatChips(availableActions.allInAmount)}
            </button>
          {/if}
        </div>
      {/if}

      <!-- Start game / waiting -->
      {#if !gameState && seated && !showWinners}
        <div class="waiting">
          {#if seatedPlayerCount() >= 2}
            <button class="start-btn" onclick={startGame}>Deal Cards</button>
          {:else}
            <p>Waiting for more players...</p>
          {/if}
        </div>
      {/if}

      {#if showWinners && !gameState}
        <div class="waiting">
          <div class="waiting-actions">
            <button class="start-btn" onclick={startGame}>Next Hand</button>
            {#if lastCompletedHandId}
              <a class="replay-btn" href={handReplayHref(lastCompletedHandId)}>Open replay route</a>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <!-- Sidebar: room info -->
    <div class="sidebar">
      <div class="room-info">
        <span class="room-id">Room: {roomId}</span>
        <button class="copy-btn" onclick={() => navigator.clipboard.writeText(window.location.href)}>
          Copy Link
        </button>
      </div>

      <div class="panel">
        <h3>Table Notes</h3>
        <ul>
          <li>Anonymous identity is saved on this device.</li>
          <li>Accounts are optional and sync identity across devices.</li>
          <li>Free forever, no money play.</li>
          <li>Completed hands now carry stable IDs for replay and PHH routes.</li>
        </ul>
      </div>

      <div class="panel">
        <h3>Status</h3>
        <ul>
          <li>Identity: {authAccount ? `@${authAccount.username}` : playerName}</li>
          <li>Connection: {connected ? 'connected' : 'reconnecting'}</li>
          <li>Blinds: {room ? formatStakePair(room.smallBlind, room.bigBlind) : '—'}</li>
          <li>Seats taken: {seatedPlayerCount()} / {room?.maxSeats ?? 9}</li>
          <li>
            Latest hand:
            {#if lastCompletedHandId}
              <a class="status-link" href={handReplayHref(lastCompletedHandId)}>{lastCompletedHandId}</a>
            {:else}
              —
            {/if}
          </li>
        </ul>
      </div>

      <div class="panel">
        <h3>Next major build</h3>
        <p>
          Permanent hand replay, PHH export, and fuller reconnect hardening are the next
          architectural milestones.
        </p>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #1a1a2e;
    color: #e0e0e0;
    overflow: hidden;
  }

  .name-prompt {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }

  .name-prompt p {
    margin: 0;
    color: #9aa6c2;
  }

  .game-layout {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  /* Mobile: stack vertically */
  @media (max-width: 768px) {
    .game-layout {
      flex-direction: column;
    }
    .sidebar {
      height: 200px !important;
      width: 100% !important;
      border-left: none !important;
      border-top: 1px solid #333 !important;
    }
  }

  .table-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    position: relative;
  }

  .poker-table {
    width: 100%;
    max-width: 700px;
    aspect-ratio: 16 / 10;
    background: radial-gradient(ellipse, #1b4d3e 0%, #0f3028 70%, #0a1f1a 100%);
    border: 4px solid #5d4e37;
    border-radius: 50%;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 40px rgba(0, 0, 0, 0.5), inset 0 0 60px rgba(0, 0, 0, 0.3);
  }

  .community {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    flex-direction: column;
  }

  .card {
    background: #fff;
    color: #333;
    padding: 0.4rem 0.5rem;
    border-radius: 4px;
    font-size: 1.1rem;
    font-weight: 700;
    display: inline-block;
    min-width: 2rem;
    text-align: center;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  }

  .card.small {
    font-size: 0.85rem;
    padding: 0.2rem 0.3rem;
    min-width: 1.5rem;
  }

  .card.face-down {
    background: #2a4a7f;
    color: #2a4a7f;
    font-size: 1.1rem;
  }

  .pot-display {
    color: #ffd700;
    font-weight: 600;
    font-size: 0.9rem;
    margin-top: 0.3rem;
  }

  .winners-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.85);
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    z-index: 10;
    text-align: center;
  }

  .winner-line {
    color: #ffd700;
    font-weight: 600;
    font-size: 0.95rem;
  }

  .seats {
    position: absolute;
    inset: 0;
  }

  .seat {
    position: absolute;
    width: 90px;
    text-align: center;
    font-size: 0.75rem;
  }

  /* Position 9 seats around the oval */
  .seat:nth-child(1) { top: 50%; left: -2%; transform: translateY(-50%); }
  .seat:nth-child(2) { top: 10%; left: 5%; }
  .seat:nth-child(3) { top: -8%; left: 25%; }
  .seat:nth-child(4) { top: -8%; left: 50%; transform: translateX(-50%); }
  .seat:nth-child(5) { top: -8%; right: 25%; }
  .seat:nth-child(6) { top: 10%; right: 5%; }
  .seat:nth-child(7) { top: 50%; right: -2%; transform: translateY(-50%); }
  .seat:nth-child(8) { bottom: 5%; right: 20%; }
  .seat:nth-child(9) { bottom: 5%; left: 20%; }

  .seat.active-turn {
    outline: 2px solid #ffd700;
    outline-offset: 4px;
    border-radius: 8px;
  }

  .seat.folded {
    opacity: 0.4;
  }

  .seat-name {
    color: #fff;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .seat-chips {
    color: #aaa;
    font-size: 0.7rem;
  }

  .hole-cards {
    display: flex;
    gap: 2px;
    justify-content: center;
    margin-top: 2px;
  }

  .bet-amount {
    color: #ffd700;
    font-size: 0.7rem;
    font-weight: 600;
    margin-top: 2px;
  }

  .dealer-button {
    display: inline-block;
    width: 18px;
    height: 18px;
    background: #ffd700;
    color: #000;
    border-radius: 50%;
    font-size: 0.6rem;
    font-weight: 700;
    line-height: 18px;
    margin-top: 2px;
  }

  .sit-btn {
    padding: 0.3rem 0.6rem;
    border: 1px dashed #555;
    border-radius: 6px;
    background: transparent;
    color: #888;
    cursor: pointer;
    font-size: 0.75rem;
  }

  .sit-btn:hover {
    border-color: #e94560;
    color: #e94560;
  }

  .empty-seat {
    color: #444;
    font-size: 0.7rem;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
  }

  .action-btn {
    padding: 0.6rem 1.2rem;
    border: none;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    color: #fff;
  }

  .action-btn.fold { background: #666; }
  .action-btn.check { background: #2a7a4a; }
  .action-btn.call { background: #2a6a9a; }
  .action-btn.raise { background: #e94560; }
  .action-btn.allin { background: #d4a520; color: #000; }

  .raise-control {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
  }

  .preset-row {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .preset-btn {
    padding: 0.35rem 0.65rem;
    border: 1px solid #3a4766;
    border-radius: 6px;
    background: #1e2a44;
    color: #e0e0e0;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
  }

  .preset-btn:hover {
    border-color: #e94560;
    color: #fff;
  }

  .amount-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .raise-control input[type="range"] {
    width: 120px;
    accent-color: #e94560;
  }

  .amount-input {
    width: 80px;
    padding: 0.4rem 0.5rem;
    border: 1px solid #3a4766;
    border-radius: 6px;
    background: #16213e;
    color: #fff;
    font-size: 0.85rem;
    font-weight: 600;
    text-align: right;
    appearance: textfield;
    -moz-appearance: textfield;
  }

  .amount-input::-webkit-outer-spin-button,
  .amount-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .waiting {
    margin-top: 1rem;
    text-align: center;
  }

  .waiting-actions {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
  }

  .start-btn {
    padding: 0.75rem 2rem;
    border: none;
    border-radius: 8px;
    background: #e94560;
    color: #fff;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }

  .replay-btn {
    padding: 0.75rem 1.1rem;
    border: 1px solid #3a4766;
    border-radius: 8px;
    background: #16213e;
    color: #d7deea;
    font-size: 0.95rem;
    font-weight: 600;
    text-decoration: none;
  }

  .replay-btn:hover,
  .status-link:hover {
    color: #fff;
    border-color: #e94560;
  }

  .sidebar {
    width: 280px;
    border-left: 1px solid #333;
    display: flex;
    flex-direction: column;
    background: #16213e;
    overflow-y: auto;
  }

  .room-info {
    padding: 0.75rem;
    border-bottom: 1px solid #333;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .room-id {
    font-size: 0.85rem;
    color: #888;
  }

  .copy-btn {
    padding: 0.3rem 0.6rem;
    border: 1px solid #555;
    border-radius: 4px;
    background: transparent;
    color: #aaa;
    cursor: pointer;
    font-size: 0.75rem;
  }

  .panel {
    padding: 0.9rem 0.75rem;
    border-bottom: 1px solid #253250;
  }

  .panel h3 {
    margin: 0 0 0.6rem;
    font-size: 0.9rem;
    color: #f1f3f8;
  }

  .panel ul {
    margin: 0;
    padding-left: 1rem;
    color: #aeb7c6;
    font-size: 0.85rem;
    line-height: 1.45;
  }

  .status-link {
    color: #f0c66e;
    text-decoration: none;
    border-bottom: 1px solid transparent;
  }

  .panel p {
    margin: 0;
    color: #aeb7c6;
    font-size: 0.85rem;
    line-height: 1.45;
  }
</style>
