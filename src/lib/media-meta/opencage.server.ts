// Reverse-geocodes a lat/lng pair to a Spanish-localized place string via the
// OpenCage Geocoding API. Server-only; the API key never leaves the cron's
// invocation. Failures degrade to a tagged reason so the cron orchestrator can
// decide whether to keep going (transient) or stop (auth / quota).
//
// No console output anywhere on this path — Q5 in the v6 plan forbids logging
// any geo-derived data, including OpenCage status messages, so the caller logs
// only counts and reasons. See tasks/plan.md.

const ENDPOINT = 'https://api.opencagedata.com/geocode/v1/json'

export type ReverseGeocodeResult =
	| { ok: true; place: string | null }
	| {
			ok: false
			reason: 'auth' | 'suspended' | 'quota' | 'ratelimit' | 'server' | 'network' | 'parse'
	  }

export type ReverseGeocodeOptions = {
	apiKey: string
	signal?: AbortSignal
}

type Components = {
	city?: string
	town?: string
	village?: string
	municipality?: string
	county?: string
	state?: string
	country?: string
}

type OpenCageBody = {
	status?: { code?: number; message?: string }
	total_results?: number
	results?: Array<{ components?: Components; formatted?: string }>
}

export async function reverseGeocode(
	{ lat, lng }: { lat: number; lng: number },
	{ apiKey, signal }: ReverseGeocodeOptions,
): Promise<ReverseGeocodeResult> {
	const url = buildUrl({ lat, lng, apiKey })

	let res: Response
	try {
		res = await fetch(url, {
			signal,
			headers: { Accept: 'application/json' },
		})
	} catch {
		return { ok: false, reason: 'network' }
	}

	let body: OpenCageBody
	try {
		body = (await res.json()) as OpenCageBody
	} catch {
		return { ok: false, reason: 'parse' }
	}

	const code = body.status?.code ?? res.status
	if (code !== 200) return { ok: false, reason: classify(code) }

	const result = body.results?.[0]
	if (!result || (body.total_results ?? body.results?.length ?? 0) === 0) {
		return { ok: true, place: null }
	}

	return { ok: true, place: pickPlace(result.components, result.formatted) }
}

function buildUrl({ lat, lng, apiKey }: { lat: number; lng: number; apiKey: string }): string {
	const params = new URLSearchParams({
		key: apiKey,
		q: `${lat},${lng}`,
		language: 'es',
		no_annotations: '1',
		limit: '1',
	})
	return `${ENDPOINT}?${params.toString()}`
}

function classify(code: number): 'auth' | 'suspended' | 'quota' | 'ratelimit' | 'server' {
	if (code === 401) return 'auth'
	if (code === 402) return 'quota'
	if (code === 403) return 'suspended'
	if (code === 429) return 'ratelimit'
	return 'server'
}

function pickPlace(
	components: Components | undefined,
	formatted: string | undefined,
): string | null {
	const head =
		components?.city ??
		components?.town ??
		components?.village ??
		components?.municipality ??
		components?.county ??
		components?.state ??
		null

	if (head === null) return formatted ?? null

	const country = components?.country
	if (!country || head.endsWith(country)) return head
	return `${head}, ${country}`
}
