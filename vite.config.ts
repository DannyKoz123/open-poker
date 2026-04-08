import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { webSocketServer } from './src/lib/server/vite-ws-plugin';

export default defineConfig({
	plugins: [sveltekit(), webSocketServer()]
});
