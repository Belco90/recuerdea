import type { YearGroup } from '#/lib/memories/memory-grouping'
import type { MemoryItem } from '#/lib/memories/pcloud.server'

import { downloadAs } from '#/lib/memories/download'
import { getMediaDownloadUrl } from '#/lib/memories/get-download-url'
import {
	Box,
	Carousel,
	Dialog,
	HStack,
	IconButton,
	Image,
	Portal,
	Spinner,
	Text,
	VStack,
} from '@chakra-ui/react'
import { AlertTriangle, ChevronLeft, ChevronRight, Download, X } from 'lucide-react'
import { useEffect, useState } from 'react'

type LightboxProps = {
	group: YearGroup
	startIndex: number
	open: boolean
	onClose: () => void
}

function yearsAgoLowercase(n: number): string {
	if (n === 0) return 'hoy mismo'
	if (n === 1) return 'hace un año'
	return `hace ${n} años`
}

type VideoMemoryItem = Extract<MemoryItem, { kind: 'video' }>

// Some videos surface with codecs the current browser can't decode (HEVC in
// .mp4 from iPhones is the common case — Safari plays it, desktop Chrome and
// Firefox don't). Show a friendly fallback instead of a broken player; the
// header's download button stays usable so the user can grab the file.
function VideoSlide({ item, active }: { item: VideoMemoryItem; active: boolean }) {
	const [hasError, setHasError] = useState(false)

	useEffect(() => {
		setHasError(false)
	}, [item.uuid])

	if (hasError) {
		return (
			<VStack gap={3} color="whiteAlpha.85" textAlign="center" px={6} maxW="400px">
				<AlertTriangle size={32} aria-hidden style={{ opacity: 0.7 }} />
				<Text fontFamily="mono" fontSize="13px" letterSpacing="0.04em">
					Tu navegador no puede reproducir este vídeo.
				</Text>
				<Text fontSize="sm" opacity={0.65}>
					Pulsa el botón de descarga de arriba para verlo en tu reproductor.
				</Text>
			</VStack>
		)
	}

	return (
		<video
			src={item.mediaUrl}
			poster={item.thumbUrl}
			controls
			autoPlay={active}
			preload={active ? 'metadata' : 'none'}
			onError={(event) => {
				const target = event.currentTarget
				// eslint-disable-next-line no-console
				console.warn('[lightbox] video failed to load', {
					code: target.error?.code,
					message: target.error?.message,
					name: item.name,
					contenttype: item.contenttype,
				})
				setHasError(true)
			}}
			style={{
				maxWidth: '100%',
				maxHeight: '100%',
				objectFit: 'contain',
				borderRadius: '2px',
				background: '#000',
			}}
		>
			<track kind="captions" />
		</video>
	)
}

type DownloadStatus = 'idle' | 'pending' | 'error'

function DownloadButton({ item }: { item: MemoryItem }) {
	const [status, setStatus] = useState<DownloadStatus>('idle')

	const handleClick = async () => {
		setStatus('pending')
		try {
			if (item.kind === 'video') {
				// Route through the auth-gated proxy: the same IP-binding that
				// breaks <video src=…> on direct pCloud CDN URLs also breaks
				// browser-side downloads. The proxy sets Content-Disposition
				// so the browser saves with the original filename.
				await downloadAs({ url: `/api/video/${item.uuid}?download=1`, name: item.name })
			} else {
				const info = await getMediaDownloadUrl({ data: { uuid: item.uuid } })
				await downloadAs({ url: info.url, name: info.name })
			}
			setStatus('idle')
		} catch (err) {
			// eslint-disable-next-line no-console
			console.warn('[lightbox] download failed:', err)
			setStatus('error')
		}
	}

	return (
		<IconButton
			variant="ghost"
			size="2xs"
			color="white"
			shadow="md"
			aria-label={status === 'error' ? 'Error al descargar' : 'Descargar'}
			disabled={status === 'pending'}
			onClick={handleClick}
		>
			{status === 'pending' ? (
				<Spinner size="xs" aria-hidden />
			) : (
				<Download
					size={18}
					aria-hidden
					style={status === 'error' ? { color: 'var(--chakra-colors-red-400)' } : undefined}
				/>
			)}
		</IconButton>
	)
}

export function Lightbox({ group, startIndex, open, onClose }: LightboxProps) {
	const [idx, setIdx] = useState(startIndex)

	useEffect(() => {
		if (open) setIdx(startIndex)
	}, [open, startIndex])

	const items = group.items
	const item = items[idx]

	return (
		<Dialog.Root
			open={open}
			onOpenChange={({ open: o }) => {
				if (!o) onClose()
			}}
			size="full"
		>
			<Portal>
				<Dialog.Backdrop bg="rgba(12,9,6,0.94)" backdropFilter="blur(16px)" />
				<Dialog.Positioner>
					<Dialog.Content
						bg="transparent"
						boxShadow="none"
						display="flex"
						flexDirection="column"
						h="100vh"
						maxW="100vw"
						color="white"
					>
						<HStack justify="space-between" align="center" px={4.5} py={3.5} color="whiteAlpha.85">
							<HStack
								gap={2.5}
								fontFamily="mono"
								fontSize="12px"
								letterSpacing="0.08em"
								textTransform="uppercase"
							>
								<Box as="span" color="white" fontWeight={600}>
									{group.year}
								</Box>
								<Box as="span" opacity={0.4}>
									·
								</Box>
								<Box as="span" opacity={0.65}>
									{yearsAgoLowercase(group.yearsAgo)}
								</Box>
								{item.place && (
									<>
										<Box as="span" opacity={0.4}>
											·
										</Box>
										<Box as="span" opacity={0.65}>
											{item.place}
										</Box>
									</>
								)}
								<DownloadButton item={item} />
							</HStack>
							<HStack gap="2" flex="1" justify="center">
								<Box
									as="span"
									fontFamily="mono"
									fontSize="12px"
									letterSpacing="0.08em"
									opacity={0.7}
								>
									{idx + 1} / {items.length}
								</Box>
								<Dialog.CloseTrigger asChild display="flex">
									<IconButton variant="ghost" size="sm" aria-label="Cerrar">
										<X size={18} aria-hidden />
									</IconButton>
								</Dialog.CloseTrigger>
							</HStack>
						</HStack>

						<Carousel.Root
							slideCount={items.length}
							page={idx}
							onPageChange={({ page }) => setIdx(page)}
							slidesPerPage={1}
							loop={false}
							allowMouseDrag
							snapType="mandatory"
							flex={1}
							gap={0}
							minH={0}
							position="relative"
						>
							<Carousel.ItemGroup flex={1} minH={0}>
								{items.map((it, i) => (
									<Carousel.Item
										key={it.uuid}
										index={i}
										display="flex"
										alignItems="center"
										justifyContent="center"
										px={3}
										h="full"
									>
										{it.kind === 'video' ? (
											<VideoSlide item={it} active={i === idx} />
										) : (
											<Image
												src={it.lightboxUrl}
												alt={it.name || 'Recuerdo'}
												maxW="full"
												maxH="full"
												objectFit="contain"
												borderRadius="2px"
												bg="black"
												draggable={false}
											/>
										)}
									</Carousel.Item>
								))}
							</Carousel.ItemGroup>

							<Carousel.Control
								position="absolute"
								inset={0}
								pointerEvents="none"
								justifyContent="space-between"
								px={3.5}
								display={{ base: 'none', md: 'flex' }}
							>
								<Carousel.PrevTrigger asChild>
									<IconButton
										w="44px"
										h="44px"
										minW="44px"
										borderRadius="full"
										bg="whiteAlpha.100"
										color="white"
										pointerEvents="auto"
										_hover={{ bg: 'whiteAlpha.300' }}
										_disabled={{ opacity: 0, pointerEvents: 'none' }}
										aria-label="Anterior"
									>
										<ChevronLeft size={20} aria-hidden />
									</IconButton>
								</Carousel.PrevTrigger>
								<Carousel.NextTrigger asChild>
									<IconButton
										w="44px"
										h="44px"
										minW="44px"
										borderRadius="full"
										bg="whiteAlpha.100"
										color="white"
										pointerEvents="auto"
										_hover={{ bg: 'whiteAlpha.300' }}
										_disabled={{ opacity: 0, pointerEvents: 'none' }}
										aria-label="Siguiente"
									>
										<ChevronRight size={20} aria-hidden />
									</IconButton>
								</Carousel.NextTrigger>
							</Carousel.Control>

							<VStack gap={2.5} px={4.5} py={5} textAlign="center">
								<Carousel.IndicatorGroup gap={1.5}>
									{items.map((it, i) => (
										<Carousel.Indicator
											key={it.uuid}
											index={i}
											aria-label={`Ir al recuerdo ${i + 1}`}
											w="6px"
											h="6px"
											minW="6px"
											borderRadius="full"
											bg="whiteAlpha.400"
											border={0}
											p={0}
											cursor="pointer"
											transition="background 0.15s, transform 0.15s"
											_current={{ bg: 'accent.500', transform: 'scale(1.3)' }}
										/>
									))}
								</Carousel.IndicatorGroup>
							</VStack>
						</Carousel.Root>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	)
}
