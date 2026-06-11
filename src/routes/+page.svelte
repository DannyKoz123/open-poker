<script lang="ts">
  import { browser } from '$app/environment';
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { formatStakePair } from '$lib/chips';
  import { getStoredDeviceIdentity, setAnonymousName } from '$lib/identity/device';
  import type { AccountIdentity } from '$lib/types/identity';

  // Chip unit = 1 cent. Each preset is [smallBlind, bigBlind] in cents.
  const STAKES: Array<[number, number]> = [
    [1, 2],
    [2, 5],
    [5, 10],
    [10, 25],
    [25, 50],
    [50, 100],
    [100, 200],
    [200, 500],
    [500, 1000],
    [1000, 2000],
    [2000, 5000],
  ];

  type StakeTier = 'Micro' | 'Low' | 'Mid' | 'High';

  // Tier thresholds by big blind (cents):
  //   Micro: up to 0.10 (10c)
  //   Low:   up to 2.00 (200c)
  //   Mid:   up to 10.00 (1000c)
  //   High:  above 10.00
  function stakeTier(bigBlind: number): StakeTier {
    if (bigBlind <= 10) return 'Micro';
    if (bigBlind <= 200) return 'Low';
    if (bigBlind <= 1000) return 'Mid';
    return 'High';
  }

  const authAccount = $derived((page.data.auth?.account as AccountIdentity | null | undefined) ?? null);

  let playerName = $state('');
  let creatingRoom = $state(false);
  let createError = $state('');
  let showCustom = $state(false);
  let customSb = $state('0.05');
  let customBb = $state('0.10');
  let authMode = $state<'signup' | 'login'>('signup');
  let authUsername = $state('');
  let authPassword = $state('');
  let authBusy = $state(false);
  let authError = $state('');

  $effect(() => {
    if (!browser) return;
    if (authAccount) {
      playerName = authAccount.username;
      return;
    }
    playerName = getStoredDeviceIdentity().anonymousName;
  });

  async function createRoomAt(smallBlind: number, bigBlind: number) {
    if (creatingRoom) return;
    creatingRoom = true;
    createError = '';
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smallBlind, bigBlind }),
      });
      if (!response.ok) {
        throw new Error(`Failed to create room (${response.status})`);
      }
      const data = (await response.json()) as { roomId: string };
      if (!authAccount) {
        setAnonymousName(playerName);
      }
      await goto(`/game/${data.roomId}`);
    } catch (err) {
      createError = 'Could not create a room. Try again.';
      console.error(err);
    } finally {
      creatingRoom = false;
    }
  }

  function parseDollarsToCents(value: string): number | null {
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  }

  function createCustom() {
    const sb = parseDollarsToCents(customSb);
    const bb = parseDollarsToCents(customBb);
    if (sb === null || bb === null || sb >= bb) {
      createError = 'Enter valid blinds (big blind must be greater than small blind).';
      return;
    }
    void createRoomAt(sb, bb);
  }

  async function submitAuth() {
    if (authBusy) return;

    authBusy = true;
    authError = '';

    try {
      const response = await fetch(`/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: authUsername,
          password: authPassword,
        }),
      });

      if (!response.ok) {
        const message = (await response.text()).trim();
        throw new Error(message || `Failed to ${authMode}.`);
      }

      authPassword = '';
      await invalidateAll();
    } catch (err) {
      authError = err instanceof Error ? err.message : 'Authentication failed.';
    } finally {
      authBusy = false;
    }
  }

  async function logout() {
    if (authBusy) return;

    authBusy = true;
    authError = '';

    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to log out.');
      }
      await invalidateAll();
      playerName = getStoredDeviceIdentity().anonymousName;
    } catch (err) {
      authError = err instanceof Error ? err.message : 'Failed to log out.';
    } finally {
      authBusy = false;
    }
  }
</script>

<svelte:head>
  <title>Open Poker</title>
</svelte:head>

<div class="landing">
  <header class="hero">
    <h1>Open Poker</h1>
    <p class="subtitle">Free, open-source poker with friends. Anonymous by default, account optional.</p>
  </header>

  <div class="name-row">
    {#if authAccount}
      <input type="text" value={authAccount.username} disabled />
      <span class="identity-pill">Account identity</span>
    {:else}
      <input
        type="text"
        bind:value={playerName}
        placeholder="Anonymous name (optional)"
        maxlength="20"
      />
    {/if}
  </div>

  <section class="auth-panel">
    {#if authAccount}
      <div class="auth-summary">
        <div>
          <p class="auth-kicker">Signed in</p>
          <p class="auth-value">@{authAccount.username}</p>
        </div>
        <button class="auth-button secondary" onclick={logout} disabled={authBusy}>
          {authBusy ? 'Working…' : 'Log out'}
        </button>
      </div>
    {:else}
      <div class="auth-tabs">
        <button
          class:active={authMode === 'signup'}
          class="auth-tab"
          onclick={() => {
            authMode = 'signup';
            authError = '';
          }}
        >
          Create account
        </button>
        <button
          class:active={authMode === 'login'}
          class="auth-tab"
          onclick={() => {
            authMode = 'login';
            authError = '';
          }}
        >
          Log in
        </button>
      </div>
      <div class="auth-fields">
        <input
          type="text"
          bind:value={authUsername}
          placeholder="Username"
          maxlength="20"
          autocapitalize="off"
          autocorrect="off"
        />
        <input
          type="password"
          bind:value={authPassword}
          placeholder="Password"
          onkeydown={(e) => e.key === 'Enter' && submitAuth()}
        />
        <button class="auth-button" onclick={submitAuth} disabled={authBusy}>
          {authBusy ? 'Working…' : authMode === 'signup' ? 'Create account' : 'Log in'}
        </button>
      </div>
      <p class="auth-copy">
        Use an account only if you want the same identity across devices. Anonymous stays the
        default on this browser.
      </p>
    {/if}

    {#if authError}
      <p class="error auth-error">{authError}</p>
    {/if}
  </section>

  <div class="stake-grid">
    {#each STAKES as [sb, bb]}
      {@const tier = stakeTier(bb)}
      <button
        class="stake-btn tier-{tier.toLowerCase()}"
        disabled={creatingRoom}
        onclick={() => void createRoomAt(sb, bb)}
      >
        <span class="stake-amount">{formatStakePair(sb, bb)}</span>
        <span class="stake-label">{tier}</span>
      </button>
    {/each}
    <button
      class="stake-btn custom"
      class:active={showCustom}
      disabled={creatingRoom}
      onclick={() => (showCustom = !showCustom)}
    >
      <span class="stake-amount">Custom</span>
      <span class="stake-label">Pick your blinds</span>
    </button>
  </div>

  {#if showCustom}
    <div class="custom-form">
      <label>
        <span>Small blind</span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          bind:value={customSb}
          onkeydown={(e) => e.key === 'Enter' && createCustom()}
        />
      </label>
      <label>
        <span>Big blind</span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          bind:value={customBb}
          onkeydown={(e) => e.key === 'Enter' && createCustom()}
        />
      </label>
      <button class="create-custom" onclick={createCustom} disabled={creatingRoom}>
        {creatingRoom ? 'Creating...' : 'Create table'}
      </button>
    </div>
  {/if}

  {#if createError}
    <p class="error">{createError}</p>
  {/if}

  <p class="hint">
    Buy-in is 100 big blinds. Play money only. Accounts are optional and only used for identity continuity.
  </p>

  <footer>
    <span>AGPL-3.0</span>
    <span>Free forever, no money play</span>
  </footer>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #161512;
    color: #bababa;
  }

  .landing {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 3rem 1rem 2rem;
    gap: 1.5rem;
  }

  .hero {
    text-align: center;
  }

  h1 {
    font-size: 2.5rem;
    margin: 0;
    color: #f0f0f0;
    letter-spacing: -0.02em;
  }

  .subtitle {
    color: #7a7a7a;
    margin: 0.35rem 0 0;
    font-size: 1rem;
  }

  .name-row {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
  }

  .name-row input {
    padding: 0.65rem 0.9rem;
    border: 1px solid #2a2a27;
    border-radius: 6px;
    background: #1d1c19;
    color: #e0e0e0;
    font-size: 0.95rem;
    width: 260px;
  }

  .name-row input::placeholder {
    color: #5a5a57;
  }

  .name-row input:disabled {
    opacity: 0.8;
    cursor: default;
  }

  .identity-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.35rem 0.55rem;
    border-radius: 999px;
    background: #1d2d20;
    border: 1px solid #324f39;
    color: #8fcb74;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .auth-panel {
    width: 100%;
    max-width: 560px;
    padding: 1rem;
    border: 1px solid #2a2a27;
    border-radius: 8px;
    background: #171613;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .auth-summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .auth-kicker {
    margin: 0;
    color: #6f6f6b;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .auth-value {
    margin: 0.15rem 0 0;
    color: #f0f0f0;
    font-size: 1rem;
    font-weight: 600;
  }

  .auth-tabs {
    display: inline-flex;
    gap: 0.35rem;
  }

  .auth-tab {
    padding: 0.45rem 0.7rem;
    border: 1px solid #30302c;
    border-radius: 999px;
    background: transparent;
    color: #8f8f8a;
    font-size: 0.82rem;
    cursor: pointer;
  }

  .auth-tab.active {
    border-color: #4b6a99;
    background: #1a2331;
    color: #dce8ff;
  }

  .auth-fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
    gap: 0.6rem;
  }

  .auth-fields input {
    padding: 0.65rem 0.8rem;
    border: 1px solid #2a2a27;
    border-radius: 6px;
    background: #12110f;
    color: #e0e0e0;
    font-size: 0.92rem;
  }

  .auth-button {
    padding: 0.65rem 1rem;
    border: none;
    border-radius: 6px;
    background: #3f6ab4;
    color: #fff;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
  }

  .auth-button.secondary {
    background: #2f3744;
  }

  .auth-button:disabled {
    opacity: 0.65;
    cursor: wait;
  }

  .auth-copy {
    margin: 0;
    color: #6f6f6b;
    font-size: 0.8rem;
    line-height: 1.45;
  }

  .auth-error {
    margin-top: -0.2rem;
  }

  .stake-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.4rem;
    width: 100%;
    max-width: 560px;
  }

  @media (max-width: 560px) {
    .stake-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 380px) {
    .stake-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .stake-btn {
    aspect-ratio: 1 / 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    padding: 0.5rem;
    border: 1px solid #2a2a27;
    border-radius: 4px;
    background: #1d1c19;
    color: #d0d0d0;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }

  .stake-btn:hover:not(:disabled) {
    background: #262521;
    border-color: #3a3a36;
    color: #f0f0f0;
  }

  .stake-btn:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .stake-btn.custom {
    background: #1a1f2a;
    border-color: #2d3342;
  }

  .stake-btn.custom:hover:not(:disabled) {
    background: #222936;
    border-color: #3d4558;
  }

  .stake-btn.custom.active {
    background: #2a3244;
    border-color: #4a5774;
  }

  .stake-amount {
    font-size: 1.5rem;
    font-weight: 400;
    color: #f0f0f0;
    line-height: 1.1;
  }

  .stake-label {
    font-size: 0.78rem;
    color: #6a6a67;
    letter-spacing: 0.02em;
  }

  .stake-btn.tier-micro .stake-label { color: #7eb356; }
  .stake-btn.tier-low .stake-label   { color: #6db4c2; }
  .stake-btn.tier-mid .stake-label   { color: #c9a84c; }
  .stake-btn.tier-high .stake-label  { color: #c97e4c; }

  .custom-form {
    display: flex;
    gap: 0.75rem;
    align-items: flex-end;
    padding: 1rem;
    background: #1d1c19;
    border: 1px solid #2a2a27;
    border-radius: 6px;
  }

  .custom-form label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8rem;
    color: #7a7a7a;
  }

  .custom-form input {
    padding: 0.5rem 0.7rem;
    border: 1px solid #2a2a27;
    border-radius: 4px;
    background: #161512;
    color: #e0e0e0;
    font-size: 0.95rem;
    width: 100px;
  }

  .create-custom {
    padding: 0.55rem 1.1rem;
    border: none;
    border-radius: 4px;
    background: #629924;
    color: #fff;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s;
  }

  .create-custom:hover:not(:disabled) {
    background: #75b52c;
  }

  .create-custom:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  .hint {
    color: #5a5a57;
    margin: 0;
    font-size: 0.82rem;
    text-align: center;
  }

  .error {
    color: #cf6679;
    margin: 0;
    font-size: 0.85rem;
  }

  footer {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    justify-content: center;
    color: #4a4a47;
    font-size: 0.78rem;
    margin-top: auto;
    padding-top: 1rem;
  }

  @media (max-width: 640px) {
    .auth-fields {
      grid-template-columns: 1fr;
    }

    .auth-summary {
      flex-direction: column;
      align-items: flex-start;
    }

    .custom-form {
      flex-direction: column;
      align-items: stretch;
      width: min(100%, 320px);
    }

    .custom-form input {
      width: auto;
    }
  }
</style>
