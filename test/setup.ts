import { afterAll, beforeAll, vi } from 'vitest'

vi.mock('@netlify/identity')

// Browser-mode tests run without Node's `process` global, but server-only
// helpers (e.g. `src/lib/memories/pcloud.server.ts`) read `process.env.*` at runtime.
// Provide a minimal shim so `vi.stubEnv` can populate values per test.
if (typeof globalThis.process === 'undefined') {
	;(globalThis as { process?: { env: Record<string, string | undefined> } }).process = { env: {} }
}

// Pin "today" so date-derived assertions (e.g. `yearsAgo`, "Hoy en…") are
// stable. Limit faking to `Date` — `setTimeout`/microtasks must keep working
// for async expectations (`identity-context` waits on `setTimeout`, browser
// matchers poll real timers).
beforeAll(() => {
	vi.useFakeTimers({ toFake: ['Date'] })
	vi.setSystemTime(new Date('2026-05-03T00:30:00.000Z'))
})

afterAll(() => {
	vi.useRealTimers()
})
