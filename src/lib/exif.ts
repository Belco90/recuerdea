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
}

export async function extractCaptureDate(downloadUrl: string): Promise<Date | null> {
	const res = await fetch(downloadUrl, { headers: { Range: RANGE_HEADER } })
	if (!res.ok) return null
	const buffer = await res.arrayBuffer()

	let tags: ExifTags | undefined
	try {
		tags = (await parse(buffer, ['DateTimeOriginal', 'CreateDate', 'DateTime'])) as
			| ExifTags
			| undefined
	} catch {
		return null
	}

	const candidate = tags?.DateTimeOriginal ?? tags?.CreateDate ?? tags?.DateTime
	if (!(candidate instanceof Date) || Number.isNaN(candidate.getTime())) return null
	return candidate
}
