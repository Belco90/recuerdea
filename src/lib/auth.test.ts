import { getUser } from '@netlify/identity'
import { getCookie } from '@tanstack/react-start/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { decodeJwt, getServerUser } from './auth'

vi.mock('@netlify/identity', () => ({
	getUser: vi.fn<() => unknown>(),
}))

vi.mock('@tanstack/react-start/server', () => ({
	getCookie: vi.fn<() => unknown>(),
}))

vi.mock('@tanstack/react-start', () => ({
	createServerFn: () => ({
		handler: <T>(fn: T) => fn,
	}),
}))

const mockedGetUser = vi.mocked(getUser)
const mockedGetCookie = vi.mocked(getCookie)

function makeJwt(claims: Record<string, unknown>): string {
	const json = JSON.stringify(claims)
	const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
	return `header.${b64}.signature`
}

describe('decodeJwt', () => {
	it('returns claims for a valid token with future exp', () => {
		const exp = Math.floor(Date.now() / 1000) + 3600
		const token = makeJwt({ sub: 'user-1', email: 'a@b.com', exp })
		expect(decodeJwt(token)).toEqual({ sub: 'user-1', email: 'a@b.com', exp })
	})

	it('returns claims when no exp is present', () => {
		const token = makeJwt({ sub: 'user-2' })
		expect(decodeJwt(token)).toEqual({ sub: 'user-2' })
	})

	it('returns null for an expired token', () => {
		const exp = Math.floor(Date.now() / 1000) - 60
		const token = makeJwt({ sub: 'user-3', exp })
		expect(decodeJwt(token)).toBeNull()
	})

	it('returns null when the payload segment is missing', () => {
		expect(decodeJwt('only-one-segment')).toBeNull()
	})

	it('returns null for non-base64 payload', () => {
		expect(decodeJwt('header.!!!not-base64!!!.sig')).toBeNull()
	})

	it('returns null when the decoded payload is not valid JSON', () => {
		const b64 = btoa('not json at all').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
		expect(decodeJwt(`header.${b64}.sig`)).toBeNull()
	})

	it('decodes URL-safe base64 with - and _ chars and missing padding', () => {
		const claims = { sub: '>>>???', email: 'a' }
		const token = makeJwt(claims)
		expect(token).toMatch(/[-_]/)
		expect(token).not.toMatch(/=/)
		expect(decodeJwt(token)).toEqual(claims)
	})
})

describe('getServerUser', () => {
	beforeEach(() => {
		mockedGetUser.mockReset()
		mockedGetCookie.mockReset()
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('returns the netlify user when getUser resolves with one', async () => {
		mockedGetUser.mockResolvedValue({ id: 'nf-1', email: 'me@nf.com' } as never)
		await expect(getServerUser()).resolves.toEqual({
			id: 'nf-1',
			email: 'me@nf.com',
		})
	})

	it('returns null when getUser is null and not in dev', async () => {
		vi.stubEnv('DEV', false)
		mockedGetUser.mockResolvedValue(null as never)
		await expect(getServerUser()).resolves.toBeNull()
		expect(mockedGetCookie).not.toHaveBeenCalled()
	})

	it('returns null in dev when no nf_jwt cookie is present', async () => {
		vi.stubEnv('DEV', true)
		mockedGetUser.mockResolvedValue(null as never)
		mockedGetCookie.mockReturnValue(undefined)
		await expect(getServerUser()).resolves.toBeNull()
		expect(mockedGetCookie).toHaveBeenCalledWith('nf_jwt')
	})

	it('decodes the dev nf_jwt cookie when present and valid', async () => {
		vi.stubEnv('DEV', true)
		mockedGetUser.mockResolvedValue(null as never)
		const exp = Math.floor(Date.now() / 1000) + 3600
		mockedGetCookie.mockReturnValue(makeJwt({ sub: 'jwt-user', email: 'jwt@x.com', exp }))
		await expect(getServerUser()).resolves.toEqual({
			id: 'jwt-user',
			email: 'jwt@x.com',
		})
	})

	it('returns null in dev when nf_jwt is malformed', async () => {
		vi.stubEnv('DEV', true)
		mockedGetUser.mockResolvedValue(null as never)
		mockedGetCookie.mockReturnValue('garbage')
		await expect(getServerUser()).resolves.toBeNull()
	})
})
