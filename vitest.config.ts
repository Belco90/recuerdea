import viteReact from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// `@tanstack/react-start*` ships internal package-imports specifiers
// (`#tanstack-start-entry`, …) that only resolve under the SSR plugin and
// crash Vite's bundler in browser mode. `vi.mock` runs too late to bypass
// that, so these have to be redirected at the resolver level.
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
		clearMocks: true,
		mockReset: true,
		setupFiles: ['./test/setup.ts'],
		browser: {
			enabled: true,
			provider: playwright(),
			headless: true,
			instances: [{ browser: 'chromium' }],
		},
	},
})
