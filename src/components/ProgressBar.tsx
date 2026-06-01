import { Box } from '@chakra-ui/react'

/**
 * Thin fixed-top loading bar with an indeterminate sweep. Purely
 * presentational — render it whenever `active` is true (e.g. while a router
 * navigation is pending). Renders nothing when inactive.
 */
export function ProgressBar({ active }: { active: boolean }) {
	if (!active) return null
	return (
		<Box
			role="progressbar"
			aria-label="Cargando"
			aria-busy
			position="fixed"
			top={0}
			insetInline={0}
			zIndex="max"
			h="2px"
			bg="accent.soft"
			overflow="hidden"
			pointerEvents="none"
		>
			<Box
				h="full"
				w="30%"
				bg="accent.500"
				borderRadius="full"
				animation="progressSlide 1.1s ease-in-out infinite"
			/>
		</Box>
	)
}
