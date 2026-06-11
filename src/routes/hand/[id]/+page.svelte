<script lang="ts">
  import { page } from '$app/state';
  import { formatChips, formatStakePair } from '$lib/chips';
  import type { ReplayHand } from '$lib/analysis/replay/types';
  import type { Card } from '$lib/types/poker';

  const replayHand = $derived(page.data.replayHand as ReplayHand);
  const totalActions = $derived(
    replayHand.streets.reduce((sum, street) => sum + street.actions.length, 0),
  );

  function cardDisplay(card: Card): string {
    const suitSymbols: Record<Card['suit'], string> = { h: '♥', d: '♦', c: '♣', s: '♠' };
    return `${card.rank}${suitSymbols[card.suit]}`;
  }

  function suitClass(card: Card): 'red' | 'black' {
    return card.suit === 'h' || card.suit === 'd' ? 'red' : 'black';
  }
</script>

<svelte:head>
  <title>Open Poker - Hand {replayHand.handId}</title>
</svelte:head>

<div class="hand-shell">
  <p class="eyebrow">Hand Replay</p>
  <h1>Hand {replayHand.handId}</h1>
  <p class="lede">
    This route now loads a persisted replay model from the completed-hand archive. Full replay
    controls and PHH export wiring are next, but the server/data boundary is live.
  </p>

  <section class="summary-grid">
    <div class="stat">
      <span>Room</span>
      <strong>{replayHand.roomId}</strong>
    </div>
    <div class="stat">
      <span>Blinds</span>
      <strong>{formatStakePair(replayHand.smallBlind, replayHand.bigBlind)}</strong>
    </div>
    <div class="stat">
      <span>Seats</span>
      <strong>{replayHand.seats.length}</strong>
    </div>
    <div class="stat">
      <span>Actions</span>
      <strong>{totalActions}</strong>
    </div>
  </section>

  <section class="panel">
    <h2>Final Board</h2>
    {#if replayHand.finalBoard.length > 0}
      <div class="cards">
        {#each replayHand.finalBoard as card}
          <span class:red={suitClass(card) === 'red'} class="card">{cardDisplay(card)}</span>
        {/each}
      </div>
    {:else}
      <p class="muted">This hand ended before any community cards were dealt.</p>
    {/if}
  </section>

  <section class="panel">
    <h2>Winners</h2>
    <ul class="list">
      {#each replayHand.winners as winner}
        <li>
          <strong>{winner.name}</strong> won {formatChips(winner.amount)}
          {#if winner.description} with {winner.description}{/if}
        </li>
      {/each}
    </ul>
  </section>

  <section class="panel">
    <h2>Streets</h2>
    <div class="street-list">
      {#each replayHand.streets as street}
        <article class="street">
          <div class="street-header">
            <div>
              <h3>{street.street}</h3>
              <p>{street.actions.length} action{street.actions.length === 1 ? '' : 's'}</p>
            </div>
            <div class="street-pot">Pot {formatChips(street.potAtEnd)}</div>
          </div>

          {#if street.board.length > 0}
            <div class="cards compact">
              {#each street.board as card}
                <span class:red={suitClass(card) === 'red'} class="card">{cardDisplay(card)}</span>
              {/each}
            </div>
          {/if}

          {#if street.actions.length > 0}
            <ul class="list compact-list">
              {#each street.actions as action}
                <li>
                  <strong>{action.playerName}</strong> {action.type}
                  {#if action.amount !== null} to {formatChips(action.amount)}{/if}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted">No player actions on this street.</p>
          {/if}
        </article>
      {/each}
    </div>
  </section>

  <section class="panel">
    <h2>Showdown</h2>
    {#if replayHand.showdown}
      <ul class="list">
        {#each replayHand.showdown.players as player}
          <li>
            <strong>{player.name}</strong>
            <span class="cards-inline">
              {#each player.holeCards as card}
                <span class:red={suitClass(card) === 'red'} class="card inline-card">{cardDisplay(card)}</span>
              {/each}
            </span>
            {player.evaluation.description}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">No showdown cards were revealed for this hand.</p>
    {/if}
  </section>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #101724;
    color: #eef2f7;
  }

  .hand-shell {
    max-width: 880px;
    margin: 0 auto;
    min-height: 100vh;
    padding: 2rem 1.25rem 3rem;
  }

  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #caa66b;
    font-size: 0.8rem;
    margin: 0 0 0.5rem;
  }

  h1 {
    margin: 0 0 1rem;
    font-size: clamp(2rem, 4vw, 3.2rem);
  }

  h2 {
    margin: 0 0 0.9rem;
    font-size: 1.05rem;
  }

  h3 {
    margin: 0;
    font-size: 0.95rem;
    text-transform: capitalize;
  }

  .lede,
  .muted,
  .street-header p {
    color: #b9c4d4;
  }

  .lede {
    margin: 0 0 1.5rem;
    line-height: 1.6;
    max-width: 64ch;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .stat,
  .panel,
  .street {
    border: 1px solid #243149;
    border-radius: 14px;
    background: rgba(15, 24, 39, 0.75);
  }

  .stat {
    padding: 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .stat span {
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #92a3bc;
  }

  .stat strong {
    font-size: 1rem;
  }

  .panel {
    padding: 1rem;
    margin-top: 1rem;
  }

  .cards,
  .cards-inline {
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
    align-items: center;
  }

  .cards.compact {
    margin: 0.75rem 0 0;
  }

  .card {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2.2rem;
    padding: 0.45rem 0.55rem;
    border-radius: 8px;
    background: #f7f8fb;
    color: #16213e;
    font-weight: 700;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  }

  .inline-card {
    min-width: 1.8rem;
    padding: 0.3rem 0.45rem;
    font-size: 0.9rem;
  }

  .red {
    color: #d63f62;
  }

  .list {
    margin: 0;
    padding-left: 1.1rem;
    line-height: 1.55;
  }

  .compact-list {
    margin-top: 0.75rem;
  }

  .street-list {
    display: grid;
    gap: 0.85rem;
  }

  .street {
    padding: 0.95rem;
  }

  .street-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: baseline;
  }

  .street-header p {
    margin: 0.2rem 0 0;
  }

  .street-pot {
    color: #f0c66e;
    font-weight: 600;
    white-space: nowrap;
  }

  @media (max-width: 640px) {
    .hand-shell {
      padding: 1.5rem 1rem 2rem;
    }

    .street-header {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
