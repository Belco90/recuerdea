import type { ReactNode } from 'react'

import { Box, Text } from '@chakra-ui/react'

export function Timeline({ children }: { children: ReactNode }) {
	return (
		<Box position="relative">
			<Box
				position="absolute"
				left={{ base: '18px', md: '90px' }}
				top={2}
				bottom="60px"
				w="1px"
				bgGradient="to-b"
				gradientFrom="line"
				gradientTo="transparent"
				aria-hidden
			/>
			{children}
			<Box
				position="absolute"
				left={{ base: '14px', md: '86px' }}
				bottom="50px"
				w="9px"
				h="9px"
				borderRadius="full"
				bg="bg"
				borderWidth="1px"
				borderColor="line"
				aria-hidden
			/>
			<Text
				mt={7}
				textAlign="center"
				color="ink.muted"
				fontFamily="heading"
				fontStyle="italic"
				fontSize="16px"
			>
				Vuelve mañana — habrá nuevos recuerdos.
			</Text>
		</Box>
	)
}
