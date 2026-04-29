import type { MemoryItem } from '#/lib/pcloud.server'

import { formatCaptureDate } from '#/lib/date'
import { Box, Image, Stack, Text } from '@chakra-ui/react'

export function MemoryView({ item }: { item: MemoryItem }) {
	const formatted = formatCaptureDate(item.captureDate)
	const url = `/api/memory/${item.uuid}?variant=${item.kind === 'image' ? 'image' : 'stream'}`
	const posterUrl = item.kind === 'video' ? `/api/memory/${item.uuid}?variant=poster` : undefined
	return (
		<Stack gap={2}>
			{item.kind === 'image' ? (
				<Image src={url} alt={item.name} maxW="md" />
			) : (
				<Box maxW="md">
					<video
						controls
						preload="metadata"
						poster={posterUrl}
						style={{ width: '100%', display: 'block' }}
					>
						<source src={url} type={item.contenttype} />
						<track kind="captions" />
					</video>
				</Box>
			)}
			{formatted && (
				<Text fontSize="sm" color="gray.600">
					Taken {formatted}
				</Text>
			)}
		</Stack>
	)
}
