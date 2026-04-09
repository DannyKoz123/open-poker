<script lang="ts">
  import { page } from '$app/state';

  const handId = $derived(page.params.id);
</script>

<svelte:head>
  <title>Open Poker - Hand {handId}</title>
</svelte:head>

<div class="hand-shell">
  <p class="eyebrow">Hand Replay</p>
  <h1>Hand {handId}</h1>
  <p>
    This route is reserved for the permanent public hand replay and analysis view described in
    the design docs.
  </p>
  <p>
    It is intentionally scaffolded before persistence so the repo has a stable feature boundary
    for replay UI, PHH export, and exact post-hand equity work.
  </p>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #101724;
    color: #eef2f7;
  }

  .hand-shell {
    max-width: 720px;
    margin: 0 auto;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 2rem 1.25rem;
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
    font-size: clamp(2rem, 4vw, 3.4rem);
  }

  p {
    margin: 0 0 1rem;
    line-height: 1.6;
    color: #b9c4d4;
    max-width: 56ch;
  }
</style>
