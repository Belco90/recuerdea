import { ProgressBar } from '#/components/ProgressBar'
import { useRouterState } from '@tanstack/react-router'

/**
 * Drives the global {@link ProgressBar} from the router's navigation status.
 * `status === 'pending'` covers every in-flight navigation — including
 * same-route loader reloads (e.g. switching folders in the admin add page),
 * where the active component stays mounted so its local state is preserved.
 */
export function NavigationProgress() {
	const pending = useRouterState({ select: (s) => s.status === 'pending' })
	return <ProgressBar active={pending} />
}
