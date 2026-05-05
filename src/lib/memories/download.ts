export type DownloadOpts = {
	url: string
	name: string
	fetcher?: typeof fetch
	clicker?: (a: HTMLAnchorElement) => void
}

const defaultClicker = (a: HTMLAnchorElement) => {
	a.click()
}

export async function downloadAs({
	url,
	name,
	fetcher = fetch,
	clicker = defaultClicker,
}: DownloadOpts): Promise<void> {
	// Strip Referer so pCloud's CDN URLs (which may gate by referrer) don't
	// 410 on browser-origin requests. Same rationale as the <video> element.
	const res = await fetcher(url, { referrerPolicy: 'no-referrer' })
	if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
	const blob = await res.blob()
	const objectUrl = URL.createObjectURL(blob)
	try {
		const a = document.createElement('a')
		a.href = objectUrl
		a.download = name
		a.style.display = 'none'
		document.body.appendChild(a)
		try {
			clicker(a)
		} finally {
			document.body.removeChild(a)
		}
	} finally {
		URL.revokeObjectURL(objectUrl)
	}
}
