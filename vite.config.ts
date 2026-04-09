import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { webSocketServer } from './src/lib/server/gateway/dev-websocket-plugin';

export default defineConfig({
	plugins: [sveltekit(), webSocketServer()]
});
