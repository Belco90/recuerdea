import type { ReactElement, ReactNode } from 'react'

import { system } from '#/theme'
import { ChakraProvider } from '@chakra-ui/react'
import { render as baseRender } from 'vitest-browser-react'

function Providers({ children }: { children: ReactNode }) {
	return <ChakraProvider value={system}>{children}</ChakraProvider>
}

export function render(ui: ReactElement) {
	return baseRender(ui, { wrapper: Providers })
}
