// Reverse-geocodes a lat/lng pair to a Spanish-localized place string via the
// Geoapify Reverse Geocoding API. Server-only; the API key never leaves the
// cron's invocation. Failures degrade to a tagged reason so the cron
// orchestrator can decide whether to keep going (transient) or stop (auth /
// suspended / rate limit).
//
// No console output anywhere on this path — Q5 in the v6 plan forbids logging
// any geo-derived data, including HTTP status messages, so the caller logs
// only counts and reasons. See tasks/plan.md.

const ENDPOINT = 'https://api.geoapify.com/v1/geocode/reverse'

export type ReverseGeocodeResult =
	| { ok: true; place: string | null }
	| {
			ok: false
			reason: 'auth' | 'suspended' | 'ratelimit' | 'server' | 'network' | 'parse'
	  }

export type ReverseGeocodeOptions = {
	apiKey: string
	signal?: AbortSignal
}

type Properties = {
	city?: string
	state?: string
	country?: string
	formatted?: string
}

type GeoapifyBody = {
	features?: Array<{ properties?: Properties }>
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

	if (res.status !== 200) return { ok: false, reason: classify(res.status) }

	let body: GeoapifyBody
	try {
		body = (await res.json()) as GeoapifyBody
	} catch {
		return { ok: false, reason: 'parse' }
	}

	const props = body.features?.[0]?.properties
	if (!props) return { ok: true, place: null }

	return { ok: true, place: pickPlace(props) }
}

function buildUrl({ lat, lng, apiKey }: { lat: number; lng: number; apiKey: string }): string {
	const params = new URLSearchParams({
		lat: String(lat),
		lon: String(lng),
		lang: 'es',
		apiKey,
	})
	return `${ENDPOINT}?${params.toString()}`
}

function classify(code: number): 'auth' | 'suspended' | 'ratelimit' | 'server' {
	if (code === 401) return 'auth'
	if (code === 403) return 'suspended'
	if (code === 429) return 'ratelimit'
	return 'server'
}

function pickPlace(props: Properties): string | null {
	const head = props.city ?? props.state ?? null
	if (head === null) return props.formatted ?? null

	const country = props.country
	if (!country || head.endsWith(country)) return head
	return `${head}, ${country}`
}
