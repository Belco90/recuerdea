import { Box, EmptyState as ChakraEmptyState } from '@chakra-ui/react'

type EmptyPolaroidProps = {
	left: string
	top: string
	transform: string
	zIndex?: number
}

function EmptyPolaroid({ left, top, transform, zIndex }: EmptyPolaroidProps) {
	return (
		<Box
			position="absolute"
			w="88px"
			h="100px"
			bg="paper"
			borderRadius="2px"
			boxShadow="rdShadow"
			left={left}
			top={top}
			transform={transform}
			zIndex={zIndex}
		/>
	)
}

export function EmptyState({ today }: { today: { day: number; month: string } }) {
	return (
		<ChakraEmptyState.Root maxW="540px" mx="auto" pt={10} pb={15} px={5} color="ink.muted">
			<ChakraEmptyState.Content gap={6} textAlign="center">
				<ChakraEmptyState.Indicator boxSize="auto">
					<Box position="relative" h="130px" w="220px" aria-hidden>
						<EmptyPolaroid left="10px" top="12px" transform="rotate(-9deg)" />
						<EmptyPolaroid left="70px" top="0" transform="rotate(3deg)" zIndex={2} />
						<EmptyPolaroid left="130px" top="14px" transform="rotate(8deg)" />
					</Box>
				</ChakraEmptyState.Indicator>
				<ChakraEmptyState.Title
					fontFamily="heading"
					fontWeight={400}
					fontStyle="italic"
					fontSize="30px"
					letterSpacing="-0.02em"
					color="ink"
				>
					Hoy, nada de nada.
				</ChakraEmptyState.Title>
				<ChakraEmptyState.Description lineHeight={1.6} fontSize="15px">
					Parece que ningún {today.day} de {today.month} ha pasado a la historia familiar todavía.
					<br />
					Buena oportunidad para sacar la cámara hoy, ¿no?
				</ChakraEmptyState.Description>
			</ChakraEmptyState.Content>
		</ChakraEmptyState.Root>
	)
}
