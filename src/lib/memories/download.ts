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
	const res = await fetcher(url)
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
