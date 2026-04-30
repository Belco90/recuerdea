import { vi } from 'vitest'

vi.mock('@netlify/identity')

// Browser-mode tests run without Node's `process` global, but server-only
// helpers (e.g. `src/lib/memories/pcloud.server.ts`) read `process.env.*` at runtime.
// Provide a minimal shim so `vi.stubEnv` can populate values per test.
if (typeof globalThis.process === 'undefined') {
	;(globalThis as { process?: { env: Record<string, string | undefined> } }).process = { env: {} }
}
