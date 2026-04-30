import { Box, Heading, Text, VStack } from '@chakra-ui/react'

const STRIPE =
	'repeating-linear-gradient(45deg, var(--chakra-colors-bg-muted) 0 6px, var(--chakra-colors-accent-soft) 6px 12px)'

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
			_before={{
				content: '""',
				position: 'absolute',
				inset: '6px 6px 22px 6px',
				bgImage: STRIPE,
				opacity: 0.7,
			}}
		/>
	)
}

export function EmptyState({ today }: { today: { day: number; month: string } }) {
	return (
		<VStack
			maxW="540px"
			mx="auto"
			textAlign="center"
			pt={10}
			pb={15}
			px={5}
			gap={6}
			color="ink.muted"
		>
			<Box position="relative" h="130px" w="220px" aria-hidden>
				<EmptyPolaroid left="10px" top="12px" transform="rotate(-9deg)" />
				<EmptyPolaroid left="70px" top="0" transform="rotate(3deg)" zIndex={2} />
				<EmptyPolaroid left="130px" top="14px" transform="rotate(8deg)" />
			</Box>
			<Heading
				as="h3"
				fontFamily="heading"
				fontWeight={400}
				fontStyle="italic"
				fontSize="30px"
				letterSpacing="-0.02em"
				color="ink"
				m={0}
			>
				Hoy, nada de nada.
			</Heading>
			<Text m={0} lineHeight={1.6} fontSize="15px">
				Parece que ningún {today.day} de {today.month} ha pasado a la historia familiar todavía.
				<br />
				Buena oportunidad para sacar la cámara hoy, ¿no?
			</Text>
		</VStack>
	)
}
