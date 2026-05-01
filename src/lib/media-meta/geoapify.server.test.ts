import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reverseGeocode } from './geoapify.server'

const KEY = 'test-key-30-chars-aaaaaaaaaaaa'
const LAT = 40.4168
const LNG = -3.7038

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	})
}

function featuresBody(features: Array<{ properties?: Record<string, string> }> = []): unknown {
	return {
		type: 'FeatureCollection',
		features: features.map((f) => ({ type: 'Feature', properties: f.properties ?? {} })),
	}
}

describe('reverseGeocode (Geoapify)', () => {
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
		it('builds the URL with separate lat/lon, lang=es, and the apiKey query param', async () => {
			fetchSpy.mockResolvedValue(jsonResponse(featuresBody()))

			await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			const [url] = fetchSpy.mock.calls[0]!
			expect(typeof url).toBe('string')
			const u = new URL(url as string)
			expect(u.origin + u.pathname).toBe('https://api.geoapify.com/v1/geocode/reverse')
			expect(u.searchParams.get('lat')).toBe(String(LAT))
			expect(u.searchParams.get('lon')).toBe(String(LNG))
			expect(u.searchParams.get('type')).toBe('city')
			expect(u.searchParams.get('lang')).toBe('es')
			expect(u.searchParams.get('apiKey')).toBe(KEY)
		})

		it('sends Accept: application/json', async () => {
			fetchSpy.mockResolvedValue(jsonResponse(featuresBody()))

			await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			const init = fetchSpy.mock.calls[0]![1] as RequestInit
			const headers = new Headers(init.headers)
			expect(headers.get('accept')).toBe('application/json')
		})

		it('forwards an AbortSignal when provided', async () => {
			fetchSpy.mockResolvedValue(jsonResponse(featuresBody()))
			const controller = new AbortController()

			await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY, signal: controller.signal })

			const init = fetchSpy.mock.calls[0]![1] as RequestInit
			expect(init.signal).toBe(controller.signal)
		})
	})

	describe('success path — property preference', () => {
		it('returns "City, Country" when both are present', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(featuresBody([{ properties: { city: 'Madrid', country: 'España' } }])),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: true, place: 'Madrid, España' })
			assertNoSensitiveLogs()
		})

		it('prefers state when no city', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(
					featuresBody([{ properties: { state: 'Comunidad de Madrid', country: 'España' } }]),
				),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: true, place: 'Comunidad de Madrid, España' })
		})

		it('returns city alone when no country is present', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(featuresBody([{ properties: { city: 'Albarracín' } }])),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: true, place: 'Albarracín' })
		})

		it('falls back to formatted when no city/state', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(
					featuresBody([
						{ properties: { country_code: 'es', formatted: 'Algún sitio en mitad del mar' } },
					]),
				),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: true, place: 'Algún sitio en mitad del mar' })
		})

		it('does not duplicate the country when the head already ends with it', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(featuresBody([{ properties: { city: 'España', country: 'España' } }])),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: true, place: 'España' })
		})

		it('returns place: null when features is empty', async () => {
			fetchSpy.mockResolvedValue(jsonResponse(featuresBody([])))

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: true, place: null })
		})

		it('returns place: null when no useful property AND no formatted', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(featuresBody([{ properties: { country_code: 'es' } }])),
			)

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: true, place: null })
		})
	})

	describe('failure paths — HTTP-status authoritative', () => {
		it('HTTP 401 → auth', async () => {
			fetchSpy.mockResolvedValue(jsonResponse({ message: 'Some forbidden message' }, 401))

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: false, reason: 'auth' })
			assertNoSensitiveLogs()
		})

		it('HTTP 403 → suspended', async () => {
			fetchSpy.mockResolvedValue(jsonResponse({ message: 'Some forbidden message' }, 403))

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: false, reason: 'suspended' })
		})

		it('HTTP 429 → ratelimit (covers both rate limit and daily quota)', async () => {
			fetchSpy.mockResolvedValue(jsonResponse({ message: 'Some forbidden message' }, 429))

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: false, reason: 'ratelimit' })
		})

		it('HTTP 503 → server', async () => {
			fetchSpy.mockResolvedValue(jsonResponse({ message: 'Some forbidden message' }, 503))

			const result = await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			expect(result).toEqual({ ok: false, reason: 'server' })
		})

		it('unexpected HTTP code (418) → server', async () => {
			fetchSpy.mockResolvedValue(jsonResponse({ message: 'teapot' }, 418))

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
	})

	describe('logging hygiene', () => {
		it('never logs anything on a successful call', async () => {
			fetchSpy.mockResolvedValue(
				jsonResponse(featuresBody([{ properties: { city: 'Madrid', country: 'España' } }])),
			)

			await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
		})

		it('never logs anything on any failure path', async () => {
			fetchSpy.mockRejectedValueOnce(new Error('network down'))
			await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			fetchSpy.mockResolvedValueOnce(jsonResponse({ message: 'x' }, 401))
			await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			fetchSpy.mockResolvedValueOnce(
				new Response('not json', { status: 200, headers: { 'content-type': 'text/html' } }),
			)
			await reverseGeocode({ lat: LAT, lng: LNG }, { apiKey: KEY })

			for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
		})
	})
})
