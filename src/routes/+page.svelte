<script lang="ts">
  import { goto } from '$app/navigation';

  let playerName = $state('');
  let creatingRoom = $state(false);
  let createError = $state('');

  async function createRoom() {
    if (creatingRoom) return;

    creatingRoom = true;
    createError = '';

    try {
      const response = await fetch('/api/rooms', { method: 'POST' });
      if (!response.ok) {
        throw new Error(`Failed to create room (${response.status})`);
      }

      const data = await response.json() as { roomId: string };
      const name = playerName.trim() || 'Anonymous';

      goto(`/game/${data.roomId}?name=${encodeURIComponent(name)}`);
    } catch (error) {
      createError = 'Could not create a room. Try again.';
      console.error(error);
    } finally {
      creatingRoom = false;
    }
  }
</script>

<svelte:head>
  <title>Open Poker</title>
</svelte:head>

<div class="landing">
  <h1>Open Poker</h1>
  <p class="subtitle">Free, open-source poker with friends. No account needed.</p>

  <div class="create-form">
    <input
      type="text"
      bind:value={playerName}
      placeholder="Your name"
      maxlength="20"
      onkeydown={(e) => e.key === 'Enter' && void createRoom()}
    />
    <button onclick={() => void createRoom()} disabled={creatingRoom}>
      {creatingRoom ? 'Creating...' : 'Create Table'}
    </button>
  </div>

  <p class="hint">No signup. Public hand replay is planned. The engine is already live.</p>
  {#if createError}
    <p class="error">{createError}</p>
  {/if}

  <footer>
    <span>AGPL-3.0</span>
    <span>Free forever, no money play</span>
  </footer>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #1a1a2e;
    color: #e0e0e0;
  }

  .landing {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  h1 {
    font-size: 3rem;
    margin: 0;
    color: #fff;
  }

  .subtitle {
    color: #aaa;
    margin: 0.5rem 0 2rem;
    font-size: 1.1rem;
  }

  .create-form {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  input {
    padding: 0.75rem 1rem;
    border: 1px solid #333;
    border-radius: 8px;
    background: #16213e;
    color: #fff;
    font-size: 1rem;
    width: 200px;
  }

  input::placeholder {
    color: #666;
  }

  button {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 8px;
    background: #e94560;
    color: #fff;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  button:hover {
    background: #c73e54;
  }

  button:disabled {
    opacity: 0.7;
    cursor: wait;
  }

  .hint {
    color: #666;
    margin-top: 1rem;
    font-size: 0.85rem;
  }

  .error {
    color: #ff9aa8;
    margin-top: 0.5rem;
    font-size: 0.85rem;
  }

  footer {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    justify-content: center;
    color: #555;
    font-size: 0.8rem;
    margin-top: 2rem;
  }
</style>
