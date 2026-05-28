/// <reference types="vite/client" />

declare namespace NodeJS {
	interface ProcessEnv {
		PCLOUD_TOKEN: string
		PCLOUD_MEMORIES_FOLDER_ID: string
		PCLOUD_SOURCE_FOLDER_ID?: string
	}
}
