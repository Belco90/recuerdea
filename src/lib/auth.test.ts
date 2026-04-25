import { getUser } from '@netlify/identity'
import { getCookie } from '@tanstack/react-start/server'
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
		})
		expect(jsonParseSpy).not.toHaveBeenCalled()
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
		})
		expect(jsonParseSpy).toHaveBeenCalled()
	})

	it('returns claims with no email when the jwt has no email', async () => {
		vi.stubEnv('DEV', true)
		mockedGetUser.mockResolvedValue(null as never)
		mockedGetCookie.mockReturnValue(makeJwt({ sub: 'no-email' }))
		await expect(getServerUser()).resolves.toEqual({ id: 'no-email', email: undefined })
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
		await expect(getServerUser()).resolves.toEqual({ id: '>>>???', email: 'a' })
	})
})
