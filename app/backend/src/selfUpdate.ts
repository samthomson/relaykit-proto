import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { TRPCError } from '@trpc/server'
import { dockerSocketGetBuffer, dockerSocketGetJson, dockerSocketMutate } from './dockerSocket'
import {
  RELAYKIT_UPDATE_CHANNEL_DEFAULT,
  RELAYKIT_UPDATE_CHANNELS,
  RELAYKIT_UPDATE_HELPER_IMAGE,
  VERSION_FILE_PATH,
  type RelaykitUpdateChannel,
} from './constants'

export type RelaykitVersion = { version: string; dokployVersion: string; notes: string }
export type RemoteVersion = { version: string; notes: string }

export const readRelaykitVersion = async (): Promise<RelaykitVersion> => {
  const parsed = JSON.parse(await fs.readFile(VERSION_FILE_PATH, 'utf-8'))
  return {
    version: String(parsed.version || 'unknown'),
    dokployVersion: String(parsed.dokployVersion || 'unknown'),
    notes: String(parsed.notes || ''),
  }
}

const CHANNEL_FILE_PATH = '/app/.relaykit/update-channel'

export const readUpdateChannel = async (): Promise<RelaykitUpdateChannel> => {
  try {
    const raw = (await fs.readFile(CHANNEL_FILE_PATH, 'utf-8')).trim()
    return RELAYKIT_UPDATE_CHANNELS.includes(raw as RelaykitUpdateChannel)
      ? (raw as RelaykitUpdateChannel)
      : RELAYKIT_UPDATE_CHANNEL_DEFAULT
  } catch {
    return RELAYKIT_UPDATE_CHANNEL_DEFAULT
  }
}

export const writeUpdateChannel = async (channel: RelaykitUpdateChannel): Promise<void> => {
  await fs.writeFile(CHANNEL_FILE_PATH, channel, 'utf-8')
}

/** Compare dotted numeric versions (e.g. 1.4.3). Non-numeric parts compare as 0. */
export const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map((p) => parseInt(p, 10) || 0)
  const pb = b.split('.').map((p) => parseInt(p, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da < db ? -1 : 1
  }
  return 0
}

/** Image ref of the container this backend runs in (e.g. ghcr.io/samthomson/relaykit:latest); null outside docker. */
export const getOwnImageRef = async (): Promise<string | null> => {
  try {
    const info = await dockerSocketGetJson(`/containers/${os.hostname()}/json`)
    const image = String(info?.Config?.Image || '').trim()
    return image || null
  } catch {
    return null
  }
}

const parseImageRef = (ref: string): { registry: string; repo: string; tag: string } | null => {
  const [nameAndDigest] = ref.split('@')
  const firstSlash = nameAndDigest.indexOf('/')
  const registry = firstSlash === -1 ? '' : nameAndDigest.slice(0, firstSlash)
  // A registry is present only when the leading component looks like a host (dot or port, e.g. ghcr.io, localhost:5000).
  if (!registry || !/[.:]/.test(registry)) return null
  // The tag separator is the last colon *after* the last slash — earlier colons belong to the registry (host:port).
  const lastSlash = nameAndDigest.lastIndexOf('/')
  const colon = nameAndDigest.slice(lastSlash + 1).lastIndexOf(':')
  const tag = colon === -1 ? 'latest' : nameAndDigest.slice(lastSlash + 1 + colon + 1)
  const repo = colon === -1 ? nameAndDigest : nameAndDigest.slice(0, lastSlash + 1 + colon)
  return { registry, repo, tag }
}

/** Read the version/notes labels off a remote image manifest (anonymous pull; works for public GHCR). */
export const fetchRemoteImageVersion = async (
  ref: string,
  tagOverride?: string,
): Promise<RemoteVersion | null> => {
  const parsed = parseImageRef(ref)
  if (!parsed) return null
  const { registry, repo } = parsed
  const tag = tagOverride ?? parsed.tag
  const base = `https://${registry}`
  const timeout = AbortSignal.timeout(10_000)
  const tokenRes = await fetch(`${base}/token?scope=repository:${repo}:pull&service=${registry}`, { signal: timeout })
  if (!tokenRes.ok) throw new Error(`registry token request failed: ${tokenRes.status}`)
  const token = (await tokenRes.json())?.token
  const authHeaders = { Authorization: `Bearer ${token}` } as Record<string, string>
  const manifestHeaders = {
    ...authHeaders,
    // Must include index/list types: multi-platform tags 404 without them.
    Accept:
      'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, ' +
      'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
  }
  const manifestRes = await fetch(`${base}/v2/${repo}/manifests/${tag}`, { headers: manifestHeaders, signal: timeout })
  if (!manifestRes.ok) throw new Error(`registry manifest request failed: ${manifestRes.status}`)
  let manifest = await manifestRes.json()
  // Multi-platform tags return an index; resolve the amd64 (server) entry before reading config.
  if (Array.isArray(manifest?.manifests)) {
    const entries = manifest.manifests as { digest: string; platform?: { architecture?: string } }[]
    const chosen = entries.find((m) => m.platform?.architecture === 'amd64') ?? entries[0]
    const subRes = await fetch(`${base}/v2/${repo}/manifests/${chosen.digest}`, { headers: manifestHeaders, signal: timeout })
    if (!subRes.ok) throw new Error(`registry platform manifest request failed: ${subRes.status}`)
    manifest = await subRes.json()
  }
  const configDigest = manifest?.config?.digest
  if (!configDigest) return null
  const configRes = await fetch(`${base}/v2/${repo}/blobs/${configDigest}`, { headers: authHeaders, signal: timeout })
  if (!configRes.ok) throw new Error(`registry config request failed: ${configRes.status}`)
  const config = await configRes.json()
  const labels = config?.config?.Labels || {}
  const version = String(labels['org.opencontainers.image.version'] || '').trim()
  if (!version) return null
  return { version, notes: String(labels['org.opencontainers.image.description'] || '').trim() }
}

// --- update mechanics --------------------------------------------------------------------

type DockerContainerId = { Id: string }

/** Minimal single-file tar reader for docker's /archive endpoint (names are path-relative, e.g. "app/release.yml"). */
const extractTarEntry = (tar: Buffer, entryName: string): Buffer | null => {
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    if (!name) return null
    const size = parseInt(header.subarray(124, 136).toString('utf8').trim(), 8) || 0
    const dataStart = offset + 512
    if (name === entryName) return tar.subarray(dataStart, dataStart + size)
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return null
}

/** Read one file out of an image without running it: temp container → archive copy → remove. */
const extractFileFromImage = async (imageRef: string, containerPath: string): Promise<string> => {
  // Archiving a single file yields a tar whose sole entry is named by basename.
  const entryName = containerPath.split('/').filter(Boolean).pop() ?? containerPath
  const createdRes = await dockerSocketMutate(
    `/containers/create?name=relaykit-update-extract-${Date.now()}`,
    'POST',
    JSON.stringify({ Image: imageRef }),
  )
  const { Id } = JSON.parse(createdRes.toString('utf8')) as DockerContainerId
  try {
    const tar = await dockerSocketGetBuffer(`/containers/${Id}/archive?path=${encodeURIComponent(containerPath)}`)
    const entry = extractTarEntry(tar, entryName)
    if (!entry) throw new Error(`${entryName} not found in image ${imageRef}`)
    return entry.toString('utf8')
  } finally {
    await dockerSocketMutate(`/containers/${Id}?force=1`, 'DELETE').catch((e) =>
      console.warn('failed to remove image-extract container', e),
    )
  }
}

/**
 * Run the stack update for the container running this backend (or an explicit container, for
 * verification): pulls the release-channel image, extracts its bundled release.yml onto the
 * shared data volume, then starts a detached docker:cli helper (outlives this container's
 * death) that runs `docker compose up -d --pull always` against the release.yml.
 */
export const startSelfUpdate = async (
  selfContainerId: string = os.hostname(),
  channel: RelaykitUpdateChannel = RELAYKIT_UPDATE_CHANNEL_DEFAULT,
): Promise<{ imageRef: string }> => {
  const self = await dockerSocketGetJson(`/containers/${selfContainerId}/json`)
  // Inspect (unlike /containers/json list) nests labels under Config.
  const labels = (self?.Config?.Labels || {}) as Record<string, string>
  const project = labels['com.docker.compose.project']?.trim()
  if (!project) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Self-update requires running under docker compose.' })

  const runningRef = String(self?.Config?.Image || '').trim()
  const parsed = parseImageRef(runningRef)
  if (!parsed) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `Self-update requires a registry image (running from "${runningRef}"); locally built dev images can't self-update.`,
    })
  }
  const updateRef = `${parsed.repo}:${channel}`

  // Pull the channel image first: failures here leave the stack untouched.
  // parsed.repo is the full path including the registry host (e.g. localhost:5057/relaykit).
  await dockerSocketMutate(
    `/images/create?fromImage=${encodeURIComponent(parsed.repo)}&tag=${channel}`,
    'POST',
  )
  // containers/create does not auto-pull; ensure the compose helper image exists locally.
  const [helperRepo, helperTag = 'latest'] = RELAYKIT_UPDATE_HELPER_IMAGE.split(':')
  await dockerSocketMutate(`/images/create?fromImage=${encodeURIComponent(helperRepo)}&tag=${helperTag}`, 'POST')

  // Locate the shared data volume (relaykit_data) via our own mounts, then stage release.yml from the new image onto it.
  const mounts = Array.isArray(self?.Mounts) ? self.Mounts : []
  const dataMount = mounts.find((m: { Destination?: string }) => m?.Destination === '/app/.relaykit') as { Name?: string } | undefined
  if (!dataMount?.Name) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Shared relaykit_data volume not found on this container.' })
  }
  const releaseYml = await extractFileFromImage(updateRef, '/app/release.yml')
  await fs.writeFile(path.join('/app/.relaykit', 'release.yml'), releaseYml, 'utf-8')

  const helperConfig = {
    Image: RELAYKIT_UPDATE_HELPER_IMAGE,
    Cmd: ['docker', 'compose', '-p', project, '-f', '/release/release.yml', '--profile', 'prod', 'up', '-d', '--pull', 'always'],
    Env: [
      `RELAYKIT_IMAGE=${updateRef}`,
      `JWT_SECRET=${process.env.JWT_SECRET ?? ''}`,
      `RELAYKIT_HOST=${process.env.RELAYKIT_HOST ?? ''}`,
    ],
    HostConfig: {
      Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
      Mounts: [{ Type: 'volume', Source: dataMount.Name, Target: '/release', ReadOnly: true }],
      AutoRemove: true,
    },
  }
  const helperRes = await dockerSocketMutate(
    `/containers/create?name=relaykit-self-update-${Date.now()}`,
    'POST',
    JSON.stringify(helperConfig),
  )
  const { Id: helperId } = JSON.parse(helperRes.toString('utf8')) as DockerContainerId
  await dockerSocketMutate(`/containers/${helperId}/start`, 'POST')
  return { imageRef: updateRef }
}
