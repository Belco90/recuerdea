import { ProgressBar } from '#/components/ProgressBar'
import { ClientOnly, useRouterState } from '@tanstack/react-router'

/**
 * Drives the global {@link ProgressBar} from the router's navigation status.
 * `status === 'pending'` covers every in-flight navigation — including
 * same-route loader reloads (e.g. switching folders in the admin add page),
 * where the active component stays mounted so its local state is preserved.
 */
function Bar() {
	const pending = useRouterState({ select: (s) => s.status === 'pending' })
	return <ProgressBar active={pending} />
}

/**
 * Client-only: the bar must never render during SSR. The server renders with
 * router `status === 'pending'` (loaders in flight) while the hydrated client
 * settles to `'idle'`; rendering the bar on the server would mismatch and leave
 * it painted permanently. After hydration it reflects live navigation status.
 */
export function NavigationProgress() {
	return (
		<ClientOnly>
			<Bar />
		</ClientOnly>
	)
}
