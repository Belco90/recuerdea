import { defineConfig } from 'oxlint'

export default defineConfig({
	plugins: ['import', 'typescript', 'unicorn', 'react', 'vitest'],
	categories: {
		correctness: 'error',
		suspicious: 'error',
		perf: 'error',
	},
	rules: {
		'no-console': 'warn',
		'react-in-jsx-scope': 'off',
	},
	env: {
		browser: true,
		es2022: true,
	},
	options: {
		denyWarnings: true,
		reportUnusedDisableDirectives: 'warn',
	},
	ignorePatterns: ['dist', 'coverage', 'node_modules'],
})
