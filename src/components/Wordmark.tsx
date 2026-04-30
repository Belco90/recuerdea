import { Box } from '@chakra-ui/react'

const SIZES = { sm: '20px', md: '22px', lg: '28px' } as const

export function Wordmark({ size = 'md' }: { size?: keyof typeof SIZES }) {
	return (
		<Box
			as="span"
			display="inline-flex"
			alignItems="baseline"
			gap="1px"
			lineHeight="1"
			fontFamily="heading"
			fontWeight={500}
			fontStyle="italic"
			letterSpacing="-0.025em"
			color="ink"
			fontSize={SIZES[size]}
		>
			<Box
				as="span"
				display="inline-block"
				transform="translateY(-1px) rotate(-4deg)"
				color="accent.500"
				fontWeight={600}
				mr="1px"
			>
				R
			</Box>
			ecuerdea
			<Box
				as="span"
				color="accent.500"
				fontStyle="normal"
				fontWeight={700}
				ml="1px"
				aria-hidden="true"
			>
				.
			</Box>
		</Box>
	)
}
