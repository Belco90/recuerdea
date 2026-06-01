/**
 * Decision #1 gate (tasks/plan.md): a `pendingComponent` must NOT replace an
 * already-active route — and therefore must not remount its component — when a
 * same-route loader reload happens (changed `loaderDeps`). This is the
 * behavior the admin add-page skeleton relies on so that `picked` selections
 * survive folder switches. If TanStack ever changed to a teardown-on-reload
 * model, this test fails and the add skeleton must move to the inline-overlay
 * fallback.
 */
import {
	Outlet,
	RouterProvider,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
} from '@tanstack/react-router'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { render } from '../../test/test-utils'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function buildRouter() {
	const rootRoute = createRootRoute({ component: () => <Outlet /> })

	const probeRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: '/',
		validateSearch: (s: Record<string, unknown>) => ({ n: Number(s.n ?? 0) }),
		loaderDeps: ({ search }) => ({ n: search.n }),
		// Slow enough to be "pending" past the small pendingMs below.
		loader: async ({ deps }) => {
			await sleep(40)
			return deps.n
		},
		pendingComponent: () => <div data-testid="pending">cargando</div>,
		component: Probe,
	})

	const routeTree = rootRoute.addChildren([probeRoute])
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: ['/?n=0'] }),
		defaultPendingMs: 5,
		defaultPendingMinMs: 0,
	})
	return { router, probeRoute }
}

let mountCount = 0

function Probe() {
	// Each mount creates a fresh instance id; a remount would bump mountCount
	// past 1 and change data-instance. Surviving a reload keeps both stable.
	const instance = useRef(++mountCount)
	return (
		<div data-testid="probe" data-instance={instance.current}>
			loaded
		</div>
	)
}

describe('pendingComponent on same-route reload', () => {
	it('keeps the active component mounted (no remount) on a loaderDeps change', async () => {
		mountCount = 0
		const { router } = buildRouter()
		await render(<RouterProvider router={router} />)

		// Initial entry resolved.
		await expect.element(page.getByTestId('probe')).toBeVisible()
		const firstInstance = page.getByTestId('probe').element().getAttribute('data-instance')

		// Same-route navigation that re-runs the loader (changed dep). Cast
		// because the global router-type registration types `to: '/'` against
		// the real app route, not this throwaway test router.
		await router.navigate({ to: '/', search: { n: 1 } } as never)

		// The component stays mounted with stale content during the reload and
		// resolves in place — it is never swapped for the pendingComponent.
		await expect.element(page.getByTestId('probe')).toBeVisible()
		const secondInstance = page.getByTestId('probe').element().getAttribute('data-instance')

		expect(secondInstance).toBe(firstInstance)
		// Mounted exactly once across the whole reload.
		expect(mountCount).toBe(1)
	})
})
