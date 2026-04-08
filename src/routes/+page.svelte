<script lang="ts">
  import { goto } from '$app/navigation';

  let playerName = $state('');

  function createRoom() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let id = '';
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      id += chars[byte % chars.length];
    }
    const name = playerName.trim() || 'Anonymous';
    goto(`/game/${id}?name=${encodeURIComponent(name)}`);
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
      onkeydown={(e) => e.key === 'Enter' && createRoom()}
    />
    <button onclick={createRoom}>Create Table</button>
  </div>

  <p class="hint">Share the link with friends to play together.</p>

  <footer>
    <a href="https://github.com/open-poker/open-poker" target="_blank">GitHub</a>
    <span>AGPL-3.0</span>
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

  .hint {
    color: #666;
    margin-top: 1rem;
    font-size: 0.85rem;
  }

  footer {
    position: fixed;
    bottom: 1rem;
    display: flex;
    gap: 1rem;
    color: #555;
    font-size: 0.8rem;
  }

  footer a {
    color: #888;
    text-decoration: none;
  }
</style>
