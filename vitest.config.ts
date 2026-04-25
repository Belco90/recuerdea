import viteReact from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const stub = (path: string) => fileURLToPath(new URL(`./test/stubs/${path}`, import.meta.url))

export default defineConfig({
	plugins: [viteReact()],
	resolve: {
		alias: {
			'@tanstack/react-start/server': stub('tanstack-react-start-server.ts'),
			'@tanstack/react-start': stub('tanstack-react-start.ts'),
		},
	},
	test: {
		browser: {
			enabled: true,
			provider: playwright(),
			headless: true,
			instances: [{ browser: 'chromium' }],
		},
	},
})
