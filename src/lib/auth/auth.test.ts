import type { MockInstance } from 'vitest'

import { getUser } from '@netlify/identity'
import { getCookie } from '@tanstack/react-start/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getServerUser } from './auth'

const mockedGetUser = vi.mocked(getUser)
const mockedGetCookie = vi.mocked(getCookie)

function makeJwt(claims: Record<string, unknown>): string {
	const json = JSON.stringify(claims)
	const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
	return `header.${b64}.signature`
}

describe('getServerUser', () => {
	let jsonParseSpy: MockInstance<typeof JSON.parse>

	beforeEach(() => {
		jsonParseSpy = vi.spyOn(JSON, 'parse')
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		jsonParseSpy.mockRestore()
	})

	it('returns the netlify user when getUser resolves with one', async () => {
		mockedGetUser.mockResolvedValue({ id: 'nf-1', email: 'me@test.com' } as never)
		await expect(getServerUser()).resolves.toEqual({
			id: 'nf-1',
			email: 'me@test.com',
			isAdmin: false,
		})
		expect(jsonParseSpy).not.toHaveBeenCalled()
	})

	it('marks the user as admin when getUser returns role: "admin"', async () => {
		mockedGetUser.mockResolvedValue({ id: 'nf-2', email: 'a@test.com', role: 'admin' } as never)
		await expect(getServerUser()).resolves.toEqual({
			id: 'nf-2',
			email: 'a@test.com',
			isAdmin: true,
		})
	})

	it('marks the user as admin when getUser returns roles array containing "admin"', async () => {
		mockedGetUser.mockResolvedValue({
			id: 'nf-3',
			email: 'b@test.com',
			roles: ['editor', 'admin'],
		} as never)
		await expect(getServerUser()).resolves.toMatchObject({ id: 'nf-3', isAdmin: true })
	})

	it('marks the user as non-admin when role/roles do not include "admin"', async () => {
		mockedGetUser.mockResolvedValue({
			id: 'nf-4',
			email: 'c@test.com',
			role: 'editor',
			roles: ['viewer'],
		} as never)
		await expect(getServerUser()).resolves.toMatchObject({ id: 'nf-4', isAdmin: false })
	})

	it('skips the dev fallback (no cookie read, no JWT parse) when not in dev', async () => {
		vi.stubEnv('DEV', false)
		mockedGetUser.mockResolvedValue(null as never)
		await expect(getServerUser()).resolves.toBeNull()
		expect(mockedGetCookie).not.toHaveBeenCalled()
		expect(jsonParseSpy).not.toHaveBeenCalled()
	})

	it('returns null in dev when no nf_jwt cookie is present', async () => {
		vi.stubEnv('DEV', true)
		mockedGetUser.mockResolvedValue(null as never)
		await expect(getServerUser()).resolves.toBeNull()
		expect(mockedGetCookie).toHaveBeenCalledWith('nf_jwt')
		expect(jsonParseSpy).not.toHaveBeenCalled()
	})

	it('decodes the dev nf_jwt cookie when present and valid', async () => {
		vi.stubEnv('DEV', true)
		mockedGetUser.mockResolvedValue(null as never)
		const exp = Math.floor(Date.now() / 1000) + 3600
		mockedGetCookie.mockReturnValue(makeJwt({ sub: 'jwt-user', email: 'jwt@test.com', exp }))
		await expect(getServerUser()).resolves.toEqual({
			id: 'jwt-user',
			email: 'jwt@test.com',
			isAdmin: false,
		})
		expect(jsonParseSpy).toHaveBeenCalled()
	})

	it('marks the dev jwt user as admin when app_metadata.roles includes "admin"', async () => {
		vi.stubEnv('DEV', true)
		mockedGetUser.mockResolvedValue(null as never)
		mockedGetCookie.mockReturnValue(
			makeJwt({
				sub: 'jwt-admin',
				email: 'admin@test.com',
				app_metadata: { roles: ['admin'] },
			}),
		)
		await expect(getServerUser()).resolves.toEqual({
			id: 'jwt-admin',
			email: 'admin@test.com',
			isAdmin: true,
		})
	})

	it('returns claims with no email when the jwt has no email', async () => {
		vi.stubEnv('DEV', true)
		mockedGetUser.mockResolvedValue(null as never)
		mockedGetCookie.mockReturnValue(makeJwt({ sub: 'no-email' }))
		await expect(getServerUser()).resolves.toEqual({
			id: 'no-email',
			email: undefined,
			isAdmin: false,
		})
	})

	it('returns null in dev when nf_jwt is expired', async () => {
		vi.stubEnv('DEV', true)
		mockedGetUser.mockResolvedValue(null as never)
		const exp = Math.floor(Date.now() / 1000) - 60
		mockedGetCookie.mockReturnValue(makeJwt({ sub: 'expired', exp }))
		await expect(getServerUser()).resolves.toBeNull()
		expect(jsonParseSpy).toHaveBeenCalled()
	})

	it('returns null in dev when nf_jwt has no payload segment', async () => {
		vi.stubEnv('DEV', true)
		mockedGetUser.mockResolvedValue(null as never)
		mockedGetCookie.mockReturnValue('only-one-segment')
		await expect(getServerUser()).resolves.toBeNull()
		// Bails out before attempting to parse JSON.
		expect(jsonParseSpy).not.toHaveBeenCalled()
	})

	it('returns null in dev when nf_jwt is not valid base64', async () => {
		vi.stubEnv('DEV', true)
		mockedGetUser.mockResolvedValue(null as never)
		mockedGetCookie.mockReturnValue('header.!!!not-base64!!!.sig')
		await expect(getServerUser()).resolves.toBeNull()
	})

	it('returns null in dev when the decoded payload is not valid JSON', async () => {
		vi.stubEnv('DEV', true)
		mockedGetUser.mockResolvedValue(null as never)
		const b64 = btoa('not json at all').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
		mockedGetCookie.mockReturnValue(`header.${b64}.sig`)
		await expect(getServerUser()).resolves.toBeNull()
		expect(jsonParseSpy).toHaveBeenCalled()
	})

	it('decodes URL-safe base64 with - and _ chars and missing padding', async () => {
		vi.stubEnv('DEV', true)
		mockedGetUser.mockResolvedValue(null as never)
		const cookie = makeJwt({ sub: '>>>???', email: 'a' })
		expect(cookie).toMatch(/[-_]/)
		expect(cookie).not.toMatch(/=/)
		mockedGetCookie.mockReturnValue(cookie)
		await expect(getServerUser()).resolves.toEqual({ id: '>>>???', email: 'a', isAdmin: false })
	})
})
