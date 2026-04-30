import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reverseGeocode } from './opencage.server'

const KEY = 'test-key-30-chars-aaaaaaaaaaaa'
const LAT = 40.4168
const LNG = -3.7038

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	})
}

function okBody(
	overrides: {
		results?: Array<{
			components?: Record<string, string>
			formatted?: string
		}>
		total_results?: number
		status?: { code: number; message: string }
	} = {},
): unknown {
	const results = overrides.results ?? []
	return {
		status: overrides.status ?? { code: 200, message: 'OK' },
		total_results: overrides.total_results ?? results.length,
		results,
	}
}

describe('reverseGeocode', () => {
	let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>
	let consoleSpies: ReturnType<typeof vi.spyOn>[]

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch')
		consoleSpies = [
			vi.spyOn(console, 'log').mockImplementation(() => {}),
			vi.spyOn(console, 'info').mockImplementation(() => {}),
			vi.spyOn(console, 'warn').mockImplementation(() => {}),
			vi.spyOn(console, 'error').mockImplementation(() => {}),
		]
	})

	afterEach(() => {
		fetchSpy.mockRestore()
		consoleSpies.forEach((s) => s.mockRestore())
	})

	function assertNoSensitiveLogs(): void {
		const sensitive = [
			String(LAT),
			String(LNG),
			'Madrid',
			'España',
			'+40',
			'-3.7',
			'Some forbidden message',
		]
		for (const spy of consoleSpies) {
			for (const call of spy.mock.calls) {
				const flat = call
					.map((a: unknown) => (typeof a === 'string' ? a : JSON.stringify(a)))
					.join(' ')
				for (const needle of sensitive) {
					expect(flat).not.toContain(needle)
				}
			}
		}
	}

	describe('request shape', () => {
		it('builds the URL with the key, encoded comma-separated reverse query, and the standard params', async () => {
			fetchSpy.mockResolvedValue(jsonResponse(okBody()))

			await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			const [url] = fetchSpy.mock.calls[0]!
			expect(typeof url).toBe('string')
			const u = new URL(url as string)
			expect(u.origin + u.pathname).toBe('https://api.opencagedata.com/geocode/v1/json')
			expect(u.searchParams.get('key')).toBe(KEY)
			expect(u.searchParams.get('q')).toBe(`${LAT},${LNG}`)
			expect(u.searchParams.get('language')).toBe('es')
			expect(u.searchParams.get('no_annotations')).toBe('1')
			expect(u.searchParams.get('limit')).toBe('1')
		})

		it('URL-encodes the comma in the q parameter (raw URL contains %2C)', async () => {
			fetchSpy.mockResolvedValue(jsonResponse(okBody()))

			await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			const [url] = fetchSpy.mock.calls[0]!
			expect(url as string).toContain('%2C')
		})

		it('sends Accept: application/json', async () => {
			fetchSpy.mockResolvedValue(jsonResponse(okBody()))

			await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			const init = fetchSpy.mock.calls[0]![1] as RequestInit
			const headers = new Headers(init.headers)
			expect(headers.get('accept')).toBe('application/json')
		})

		it('forwards an AbortSignal when provided', async () => {
			fetchSpy.mockResolvedValue(jsonResponse(okBody()))
			const controller = new AbortController()

			await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY, signal: controller.signal })

			const init = fetchSpy.mock.calls[0]![1] as RequestInit
			expect(init.signal).toBe(controller.signal)
		})
	})

	describe('success path — component preference', () => {
		it('returns "City, Country" when both are present', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(okBody({ results: [{ components: { city: 'Madrid', country: 'España' } }] })),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: true, place: 'Madrid, España' })
			assertNoSensitiveLogs()
		})

		it('prefers town when no city', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(okBody({ results: [{ components: { town: 'Cuenca', country: 'España' } }] })),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: true, place: 'Cuenca, España' })
		})

		it('prefers village over no narrower component', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(okBody({ results: [{ components: { village: 'Albarracín' } }] })),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: true, place: 'Albarracín' })
		})

		it('prefers municipality when narrower components are absent', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(
					okBody({
						results: [{ components: { municipality: 'Madrid', country: 'España' } }],
					}),
				),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: true, place: 'Madrid, España' })
		})

		it('prefers state when only state and country are present', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(
					okBody({
						results: [{ components: { state: 'Aragón', country: 'España' } }],
					}),
				),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: true, place: 'Aragón, España' })
		})

		it('falls back to formatted when no useful component is present', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(
					okBody({ results: [{ components: { country_code: 'es' }, formatted: 'Algún sitio' }] }),
				),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: true, place: 'Algún sitio' })
		})

		it('does not duplicate the country when the head already ends with it', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(okBody({ results: [{ components: { city: 'España', country: 'España' } }] })),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: true, place: 'España' })
		})

		it('returns place: null when total_results is 0', async () => {
			fetchSpy.mockResolvedValue(jsonResponse(okBody({ results: [], total_results: 0 })))

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: true, place: null })
		})

		it('returns place: null when results array is empty (regardless of total_results)', async () => {
			fetchSpy.mockResolvedValue(jsonResponse(okBody({ results: [], total_results: 0 })))

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result.ok).toBe(true)
			expect(result.ok && result.place).toBeNull()
		})

		it('returns place: null when no useful component AND no formatted', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(okBody({ results: [{ components: { country_code: 'es' } }] })),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: true, place: null })
		})
	})

	describe('failure paths — body-authoritative status', () => {
		it('treats body status.code 402 as quota even when HTTP is 200', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(
					okBody({
						status: { code: 402, message: 'Some forbidden message' },
						results: [],
					}),
				),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: false, reason: 'quota' })
			assertNoSensitiveLogs()
		})

		it('HTTP 401 → auth', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse({ status: { code: 401, message: 'Some forbidden message' } }, 401),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: false, reason: 'auth' })
			assertNoSensitiveLogs()
		})

		it('HTTP 402 → quota', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse({ status: { code: 402, message: 'Some forbidden message' } }, 402),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: false, reason: 'quota' })
		})

		it('HTTP 403 → suspended', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse({ status: { code: 403, message: 'Some forbidden message' } }, 403),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: false, reason: 'suspended' })
		})

		it('HTTP 429 → ratelimit', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse({ status: { code: 429, message: 'Some forbidden message' } }, 429),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: false, reason: 'ratelimit' })
		})

		it('HTTP 503 → server', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse({ status: { code: 503, message: 'Some forbidden message' } }, 503),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: false, reason: 'server' })
		})

		it('fetch rejection → network', async () => {
			fetchSpy.mockRejectedValue(new Error('network down'))

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: false, reason: 'network' })
			assertNoSensitiveLogs()
		})

		it('non-JSON response body → parse', async () => {
			fetchSpy.mockResolvedValue(
				new Response('not json at all', { status: 200, headers: { 'content-type': 'text/html' } }),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: false, reason: 'parse' })
		})

		it('unexpected HTTP code (418) → server', async () => {
			fetchSpy.mockResolvedValue(jsonResponse({ status: { code: 418, message: 'teapot' } }, 418))

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: false, reason: 'server' })
		})
	})

	describe('logging hygiene', () => {
		it('never logs anything on a successful call', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(okBody({ results: [{ components: { city: 'Madrid', country: 'España' } }] })),
			)

			await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
		})

		it('never logs anything on any failure path', async () => {
			fetchSpy.mockRejectedValueOnce(new Error('network down'))
			await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			fetchSpy.mockResolvedValueOnce(jsonResponse({ status: { code: 401, message: 'x' } }, 401))
			await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			fetchSpy.mockResolvedValueOnce(
				new Response('not json', { status: 200, headers: { 'content-type': 'text/html' } }),
			)
			await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
		})
	})
})
