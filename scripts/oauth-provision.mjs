#!/usr/bin/env node
import { env, exit, stderr, stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { buildAuthorizeUrl, getTokenFromCode } from 'pcloud-kit/oauth'

function requireEnv(name) {
	const value = env[name]
	if (!value) {
		stderr.write(`error: ${name} is not set\n`)
		exit(1)
	}
	return value
}

function extractCode(raw) {
	const trimmed = raw.trim()
	try {
		const url = new URL(trimmed)
		return url.searchParams.get('code') ?? trimmed
	} catch {
		return trimmed
	}
}

const clientId = requireEnv('PCLOUD_CLIENT_ID')
const appSecret = requireEnv('PCLOUD_APP_SECRET')
const redirectUri = requireEnv('PCLOUD_REDIRECT_URI')

const authorizeUrl = buildAuthorizeUrl({ clientId, redirectUri, responseType: 'code' })

stderr.write('Open this URL, sign in, then paste the redirect URL (or the bare code) below:\n\n')
stderr.write(`  ${authorizeUrl}\n\n`)

const rl = createInterface({ input: stdin, output: stderr })
const raw = await rl.question('code: ')
rl.close()

const code = extractCode(raw)
if (!code) {
	stderr.write('error: no code provided\n')
	exit(1)
}

try {
	const result = await getTokenFromCode(code, clientId, appSecret)
	stdout.write(`access_token=${result.access_token}\n`)
	stdout.write(`locationid=${result.locationid}\n`)
} catch (err) {
	stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`)
	exit(1)
}
