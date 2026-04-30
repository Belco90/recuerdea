import type { ReactNode } from 'react'

import { Box } from '@chakra-ui/react'

export function AppShell({ children }: { children: ReactNode }) {
	return (
		<Box minH="100vh" color="ink">
			{children}
		</Box>
	)
}
