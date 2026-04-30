import { Box, HStack, Heading } from '@chakra-ui/react'

type HeroProps = {
	today: { day: number; month: string; year: number }
	totalItems: number
	groupCount: number
}

export function Hero({ today, totalItems, groupCount }: HeroProps) {
	const countLabel =
		totalItems > 0
			? `${totalItems} ${totalItems === 1 ? 'recuerdo' : 'recuerdos'} · ${groupCount} ${
					groupCount === 1 ? 'año' : 'años'
				}`
			: 'Hoy en tus recuerdos'

	return (
		<Box as="section" pt={4.5} pb={9}>
			<HStack align="baseline" gap={3.5} flexWrap="wrap" lineHeight={0.9}>
				<Heading
					as="span"
					fontFamily="heading"
					fontWeight={400}
					letterSpacing="-0.04em"
					color="ink"
					fontSize="clamp(64px, 16vw, 140px)"
					fontFeatureSettings='"lnum"'
				>
					{today.day}
				</Heading>
				<Heading
					as="span"
					fontFamily="heading"
					fontWeight={400}
					fontStyle="italic"
					color="accent.500"
					letterSpacing="-0.02em"
					fontSize="clamp(28px, 6vw, 52px)"
				>
					de {today.month}
				</Heading>
			</HStack>
			<HStack
				mt={4}
				align="center"
				gap={3}
				flexWrap="wrap"
				fontFamily="mono"
				fontSize="12px"
				letterSpacing="0.06em"
				textTransform="uppercase"
				color="ink.muted"
			>
				<Box as="span" fontWeight={600} color="ink" letterSpacing="0.08em">
					{today.year}
				</Box>
				<Box w="28px" h="1px" bg="ink.muted" opacity={0.5} aria-hidden />
				<Box as="span">{countLabel}</Box>
			</HStack>
		</Box>
	)
}
