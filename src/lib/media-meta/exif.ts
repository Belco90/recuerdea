import exifr from 'exifr'

// exifr's package.json has no `exports` field, so Vite SSR / Node ESM resolves
// to the CJS UMD build, where `import { parse } from 'exifr'` fails at runtime
// with "Named export 'parse' not found". Default import + destructure works.
// eslint-disable-next-line import/no-named-as-default-member
const { parse } = exifr

const RANGE_HEADER = 'bytes=0-65535'

type ExifTags = {
	DateTimeOriginal?: unknown
	CreateDate?: unknown
	DateTime?: unknown
	ExifImageWidth?: unknown
	ExifImageHeight?: unknown
	PixelXDimension?: unknown
	PixelYDimension?: unknown
	ImageWidth?: unknown
	ImageHeight?: unknown
	latitude?: unknown
	longitude?: unknown
}

const TAG_NAMES = [
	'DateTimeOriginal',
	'CreateDate',
	'DateTime',
	'ExifImageWidth',
	'ExifImageHeight',
	'PixelXDimension',
	'PixelYDimension',
	'ImageWidth',
	'ImageHeight',
	'latitude',
	'longitude',
] as const

export type GeoLocation = {
	lat: number
	lng: number
}

export type ImageMeta = {
	captureDate: Date | null
	width: number | null
	height: number | null
	location: GeoLocation | null
}

const EMPTY: ImageMeta = { captureDate: null, width: null, height: null, location: null }

export async function extractImageMeta(downloadUrl: string): Promise<ImageMeta> {
	const res = await fetch(downloadUrl, { headers: { Range: RANGE_HEADER } })
	if (!res.ok) return EMPTY
	const buffer = await res.arrayBuffer()

	let tags: ExifTags | undefined
	try {
		tags = (await parse(buffer, [...TAG_NAMES])) as ExifTags | undefined
	} catch {
		return EMPTY
	}

	return {
		captureDate: pickCaptureDate(tags),
		width: pickDimension(tags?.ExifImageWidth, tags?.PixelXDimension, tags?.ImageWidth),
		height: pickDimension(tags?.ExifImageHeight, tags?.PixelYDimension, tags?.ImageHeight),
		location: pickLocation(tags),
	}
}

function pickCaptureDate(tags: ExifTags | undefined): Date | null {
	const candidate = tags?.DateTimeOriginal ?? tags?.CreateDate ?? tags?.DateTime
	if (!(candidate instanceof Date) || Number.isNaN(candidate.getTime())) return null
	return candidate
}

function pickDimension(...candidates: readonly unknown[]): number | null {
	for (const c of candidates) {
		if (typeof c === 'number' && Number.isFinite(c) && c > 0) return Math.round(c)
	}
	return null
}

function pickLocation(tags: ExifTags | undefined): GeoLocation | null {
	const lat = tags?.latitude
	const lng = tags?.longitude
	if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return null
	if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return null
	return { lat, lng }
}
