import type { ReactNode } from 'react'

import { IdentityProvider } from '#/lib/identity-context'
import { system } from '#/theme'
import { ChakraProvider } from '@chakra-ui/react'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'

import fontsCss from '../fonts.css?url'

const FONT_PRELOADS = [
	'/fonts/fraunces-latin.woff2',
	'/fonts/fraunces-italic-latin.woff2',
	'/fonts/inter-latin.woff2',
] as const

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
			{ title: 'Recuerdea' },
		],
		links: [
			{ rel: 'stylesheet', href: fontsCss },
			...FONT_PRELOADS.map((href) => ({
				rel: 'preload',
				as: 'font',
				type: 'font/woff2',
				href,
				crossOrigin: 'anonymous' as const,
			})),
		],
	}),
	shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="es" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body>
				<ChakraProvider value={system}>
					<IdentityProvider>
						{children}
						<TanStackDevtools
							config={{ position: 'bottom-right' }}
							plugins={[
								{
									name: 'Tanstack Router',
									render: <TanStackRouterDevtoolsPanel />,
								},
							]}
						/>
					</IdentityProvider>
				</ChakraProvider>
				<Scripts />
			</body>
		</html>
	)
}
