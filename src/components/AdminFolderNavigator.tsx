import type { AdminFolderListing, SourceFileItem } from '#/lib/admin/source-folder.server'

import { EmptyMedia, FileGrid } from '#/components/AdminMediaGrid'
import { Button, HStack, SimpleGrid, Stack, Text, chakra } from '@chakra-ui/react'
import { ChevronRight, Folder } from 'lucide-react'

const TileButton = chakra('button')

type AdminFolderNavigatorProps = {
	listing: AdminFolderListing
	picked: ReadonlySet<number>
	blocked: ReadonlySet<number>
	onNavigate: (folderid: number) => void
	onToggle: (item: SourceFileItem) => void
	/** True when a date filter is hiding media in the current folder. */
	dateFilterActive?: boolean
}

export function AdminFolderNavigator({
	listing,
	picked,
	blocked,
	onNavigate,
	onToggle,
	dateFilterActive = false,
}: AdminFolderNavigatorProps) {
	return (
		<Stack gap={5}>
			<Breadcrumbs crumbs={listing.breadcrumbs} onNavigate={onNavigate} />
			{listing.subfolders.length > 0 && (
				<SubfolderGrid subfolders={listing.subfolders} onNavigate={onNavigate} />
			)}
			{listing.files.length > 0 ? (
				<FileGrid files={listing.files} picked={picked} blocked={blocked} onToggle={onToggle} />
			) : (
				<EmptyMedia dateFilterActive={dateFilterActive} />
			)}
		</Stack>
	)
}

type Crumb = { folderid: number; name: string }

function Breadcrumbs({
	crumbs,
	onNavigate,
}: {
	crumbs: ReadonlyArray<Crumb>
	onNavigate: (folderid: number) => void
}) {
	return (
		<HStack gap={1} flexWrap="wrap" fontSize="sm" color="ink.muted">
			{crumbs.map((c, i) => {
				const isLast = i === crumbs.length - 1
				return (
					<HStack key={c.folderid} gap={1}>
						<Button
							variant="ghost"
							size="xs"
							onClick={() => onNavigate(c.folderid)}
							color={isLast ? 'ink' : 'ink.muted'}
							fontWeight={isLast ? 600 : 400}
						>
							{c.name}
						</Button>
						{!isLast && <ChevronRight size={12} aria-hidden />}
					</HStack>
				)
			})}
		</HStack>
	)
}

function SubfolderGrid({
	subfolders,
	onNavigate,
}: {
	subfolders: ReadonlyArray<Crumb>
	onNavigate: (folderid: number) => void
}) {
	return (
		<SimpleGrid columns={{ base: 2, sm: 3, md: 4 }} gap={3}>
			{subfolders.map((f) => (
				<TileButton
					key={f.folderid}
					type="button"
					aria-label={`Abrir ${f.name}`}
					onClick={() => onNavigate(f.folderid)}
					p={4}
					display="flex"
					flexDir="column"
					alignItems="center"
					gap={2}
					border="1px solid"
					borderColor="line"
					borderRadius="md"
					bg="paper"
					cursor="pointer"
					transition="border-color 0.15s ease, transform 0.15s ease"
					_hover={{ borderColor: 'accent.300', transform: 'translateY(-1px)' }}
				>
					<Folder size={32} aria-hidden />
					<Text fontSize="xs" fontFamily="mono" color="ink" textAlign="center" truncate maxW="full">
						{f.name}
					</Text>
				</TileButton>
			))}
		</SimpleGrid>
	)
}
