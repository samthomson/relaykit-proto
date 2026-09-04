import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'
import dns from 'dns/promises'
import fs from 'fs/promises'
import path from 'path'
import http from 'http'
import os from 'os'
import { createAuthContext, requireAuth, AuthContext } from './auth/middleware'
import { getBootstrapKey, setBootstrapKey } from './db'
import {
  DOKPLOY_URL,
  PRESETS_DIR,
  DEFAULT_PROJECT_NAME,
  SERVER_INSIGHTS,
  SERVICE_INSIGHTS,
  VERSION_FILE_PATH,
} from './constants'
import {
  DOCKER_SOCKET_PATH,
  dockerSocketGetBuffer,
  dockerSocketGetJson,
  dockerSocketMutate,
} from './dockerSocket'
import {
  compareVersions,
  readChangelog,
  fetchRemoteImageVersion,
  getOwnImageRef,
  isRegistryRef,
  readRelaykitVersion,
  readUpdateChannel,
  startSelfUpdate,
  writeUpdateChannel,
  type RelaykitVersion,
  type RemoteVersion,
} from './selfUpdate'
import { RELAYKIT_UPDATE_CHANNELS, type RelaykitUpdateChannel } from './constants'
import { isNpanelType } from '../../shared/serviceType'
import { applyNsiteHostnameToEnv, finalizeNsiteRouterEnv, normalizeNpanelNip05UsersEnv, normalizeVisitorHost, NPANEL_NIP05_USERS_ENV_KEY } from '../../shared/nsite'
import { createServerInsightsCollector, trimInsightPointsToWindow, type ServiceInsightsResponse } from '../../shared/insights'

const t = initTRPC.context<{ auth: AuthContext | null; noBootstrapKey?: boolean; host?: string }>().create()
const serverInsightsCollector = createServerInsightsCollector(SERVER_INSIGHTS)

export const router = t.router
export const publicProcedure = t.procedure
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.noBootstrapKey) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'RelayKit is not configured. Run the setup script with your npub to set the Dokploy API key (see README).',
    })
  }
  const auth = requireAuth(ctx.auth)
  return next({ ctx: { ...ctx, auth } })
})

// Dokploy domain.create expects these; dev = no Traefik cert (Caddy/mkcert), prod = Let's Encrypt
enum CertificateType {
  None = 'none',
  LetsEncrypt = 'letsencrypt'
}
const getCertificateType = (): CertificateType =>
  process.env.NODE_ENV === 'development' ? CertificateType.None : CertificateType.LetsEncrypt

const parseServiceEnvVarsString = (env: string | undefined): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!env) return out
  env.split('\n').forEach((line: string) => {
    const [key, ...values] = line.split('=')
    if (key && values.length > 0) {
      out[key.trim()] = values.join('=').trim()
    }
  })
  return out
}

const parseCsvList = (value: string | undefined): string[] =>
  (value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

type PresetFieldType = 'string' | 'boolean' | 'domain' | 'npub' | 'relays'
type PresetField = {
  id: string
  name: string
  type?: PresetFieldType
  required?: boolean
  default?: string
  description?: string
  placeholder?: string
  /** for 'domain' fields: suggested subdomain prefix, prefills <subdomain>.<relaykit host> */
  subdomain?: string
  /** keep the deploy modal minimal: hide this field there, but keep it in the post-deploy config editor */
  hideOnDeploy?: boolean
}
type PresetMetadata = {
  id: string
  label: string
  description?: string
  type?: string
  serviceName?: string
  internalPort: number
  domainConfigKey?: string
  /** additional public domains for sidecar containers (e.g. pulse's bundled ntfy server) */
  extraDomains?: { configKey: string; serviceName: string; internalPort: number }[]
  requiredConfig: PresetField[]
  repo?: string
  icon?: string
}

const stringifyEnvVars = (envVars: Record<string, string>): string =>
  Object.entries(envVars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

const coerceConfigValueToString = (field: PresetField, value: unknown): string => {
  const fieldType = field.type ?? 'string'
  if (fieldType === 'boolean') {
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    const str = String(value ?? '').trim().toLowerCase()
    return str === 'true' || str === '1' || str === 'yes' ? 'true' : 'false'
  }
  return String(value ?? '')
}

/**
 * Typed `domain` fields are excluded from the generic config editor; they're edited via the
 * per-domain pencil icon. Plain string host fields (e.g. the relay's RELAY_HOST) remain
 * editable there — syncServiceDomains runs on every save, so the Dokploy domain rows
 * always follow the env.
 */
const getEditablePresetFields = (preset: PresetMetadata): PresetField[] =>
  (preset.requiredConfig || []).filter((f) => f.type !== 'domain')

type DomainField = { configKey: string; label: string; host: string; internalPort: number; serviceName?: string }

/** All domain-backed fields for a preset (primary + extras), each resolved to its current host and target container. */
const domainFieldsFor = (preset: PresetMetadata, envVars: Record<string, string>): DomainField[] => {
  const fieldName = (configKey: string) => preset.requiredConfig?.find((f) => f.id === configKey)?.name ?? configKey
  const domainKey = preset.domainConfigKey ?? 'RELAY_HOST'
  const fields: DomainField[] = []
  if (envVars[domainKey]) {
    fields.push({
      configKey: domainKey,
      label: fieldName(domainKey),
      host: envVars[domainKey],
      internalPort: preset.internalPort,
      serviceName: preset.serviceName,
    })
  }
  for (const extra of preset.extraDomains ?? []) {
    if (!envVars[extra.configKey]) continue
    fields.push({
      configKey: extra.configKey,
      label: fieldName(extra.configKey),
      host: envVars[extra.configKey],
      internalPort: extra.internalPort,
      serviceName: extra.serviceName,
    })
  }
  return fields
}

// Public host sanity: dotless ("relay2") or malformed hosts can never get DNS or a cert, and
// poison Traefik with routers that retry Let's Encrypt forever.
const isValidPublicHost = (value: string): boolean =>
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(value.trim())

const getPresetMetadata = async (presetId: string) => {
  const metadata = await fs.readFile(path.join(PRESETS_DIR, presetId, 'metadata.json'), 'utf-8')
  return JSON.parse(metadata) as PresetMetadata
}

const ensureADefaultProjectExistsForServices = async (): Promise<{ projectId: string; environmentId: string }> => {
  const projects = await dokployFetch('/api/project.all')
  
  if (!Array.isArray(projects)) {
    throw new Error(`Expected array from project.all, got: ${typeof projects}`)
  }
  
  let project = projects.find((p: { name: string }) => p.name === DEFAULT_PROJECT_NAME)
  if (project) {
    const envId = project.environments?.[0]?.environmentId
    if (!envId) throw new Error(`No environment in project ${project.projectId}`)
    return { projectId: project.projectId, environmentId: envId }
  }
  
  const created = await dokployFetch('/api/project.create', {
    method: 'POST',
    body: JSON.stringify({ name: DEFAULT_PROJECT_NAME, description: 'Ungrouped services deployed via RelayKit' }),
  })
  
  const all = await dokployFetch('/api/project.all')
  project = all.find((p: { projectId: string }) => p.projectId === created.projectId)
  const environmentId = project?.environments?.[0]?.environmentId
  if (!environmentId) {
    throw new Error(`No environment after project create. Project: ${JSON.stringify(project)}`)
  }
  return { projectId: created.projectId, environmentId }
}

/** Restart Traefik so it retries ACME for hosts in config but missing from acme.json. */
const reloadDokployTraefik = async () => {
  const containers = await dockerSocketGetJson('/containers/json?all=0')
  const traefik = (Array.isArray(containers) ? containers : []).find((c: any) =>
    String(c?.Names?.[0] || '').includes('dokploy-traefik-prod'),
  )
  if (!traefik?.Id) throw new Error('dokploy-traefik-prod container not found')
  await dockerSocketMutate(`/containers/${traefik.Id}/restart`, 'POST')
}

const registerDomain = async (composeId: string, host: string, presetData: { internalPort: number; serviceName?: string }) => {
  if (!isValidPublicHost(host)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `"${host}" is not a valid public domain — use a full hostname like relay.example.com.` })
  }
  const certificateType = getCertificateType()
  const domainPayload = {
    composeId,
    host,
    https: certificateType !== CertificateType.None,
    path: '/',
    port: presetData.internalPort,
    certificateType,
    serviceName: presetData.serviceName,
  }
  
  console.log('Creating domain with payload:', JSON.stringify(domainPayload, null, 2))
  
  try {
    const response = await dokployFetch('/api/domain.create', {
      method: 'POST',
      body: JSON.stringify(domainPayload),
    })
    console.log('Domain creation successful:', JSON.stringify(response, null, 2))
    return response
  } catch (error) {
    console.error('Domain creation failed:', error)
    throw error
  }
}

type DokployDomainRow = { domainId: string; host: string; certificateType?: string }

/**
 * Reconcile Dokploy domain rows with the hosts the service is configured for (domainFieldsFor —
 * env is the source of truth): delete rows whose host is gone or whose certificate type is stale
 * (rows created without TLS never heal by redeploying — Traefik only requests a cert when the
 * router carries the letsencrypt resolver), and register any configured host that's missing.
 * Runs on deploy, config save, and domain edits so routing/TLS can't drift from the config.
 * Takes the caller's current rows (each call site has already fetched the compose) — deletions
 * are awaited, so the surviving rows are known without a refetch.
 */
const syncServiceDomains = async (
  composeId: string,
  preset: PresetMetadata,
  envVars: Record<string, string>,
  currentDomains: DokployDomainRow[],
) => {
  const wanted = new Map<string, DomainField>()
  for (const field of domainFieldsFor(preset, envVars)) {
    const host = String(field.host || '').trim().toLowerCase()
    if (host && field.serviceName) wanted.set(host, field)
  }
  if (wanted.size === 0) return

  const certificateType = getCertificateType()
  const existing = new Set<string>()
  for (const dom of currentDomains) {
    const host = String(dom.host || '').trim().toLowerCase()
    if (wanted.has(host) && (dom.certificateType ?? 'none') === certificateType) {
      existing.add(host)
    } else {
      await dokployFetch('/api/domain.delete', {
        method: 'POST',
        body: JSON.stringify({ domainId: dom.domainId }),
      })
    }
  }
  for (const [host, field] of wanted) {
    if (!existing.has(host)) await registerDomain(composeId, host, field)
  }
}

const diagnoseDokployAuthFailure = async (): Promise<{
  likelyInfraIssue: boolean
  detail: string
}> => {
  try {
    const res = await fetch(`${DOKPLOY_URL}/api/auth/session`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    })
    if (res.status >= 500) {
      return {
        likelyInfraIssue: true,
        detail: `Dokploy auth/session endpoint returned ${res.status}.`,
      }
    }
    return {
      likelyInfraIssue: false,
      detail: `Dokploy auth/session endpoint returned ${res.status}.`,
    }
  } catch (e: any) {
    return {
      likelyInfraIssue: true,
      detail: `Dokploy auth/session probe failed: ${e?.message || 'unknown error'}.`,
    }
  }
}

const dokployFetch = async (endpoint: string, options: RequestInit = {}) => {
  const url = `${DOKPLOY_URL}${endpoint}`
  const key = await getBootstrapKey()
  if (!key) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'RelayKit is not configured. Run the install/setup script (see README).',
    })
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'x-api-key': key,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const text = await response.text()

  if (!response.ok) {
    console.error(`Dokploy API error on ${endpoint}:`, {
      status: response.status,
      statusText: response.statusText,
      body: text.substring(0, 500)
    })
    if (response.status === 401) {
      const diag = await diagnoseDokployAuthFailure()
      if (diag.likelyInfraIssue) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message:
            `Dokploy rejected the API key, but Dokploy auth appears unhealthy right now (${diag.detail}) ` +
            `This often indicates Dokploy internal DB connectivity issues, not just an invalid key.`,
        })
      }
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Dokploy API key was rejected (401). Key may be invalid/revoked. Update the bootstrap key (see README).',
      })
    }
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Dokploy API error (${response.status}): ${text.substring(0, 200)}`,
    })
  }

  try {
    return JSON.parse(text)
  } catch (e) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Invalid JSON from Dokploy: ${text.substring(0, 100)}`,
    })
  }
}

const toFiniteNumber = (value: unknown): number => {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

const estimateSampleIntervalMs = (history: { ts: number }[]): number => {
  if (history.length < 2) return 5000
  let totalDelta = 0
  let count = 0
  for (let i = 1; i < history.length; i += 1) {
    const delta = history[i].ts - history[i - 1].ts
    if (delta > 0) {
      totalDelta += delta
      count += 1
    }
  }
  if (count === 0) return 5000
  return Math.max(1000, Math.round(totalDelta / count))
}

const serviceInsightsHistory = new Map<string, ServiceInsightsResponse['history']>()

const decodeDockerLogPayload = (body: Buffer): string => {
  if (body.length < 8) return body.toString('utf8')
  const streamType = body[0]
  const isFramedHeader = streamType >= 1 && streamType <= 3 && body[1] === 0 && body[2] === 0 && body[3] === 0
  if (!isFramedHeader) return body.toString('utf8')

  let offset = 0
  let out = ''
  while (offset + 8 <= body.length) {
    const nextStreamType = body[offset]
    if (nextStreamType < 1 || nextStreamType > 3) {
      return body.toString('utf8')
    }
    if (body[offset + 1] !== 0 || body[offset + 2] !== 0 || body[offset + 3] !== 0) {
      return body.toString('utf8')
    }
    const frameLen = body.readUInt32BE(offset + 4)
    const frameStart = offset + 8
    const frameEnd = frameStart + frameLen
    if (frameEnd > body.length) {
      return body.toString('utf8')
    }
    out += body.slice(frameStart, frameEnd).toString('utf8')
    offset = frameEnd
  }
  return out
}

const toOneDecimal = (n: number): number => Math.round(n * 10) / 10

const getCpuPctFromStats = (stats: any): number => {
  const cpuTotal = toFiniteNumber(stats?.cpu_stats?.cpu_usage?.total_usage)
  const preCpuTotal = toFiniteNumber(stats?.precpu_stats?.cpu_usage?.total_usage)
  const systemTotal = toFiniteNumber(stats?.cpu_stats?.system_cpu_usage)
  const preSystemTotal = toFiniteNumber(stats?.precpu_stats?.system_cpu_usage)
  const onlineCpus =
    toFiniteNumber(stats?.cpu_stats?.online_cpus) ||
    toFiniteNumber(stats?.cpu_stats?.cpu_usage?.percpu_usage?.length) ||
    1

  const cpuDelta = cpuTotal - preCpuTotal
  const systemDelta = systemTotal - preSystemTotal
  if (cpuDelta <= 0 || systemDelta <= 0) return 0
  return toOneDecimal((cpuDelta / systemDelta) * onlineCpus * 100)
}

const getNetworkTotals = (stats: any): { inBytes: number; outBytes: number } => {
  const networks = stats?.networks || {}
  let inBytes = 0
  let outBytes = 0
  for (const net of Object.values(networks) as any[]) {
    inBytes += toFiniteNumber(net?.rx_bytes)
    outBytes += toFiniteNumber(net?.tx_bytes)
  }
  return { inBytes, outBytes }
}

const getBlockIoTotals = (stats: any): { readBytes: number; writeBytes: number } => {
  const entries = Array.isArray(stats?.blkio_stats?.io_service_bytes_recursive)
    ? stats.blkio_stats.io_service_bytes_recursive
    : []
  let readBytes = 0
  let writeBytes = 0
  for (const item of entries) {
    const op = String(item?.op || '').toLowerCase()
    const value = toFiniteNumber(item?.value)
    if (op === 'read') readBytes += value
    if (op === 'write') writeBytes += value
  }
  return { readBytes, writeBytes }
}

const getRunningComposeProjects = async (): Promise<Set<string> | null> => {
  try {
    await fs.access(DOCKER_SOCKET_PATH)
    const containers = await dockerSocketGetJson('/containers/json?all=0')
    if (!Array.isArray(containers)) return null
    const runningProjects = new Set<string>()
    for (const container of containers) {
      const project = String(container?.Labels?.['com.docker.compose.project'] || '').trim()
      if (project) runningProjects.add(project)
    }
    return runningProjects
  } catch {
    return null
  }
}

// appName (e.g. nostr-rs-relay-iot2ij) is stable for a compose's lifetime — it only changes on
// delete + redeploy, which allocates a new composeId anyway. Insights/logs poll every 15-30s per
// open dashboard, and resolving it costs a Dokploy HTTP round-trip per service — cache it.
const composeAppNameCache = new Map<string, { appName: string; at: number }>()
const COMPOSE_APP_NAME_TTL_MS = 10 * 60 * 1000

const loadComposeAppName = async (composeId: string): Promise<string> => {
  const cached = composeAppNameCache.get(composeId)
  if (cached && Date.now() - cached.at < COMPOSE_APP_NAME_TTL_MS) return cached.appName
  const compose = await dokployFetch(`/api/compose.one?composeId=${composeId}`)
  const appName = String(compose?.appName || '').trim()
  if (!appName) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Could not resolve runtime app name for this service.',
    })
  }
  composeAppNameCache.set(composeId, { appName, at: Date.now() })
  return appName
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Re-render a preset's docker-compose.yml for an already-deployed service so redeploys pick up compose
 * changes (image bumps, Caddy tweaks, etc.) without recreating the service. Preserves the existing
 * {{DEPLOY_SUFFIX}} (so named volumes/data are kept). Returns null if the suffix can't be recovered and
 * the compose uses volumes — in that case we skip the compose push to avoid orphaning data.
 */
const renderPresetComposeForUpdate = async (
  presetId: string,
  oldComposeFile: string | undefined,
): Promise<string | null> => {
  const template = await fs.readFile(path.join(PRESETS_DIR, presetId, 'docker-compose.yml'), 'utf-8')
  const marker = '{{DEPLOY_SUFFIX}}'
  if (!template.includes(marker)) return template

  // The marker also appears in a header comment (not attached to a name prefix), so scan every
  // "prefix_{{DEPLOY_SUFFIX}}" occurrence rather than assuming the first one is a real usage.
  let suffix: string | null = null
  for (const [, prefix] of template.matchAll(/([A-Za-z0-9_]+_)\{\{DEPLOY_SUFFIX\}\}/g)) {
    const found = oldComposeFile?.match(new RegExp(escapeRegExp(prefix) + '(\\d+)'))
    if (found) {
      suffix = found[1]
      break
    }
  }
  if (!suffix) return null
  return template.replace(/\{\{DEPLOY_SUFFIX\}\}/g, suffix)
}

// includeSize=false skips Docker's per-container disk usage computation (size=1 walks the
// filesystem layers — expensive). The overview batch polls for many services and doesn't show
// storage; the details view (one service, less often) keeps it.
const getServiceInsightsFromDokploy = async (
  composeId: string,
  includeSize = true,
): Promise<ServiceInsightsResponse> => {
  try {
    await fs.access(DOCKER_SOCKET_PATH)
  } catch {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Service insights are unavailable: Docker runtime access is not configured.',
    })
  }

  const appName = await loadComposeAppName(composeId)
  const filters = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${appName}`] }))
  const containers = await dockerSocketGetJson(`/containers/json?all=0&size=${includeSize ? 1 : 0}&filters=${filters}`)

  if (!Array.isArray(containers) || containers.length === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Service insights are unavailable: service container is not running.',
    })
  }

  const statsList = await Promise.all(
    containers.map((container: any) => dockerSocketGetJson(`/containers/${container.Id}/stats?stream=false`))
  )

  let cpuPct = 0
  let memoryUsedBytes = 0
  let memoryTotalBytes = 0
  let networkInBytes = 0
  let networkOutBytes = 0
  let blockReadBytes = 0
  let blockWriteBytes = 0
  let storageUsedBytes = 0

  for (let i = 0; i < statsList.length; i += 1) {
    const stats = statsList[i]
    const container = containers[i]
    cpuPct += getCpuPctFromStats(stats)
    const memUsed = toFiniteNumber(stats?.memory_stats?.usage)
    const memTotal = toFiniteNumber(stats?.memory_stats?.limit)
    memoryUsedBytes += memUsed
    memoryTotalBytes += memTotal
    const net = getNetworkTotals(stats)
    networkInBytes += net.inBytes
    networkOutBytes += net.outBytes
    const io = getBlockIoTotals(stats)
    blockReadBytes += io.readBytes
    blockWriteBytes += io.writeBytes
    if (includeSize) storageUsedBytes += toFiniteNumber(container?.SizeRw)
  }

  const ts = Date.now()
  const current = {
    ts,
    cpuPct: toOneDecimal(Math.max(0, cpuPct)),
    memoryUsedPct: memoryTotalBytes > 0 ? toOneDecimal((memoryUsedBytes / memoryTotalBytes) * 100) : 0,
    memoryUsedBytes: Math.max(0, Math.round(memoryUsedBytes)),
    memoryTotalBytes: Math.max(0, Math.round(memoryTotalBytes)),
    storageUsedBytes: Math.max(0, Math.round(storageUsedBytes)),
    networkInBytes: Math.max(0, Math.round(networkInBytes)),
    networkOutBytes: Math.max(0, Math.round(networkOutBytes)),
    blockReadBytes: Math.max(0, Math.round(blockReadBytes)),
    blockWriteBytes: Math.max(0, Math.round(blockWriteBytes)),
  }

  const prev = serviceInsightsHistory.get(composeId) || []
  const now = Date.now()
  const history = trimInsightPointsToWindow([...prev, current], SERVICE_INSIGHTS.historyWindowMs, now)
  serviceInsightsHistory.set(composeId, history)

  return {
    composeId,
    appName,
    sampleIntervalMs: estimateSampleIntervalMs(history),
    thresholds: SERVICE_INSIGHTS.thresholds,
    current,
    history,
  }
}

const getServiceLogsFromDocker = async (input: {
  composeId: string
  tail: number
  sinceSeconds?: number
}) => {
  try {
    await fs.access(DOCKER_SOCKET_PATH)
  } catch {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Service logs are unavailable: Docker runtime access is not configured.',
    })
  }

  const appName = await loadComposeAppName(input.composeId)
  const filters = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${appName}`] }))
  const containers = await dockerSocketGetJson(`/containers/json?all=1&size=0&filters=${filters}`)

  if (!Array.isArray(containers) || containers.length === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Service logs are unavailable: no containers found for this compose service.',
    })
  }

  const sinceUnix = input.sinceSeconds && input.sinceSeconds > 0
    ? Math.max(0, Math.floor(Date.now() / 1000) - input.sinceSeconds)
    : null

  const containerLogs = await Promise.all(
    containers.map(async (container: any) => {
      const containerId = String(container?.Id || '').trim()
      const name = String(container?.Names?.[0] || containerId).replace(/^\//, '')
      const service = String(container?.Labels?.['com.docker.compose.service'] || '').trim() || name
      const running = String(container?.State || '').trim() === 'running'
      const params = new URLSearchParams({
        stdout: '1',
        stderr: '1',
        timestamps: '1',
        tail: String(input.tail),
      })
      if (sinceUnix != null) params.set('since', String(sinceUnix))
      try {
        const body = await dockerSocketGetBuffer(`/containers/${containerId}/logs?${params.toString()}`)
        const text = decodeDockerLogPayload(body)
        const lines = text
          .split(/\r?\n/g)
          .map((line) => line.trimEnd())
          .filter(Boolean)
        return { containerId, name, service, running, lines, error: null as string | null }
      } catch (error: any) {
        return {
          containerId,
          name,
          service,
          running,
          lines: [] as string[],
          error: error?.message || 'Could not load logs for this container.',
        }
      }
    })
  )

  containerLogs.sort((a, b) => a.name.localeCompare(b.name))
  return {
    composeId: input.composeId,
    appName,
    fetchedAt: Date.now(),
    tail: input.tail,
    containers: containerLogs,
  }
}

const getRuntimeContainersFromDocker = async () => {
  try {
    await fs.access(DOCKER_SOCKET_PATH)
  } catch {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Container runtime is unavailable: Docker socket access is not configured.',
    })
  }

  const projects = await dokployFetch('/api/project.all')
  const composeByAppName = new Map<string, any>()
  const presetLabelById = new Map<string, string>()
  for (const project of projects as any[]) {
    for (const environment of project.environments || []) {
      for (const composeSummary of environment.compose || []) {
        const compose = await dokployFetch(`/api/compose.one?composeId=${composeSummary.composeId}`)
        const appName = String(compose?.appName || '').trim()
        if (!appName) continue
        const presetId = String(compose?.description || '').trim() || null
        if (presetId && !presetLabelById.has(presetId)) {
          try {
            const metadata = await getPresetMetadata(presetId)
            presetLabelById.set(presetId, metadata.label || presetId)
          } catch {
            presetLabelById.set(presetId, presetId)
          }
        }
        composeByAppName.set(appName, {
          composeId: compose.composeId,
          composeName: compose.name,
          composeStatus: String(compose.composeStatus || '').toLowerCase(),
          projectName: project.name,
          environmentName: environment.name,
          presetId,
          presetLabel: presetId ? presetLabelById.get(presetId) || presetId : null,
          domains: compose.domains || [],
        })
      }
    }
  }

  const containers = await dockerSocketGetJson('/containers/json?all=1&size=0')
  const normalized = Array.isArray(containers) ? containers : []
  const items = normalized.map((container: any) => {
    const labels = container?.Labels || {}
    const containerId = String(container?.Id || '').trim()
    const name = String(container?.Names?.[0] || containerId).replace(/^\//, '')
    const composeProject = String(labels['com.docker.compose.project'] || '').trim() || null
    const composeService = String(labels['com.docker.compose.service'] || '').trim() || null
    const compose = composeProject ? composeByAppName.get(composeProject) || null : null
    const hasComposeLabel = !!composeProject
    const isManaged = !!compose
    const isOrphan = hasComposeLabel && !compose
    // Hosts baked into this container's traefik router labels. Dokploy stamps these at deploy
    // time from the domain rows; if the rows changed since without recreating the container,
    // the old routers linger and keep retrying certs for hosts nobody owns ("ghost routers").
    const traefikHosts = Object.entries(labels as Record<string, string>)
      .filter(([key]) => /^traefik\.http\.routers\.[^.]+\.rule$/.test(key))
      .flatMap(([, rule]) => Array.from(String(rule).matchAll(/Host\(`([^`]+)`\)/g), (m) => m[1].toLowerCase()))
    const currentDomainHosts = new Set(
      ((compose?.domains || []) as { host: string }[]).map((d) => String(d.host || '').toLowerCase()),
    )
    const staleRoutingHosts = isManaged ? traefikHosts.filter((h) => !currentDomainHosts.has(h)) : []
    const mounts = Array.isArray(container?.Mounts)
      ? container.Mounts.map((mount: any) => ({
          type: String(mount?.Type || '').toLowerCase(),
          name: String(mount?.Name || '').trim() || null,
          source: String(mount?.Source || '').trim() || null,
          destination: String(mount?.Destination || '').trim() || null,
        }))
      : []
    return {
      containerId,
      name,
      image: String(container?.Image || '').trim(),
      state: String(container?.State || '').trim().toLowerCase(),
      status: String(container?.Status || '').trim(),
      created: toFiniteNumber(container?.Created),
      composeProject,
      composeService,
      hasComposeLabel,
      isManaged,
      isOrphan,
      composeId: compose?.composeId || null,
      composeName: compose?.composeName || null,
      composeStatus: compose?.composeStatus || null,
      projectName: compose?.projectName || null,
      environmentName: compose?.environmentName || null,
      presetId: compose?.presetId || null,
      presetLabel: compose?.presetLabel || null,
      domainHost: compose?.domains?.[0]?.host || null,
      traefikHosts,
      staleRoutingHosts,
      mounts,
    }
  })

  items.sort((a, b) => {
    if (a.isOrphan !== b.isOrphan) return a.isOrphan ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const volumeMap = new Map<string, {
    id: string
    type: string
    source: string | null
    destinationSet: Set<string>
    containerNames: Set<string>
    composeNames: Set<string>
    composeIds: Set<string>
  }>()
  for (const item of items) {
    for (const mount of item.mounts || []) {
      const mountId = mount.name || mount.source
      if (!mountId) continue
      const existing = volumeMap.get(mountId)
      if (existing) {
        if (mount.destination) existing.destinationSet.add(mount.destination)
        existing.containerNames.add(item.name)
        if (item.composeName) existing.composeNames.add(item.composeName)
        if (item.composeId) existing.composeIds.add(item.composeId)
        continue
      }
      volumeMap.set(mountId, {
        id: mountId,
        type: mount.type || 'unknown',
        source: mount.source,
        destinationSet: new Set(mount.destination ? [mount.destination] : []),
        containerNames: new Set([item.name]),
        composeNames: new Set(item.composeName ? [item.composeName] : []),
        composeIds: new Set(item.composeId ? [item.composeId] : []),
      })
    }
  }
  const volumes = Array.from(volumeMap.values())
    .map((v) => ({
      id: v.id,
      type: v.type,
      source: v.source,
      destinations: Array.from(v.destinationSet).sort(),
      containerNames: Array.from(v.containerNames).sort(),
      composeNames: Array.from(v.composeNames).sort(),
      composeIds: Array.from(v.composeIds).sort(),
      attachedContainers: v.containerNames.size,
      attachedServices: v.composeIds.size,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  return {
    fetchedAt: Date.now(),
    containers: items,
    volumes,
    summary: {
      total: items.length,
      managed: items.filter((c) => c.isManaged).length,
      orphaned: items.filter((c) => c.isOrphan).length,
      running: items.filter((c) => c.state === 'running').length,
      volumes: volumes.length,
      ghostRouters: items.reduce((n, c) => n + c.staleRoutingHosts.length, 0),
    },
  }
}

// Cloudflare publishes their IP ranges at cloudflare.com/ips-v4 — used to detect proxied domains
const CF_RANGES_V4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15',
  '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
]
const ipToInt = (ip: string) => ip.split('.').reduce((acc, oct) => (acc << 8) | parseInt(oct), 0) >>> 0
const inCidr = (ip: string, cidr: string) => {
  const [base, bits] = cidr.split('/')
  const mask = ~((1 << (32 - parseInt(bits))) - 1) >>> 0
  return (ipToInt(ip) & mask) === (ipToInt(base) & mask)
}
const isCloudflareIp = (ip: string) => CF_RANGES_V4.some((r) => inCidr(ip, r))

const resolveHostIps = async (host: string): Promise<string[]> => {
  const resolve4 = async (servers: string[]) => {
    const r = new dns.Resolver()
    r.setServers(servers)
    return r.resolve4(host)
  }
  try {
    // Quad9: non-profit, Swiss-based, no logging or data selling
    return await resolve4(['9.9.9.9', '149.112.112.112'])
  } catch {
    try {
      // hdns.io: public Handshake (HNS) resolver — handles decentralized TLDs unknown to ICANN
      return await resolve4(['103.196.38.38'])
    } catch {
      // Fall back to system resolver so /etc/hosts entries work in dev
      const addrs = await dns.lookup(host, { family: 4, all: true })
      return addrs.map((a) => a.address)
    }
  }
}

export const appRouter = router({
  listPresets: publicProcedure
    .input(z.void())
    .query(async () => {
    const presets = []
    try {
      for (const dir of await fs.readdir(PRESETS_DIR)) {
        try {
          presets.push(await getPresetMetadata(dir))
        } catch {
          // Skip dirs without valid metadata.json
        }
      }
    } catch (error) {
      console.error('Error reading presets:', error)
    }
    // Instance host rides along so the deploy modal can suggest <subdomain>.<host> without another query.
    return { presets, instanceHost: process.env.RELAYKIT_HOST?.trim() || null }
  }),

  listProjects: protectedProcedure
    .input(z.void())
    .query(async () => {
      const projects = await dokployFetch('/api/project.all')
      return (projects as any[])
        .map((p) => ({
          projectId: p.projectId,
          name: p.name,
          description: p.description ?? '',
          createdAt: p.createdAt ?? null,
          environments: (p.environments || [])
            .map((e: any) => ({
              environmentId: e.environmentId,
              name: e.name,
              createdAt: e.createdAt ?? null,
            }))
            .sort((a: any, b: any) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()),
        }))
        .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
    }),

  createProject: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const created = await dokployFetch('/api/project.create', {
        method: 'POST',
        body: JSON.stringify({ name: input.name, description: '' }),
      })
      return {
        projectId: created.project.projectId,
        environmentId: created.environment.environmentId,
      }
    }),

  createEnvironment: protectedProcedure
    .input(z.object({ projectId: z.string(), name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const created = await dokployFetch('/api/environment.create', {
        method: 'POST',
        body: JSON.stringify({ projectId: input.projectId, name: input.name }),
      })
      return { environmentId: created.environmentId }
    }),

  renameProject: protectedProcedure
    .input(z.object({ projectId: z.string(), name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await dokployFetch('/api/project.update', {
        method: 'POST',
        body: JSON.stringify({ projectId: input.projectId, name: input.name }),
      })
      return { success: true }
    }),

  renameEnvironment: protectedProcedure
    .input(z.object({ environmentId: z.string(), name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await dokployFetch('/api/environment.update', {
        method: 'POST',
        body: JSON.stringify({ environmentId: input.environmentId, name: input.name }),
      })
      return { success: true }
    }),

  deleteProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ input }) => {
      await dokployFetch('/api/project.remove', {
        method: 'POST',
        body: JSON.stringify({ projectId: input.projectId }),
      })
      return { success: true }
    }),

  deleteEnvironment: protectedProcedure
    .input(z.object({ environmentId: z.string() }))
    .mutation(async ({ input }) => {
      await dokployFetch('/api/environment.remove', {
        method: 'POST',
        body: JSON.stringify({ environmentId: input.environmentId }),
      })
      return { success: true }
    }),

  moveService: protectedProcedure
    .input(z.object({ composeId: z.string(), targetEnvironmentId: z.string() }))
    .mutation(async ({ input }) => {
      await dokployFetch('/api/compose.move', {
        method: 'POST',
        body: JSON.stringify({ composeId: input.composeId, targetEnvironmentId: input.targetEnvironmentId }),
      })
      return { success: true }
    }),

  listServices: protectedProcedure
    .input(z.void())
    .query(async ({ ctx }) => {
    const projects = await dokployFetch('/api/project.all')
    const runningProjects = await getRunningComposeProjects()
    const services = []
    for (const project of projects) {
      for (const environment of project.environments || []) {
        for (const composeSummary of environment.compose || []) {
          // Dokploy 0.30+ project.all returns only id/name/status; the full row (description,
          // appName, domains) comes from compose.one.
          const compose = await dokployFetch(`/api/compose.one?composeId=${composeSummary.composeId}`)
          const presetId = compose.description
          if (!presetId) throw new Error(`Service ${compose.name} has no preset ID`)
          let presetData: PresetMetadata
          try {
            presetData = await getPresetMetadata(presetId)
          } catch (error: any) {
            const brokenReason = `Missing preset metadata for "${presetId}": ${error?.message || 'unknown'}`
            console.warn(`Marking compose ${compose.composeId} (${compose.name}) as broken: ${brokenReason}`)
            services.push({
              composeId: compose.composeId,
              name: compose.name,
              presetId,
              serviceType: `misconfigured (${presetId})`,
              status: 'error',
              createdAt: compose.createdAt,
              hostname: compose.domains?.[0]?.host || 'No hostname configured',
              domains: compose.domains || [],
              projectId: project.projectId,
              projectName: project.name,
              environmentId: environment.environmentId,
              environmentName: environment.name,
              type: null,
              canEditConfig: false,
              whitelistedPubkeys: [],
              whitelistedKinds: [],
              blacklistedKinds: [],
              requireNip42: false,
              repo: undefined,
              icon: '⚠',
              brokenPreset: true,
              brokenPresetReason: brokenReason,
            })
            continue
          }
          if (!presetData.label) throw new Error(`Preset ${presetId} has no label`)
          const envVars = parseServiceEnvVarsString(compose.env)
          
          let runtimeStatus = compose.composeStatus === 'done' ? 'running' : compose.composeStatus
          if (compose.composeStatus === 'done' && runningProjects) {
            const appName = String(compose.appName || '').trim()
            if (appName) {
              runtimeStatus = runningProjects.has(appName) ? 'running' : 'stopped'
            }
          }
          
          const domainKey = presetData.domainConfigKey ?? 'RELAY_HOST'
          const hostname =
            isNpanelType(presetData.id)
              ? envVars.NSITE_ROUTER_HOST || envVars.NSITE_DOMAIN || envVars[domainKey]
              : envVars[domainKey]
          const composeDomains = (compose.domains || []) as { domainId: string; host: string }[]
          // Pairs each dokploy domain record with the preset field (and its target container) it belongs to,
          // so the per-domain editor can re-register it against the right service/port when changed.
          const domainFields = domainFieldsFor(presetData, envVars)
            .map((field) => ({ ...field, domainId: composeDomains.find((d) => d.host === field.host)?.domainId }))
            .filter((field) => !!field.domainId)
          services.push({
            composeId: compose.composeId,
            name: compose.name,
            presetId: presetData.id,
            serviceType: presetData.label,
            status: String(runtimeStatus).toLowerCase(),
            createdAt: compose.createdAt,
            hostname: hostname || 'No hostname configured',
            domains: compose.domains || [],
            domainFields,
            projectId: project.projectId,
            projectName: project.name,
            environmentId: environment.environmentId,
            environmentName: environment.name,
            type: presetData.type ?? null,
            canEditConfig: getEditablePresetFields(presetData).length > 0,
            whitelistedPubkeys: parseCsvList(envVars.WHITELISTED_PUBKEYS),
            whitelistedKinds: parseCsvList(envVars.WHITELISTED_KINDS),
            blacklistedKinds: parseCsvList(envVars.BLACKLISTED_KINDS),
            requireNip42: (envVars.REQUIRE_NIP42 || '').toLowerCase() === 'true',
            nsiteSiteNpub: envVars.NSITE_SITE_NPUB || undefined,
            nsiteRelays: envVars.NOSTR_RELAYS || undefined,
            nsiteParentDomain: envVars.NSITE_PARENT_DOMAIN || undefined,
            nsiteSiteD: envVars.NSITE_SITE_D || undefined,
            nsiteVisitorHost: envVars.NSITE_VISITOR_HOST || undefined,
            nsiteCanonicalHost: envVars.NSITE_DOMAIN || undefined,
            nsiteManifestEventId: envVars.NSITE_MANIFEST_EVENT_ID || undefined,
            repo: presetData.repo,
            icon: presetData.icon,
          })
        }
      }
    }
    services.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    return services
  }),

  // Delete a service
  deleteService: protectedProcedure
    .input(z.object({
      composeId: z.string()
    }))
    .mutation(async ({ input, ctx }) => {
      await dokployFetch('/api/compose.delete', {
        method: 'POST',
        body: JSON.stringify({
          composeId: input.composeId
        })
      })
      
      return {
        success: true,
        message: 'Service deleted successfully'
      }
    }),

  // Stop a service
  stopService: protectedProcedure
    .input(z.object({
      composeId: z.string()
    }))
    .mutation(async ({ input, ctx }) => {
      await dokployFetch('/api/compose.stop', {
        method: 'POST',
        body: JSON.stringify({
          composeId: input.composeId
        })
      })
      
      return {
        success: true,
        message: 'Service stopped'
      }
    }),

  // Start a service
  startService: protectedProcedure
    .input(z.object({
      composeId: z.string()
    }))
    .mutation(async ({ input, ctx }) => {
      await dokployFetch('/api/compose.start', {
        method: 'POST',
        body: JSON.stringify({
          composeId: input.composeId
        })
      })
      
      return {
        success: true,
        message: 'Service started'
      }
    }),

  updateServiceDomain: protectedProcedure
    .input(z.object({
      composeId: z.string(),
      domainId: z.string(),
      newHost: z.string()
    }))
    .mutation(async ({ input }) => {
      const compose = await dokployFetch(`/api/compose.one?composeId=${input.composeId}`)
      const presetData = await getPresetMetadata(compose.description)

      // For npanel the editable domain IS the public visitor host. Persist it into env so
      // a later config save doesn't recompute the router host back to the long NIP-5A host.
      // Domain reconciliation (delete old / add canonical) is handled by syncServiceDomains.
      if (isNpanelType(presetData.id)) {
        let envVars = parseServiceEnvVarsString(compose.env)
        envVars.NSITE_VISITOR_HOST = normalizeVisitorHost(input.newHost)
        if ((envVars.NSITE_PARENT_DOMAIN ?? '').trim()) envVars = applyNsiteHostnameToEnv(envVars)
        envVars = finalizeNsiteRouterEnv(envVars)
        await dokployFetch('/api/compose.update', {
          method: 'POST',
          body: JSON.stringify({ composeId: input.composeId, env: stringifyEnvVars(envVars), sourceType: 'raw' }),
        })
        await syncServiceDomains(input.composeId, presetData, envVars, compose.domains ?? [])
        await dokployFetch('/api/compose.redeploy', {
          method: 'POST',
          body: JSON.stringify({ composeId: input.composeId }),
        })
        return { success: true, message: 'Domain updated and service redeployed' }
      }

      // Match the domain being edited to its preset field (primary, or an extra like pulse's
      // ntfy sidecar) so it's re-registered against the right container/port, and so the env
      // var the container reads stays in sync with the new host.
      const envVars = parseServiceEnvVarsString(compose.env)
      const oldHost = ((compose.domains || []) as { domainId: string; host: string }[]).find(
        (d) => d.domainId === input.domainId,
      )?.host
      const field = domainFieldsFor(presetData, envVars).find((f) => f.host === oldHost) ?? {
        configKey: presetData.domainConfigKey ?? 'RELAY_HOST',
        internalPort: presetData.internalPort,
        serviceName: presetData.serviceName,
      }

      const hostUnchanged = oldHost === input.newHost
      if (!hostUnchanged) {
        envVars[field.configKey] = input.newHost
        await dokployFetch('/api/compose.update', {
          method: 'POST',
          body: JSON.stringify({ composeId: input.composeId, env: stringifyEnvVars(envVars), sourceType: 'raw' }),
        })
        await dokployFetch('/api/domain.delete', {
          method: 'POST',
          body: JSON.stringify({ domainId: input.domainId })
        })
        await registerDomain(input.composeId, input.newHost, field)
        await dokployFetch('/api/compose.redeploy', {
          method: 'POST',
          body: JSON.stringify({ composeId: input.composeId })
        })
      }
      // Same-host edit = "retry TLS": reconcile the row, then restart Traefik so it re-attempts
      // ACME (it doesn't retry failed domains on its own). The dashboard itself is routed
      // through Traefik, so the restart must not race this response out — delay it instead.
      // A changed host doesn't need it: Dokploy's domain write hot-reloads Traefik config,
      // and the new router requests its cert on load.
      if (hostUnchanged) {
        await syncServiceDomains(input.composeId, presetData, envVars, compose.domains ?? [])
        setTimeout(() => {
          reloadDokployTraefik().catch((err) => console.error('traefik restart failed:', err))
        }, 2000)
      }
      return {
        success: true,
        message: hostUnchanged ? 'Retrying TLS certificate' : 'Domain updated and service redeployed',
      }
    }),

  // Refresh nsite content without touching env/domains. The gateway holds fetched Nostr events
  // (incl. the site manifest) in an in-memory store for the process lifetime, so republished
  // content only appears after the gateway process restarts. Restart just that container.
  refreshNpanelGateway: protectedProcedure
    .input(z.object({ composeId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        await fs.access(DOCKER_SOCKET_PATH)
      } catch {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Container runtime is unavailable: Docker socket access is not configured.',
        })
      }

      const appName = await loadComposeAppName(input.composeId)
      const filters = encodeURIComponent(
        JSON.stringify({
          label: [`com.docker.compose.project=${appName}`, 'com.docker.compose.service=nsite-gateway'],
        }),
      )
      const containers = await dockerSocketGetJson(`/containers/json?all=1&size=0&filters=${filters}`)
      const normalized = Array.isArray(containers) ? containers : []
      let restarted = 0
      for (const container of normalized) {
        const id = String(container?.Id || '').trim()
        if (!id) continue
        await dockerSocketMutate(`/containers/${id}/restart`, 'POST')
        restarted++
      }
      if (restarted === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No running nsite-gateway container found for this service.' })
      }
      return { success: true, restarted }
    }),

  getServiceConfig: protectedProcedure
    .input(z.object({ composeId: z.string() }))
    .query(async ({ input }) => {
      const compose = await dokployFetch(`/api/compose.one?composeId=${input.composeId}`)
      const preset = await getPresetMetadata(compose.description)
      const envVars = parseServiceEnvVarsString(compose.env)
      const editableFields = getEditablePresetFields(preset)
      const config: Record<string, string> = {}
      for (const field of editableFields) {
        config[field.id] = envVars[field.id] ?? field.default ?? ''
      }
      return {
        composeId: input.composeId,
        presetId: preset.id,
        fields: editableFields,
        config,
      }
    }),

  updateServiceConfig: protectedProcedure
    .input(
      z.object({
        composeId: z.string(),
        config: z.record(z.string(), z.union([z.string(), z.boolean()])),
      })
    )
    .mutation(async ({ input }) => {
      const compose = await dokployFetch(`/api/compose.one?composeId=${input.composeId}`)
      const preset = await getPresetMetadata(compose.description)
      const editableFields = getEditablePresetFields(preset)
      const editableById = Object.fromEntries(editableFields.map((f) => [f.id, f] as const))
      let envVars = parseServiceEnvVarsString(compose.env)

      for (const [key, rawValue] of Object.entries(input.config)) {
        const field = editableById[key]
        if (!field) continue
        envVars[key] = coerceConfigValueToString(field, rawValue)
      }

      if (isNpanelType(preset.id)) {
        if ((envVars.NSITE_PARENT_DOMAIN ?? '').trim()) {
          envVars = applyNsiteHostnameToEnv(envVars)
        }
        envVars = finalizeNsiteRouterEnv(envVars)
        envVars[NPANEL_NIP05_USERS_ENV_KEY] = normalizeNpanelNip05UsersEnv(envVars[NPANEL_NIP05_USERS_ENV_KEY] ?? '')
      }
      await syncServiceDomains(input.composeId, preset, envVars, compose.domains ?? [])

      const env = stringifyEnvVars(envVars)
      // Re-push the current preset compose so redeploys pick up compose fixes (image/caddy changes) without
      // recreating the service. Skips if the deploy suffix can't be recovered (avoids orphaning data volumes).
      const composeFile = await renderPresetComposeForUpdate(preset.id, compose.composeFile)
      await dokployFetch('/api/compose.update', {
        method: 'POST',
        body: JSON.stringify({
          composeId: input.composeId,
          env,
          sourceType: 'raw',
          ...(composeFile ? { composeFile } : {}),
        }),
      })
      await dokployFetch('/api/compose.redeploy', {
        method: 'POST',
        body: JSON.stringify({ composeId: input.composeId }),
      })

      return { success: true, message: 'Service config updated and redeployed' }
    }),

  // Check Dokploy connection (safe: never throws, always returns JSON)
  checkDokploy: publicProcedure
    .input(z.void())
    .query(async () => {
      try {
        const hasApiKey = !!(await getBootstrapKey())
        await fetch(`${DOKPLOY_URL}/`)
        return { reachable: true, url: DOKPLOY_URL, hasApiKey }
      } catch (e: any) {
        let hasApiKey = false
        try { hasApiKey = !!(await getBootstrapKey()) } catch { /* ignore */ }
        return {
          reachable: false,
          hasApiKey,
          url: DOKPLOY_URL,
          error: e?.message || 'Unknown error',
        }
      }
    }),

  // Save Dokploy API key
  saveApiKey: publicProcedure
    .input(z.object({
      apiKey: z.string()
    }))
    .mutation(async ({ input }) => {
      // Validate API key by calling Dokploy API
      try {
        const response = await fetch(`${DOKPLOY_URL}/api/project.all`, {
          headers: {
            'x-api-key': input.apiKey,
          },
        })

        if (!response.ok) {
          throw new Error('Invalid API key')
        }

        await setBootstrapKey(input.apiKey)
        
        return {
          success: true,
          message: 'API key saved successfully!',
        }
      } catch (error: any) {
        throw new Error(`Failed to save API key: ${error.message}`)
      }
    }),

  getServerIp: protectedProcedure
    .input(z.void())
    .query(async ({ ctx }) => {
      const host = ctx.host?.trim()
      if (!host) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not get server IP (no Host header).' })
      const isV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
      if (isV4) return { ip: host }
      // Quad9: non-profit, Swiss-based, no logging or data selling
      const resolver = new dns.Resolver()
      resolver.setServers(['9.9.9.9', '149.112.112.112'])
      const addrs = await resolver.resolve4(host)
      const ip = addrs?.[0]
      if (!ip) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not resolve server IP.' })
      return { ip }
    }),

  getServerInsights: protectedProcedure
    .input(z.void())
    .query(async () => serverInsightsCollector.getServerInsights()),

  getServiceInsights: protectedProcedure
    .input(z.object({ composeId: z.string().min(1) }))
    .query(async ({ input }) => getServiceInsightsFromDokploy(input.composeId)),

  getServiceLogs: protectedProcedure
    .input(
      z.object({
        composeId: z.string().min(1),
        tail: z.number().int().min(20).max(1000).optional(),
        sinceSeconds: z.number().int().min(0).max(86400).optional(),
      })
    )
    .query(async ({ input }) =>
      getServiceLogsFromDocker({
        composeId: input.composeId,
        tail: input.tail ?? 200,
        sinceSeconds: input.sinceSeconds,
      })
    ),

  getRuntimeContainers: protectedProcedure
    .input(z.void())
    .query(async () => getRuntimeContainersFromDocker()),

  killRuntimeContainer: protectedProcedure
    .input(
      z.object({
        containerId: z.string().min(8),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await fs.access(DOCKER_SOCKET_PATH)
      } catch {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Container runtime is unavailable: Docker socket access is not configured.',
        })
      }
      await dockerSocketMutate(`/containers/${input.containerId}?force=1&v=1`, 'DELETE')
      return { success: true, containerId: input.containerId }
    }),

  hardResetServiceRuntime: protectedProcedure
    .input(
      z.object({
        composeId: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await fs.access(DOCKER_SOCKET_PATH)
      } catch {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Container runtime is unavailable: Docker socket access is not configured.',
        })
      }

      const appName = await loadComposeAppName(input.composeId)
      const filters = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${appName}`] }))
      const containers = await dockerSocketGetJson(`/containers/json?all=1&size=0&filters=${filters}`)
      const normalized = Array.isArray(containers) ? containers : []
      const removed: string[] = []

      for (const container of normalized) {
        const id = String(container?.Id || '').trim()
        if (!id) continue
        await dockerSocketMutate(`/containers/${id}?force=1&v=1`, 'DELETE')
        removed.push(id)
      }

      await dokployFetch('/api/compose.redeploy', {
        method: 'POST',
        body: JSON.stringify({ composeId: input.composeId }),
      })

      return {
        success: true,
        composeId: input.composeId,
        appName,
        removedContainerCount: removed.length,
      }
    }),

  getServicesInsights: protectedProcedure
    .input(z.object({ composeIds: z.array(z.string().min(1)).min(1).max(200) }))
    .query(async ({ input }) => {
      const out: Record<string, ServiceInsightsResponse | null> = {}
      await Promise.all(
        input.composeIds.map(async (composeId) => {
          try {
            out[composeId] = await getServiceInsightsFromDokploy(composeId, false)
          } catch {
            out[composeId] = null
          }
        })
      )
      return out
    }),

  testDnsRecord: protectedProcedure
    .input(z.object({ host: z.string().min(1), expectedIp: z.string().min(1) }))
    .query(async ({ input }) => {
      try {
        const ips = await resolveHostIps(input.host)
        if (ips.includes(input.expectedIp)) return { ok: true, ips }
        if (ips.length > 0 && ips.every(isCloudflareIp)) return { ok: false, proxied: 'cloudflare' as const, ips }
        return { ok: false, ips }
      } catch (e: any) {
        return { ok: false, error: e?.message }
      }
    }),

  // Resolve every domain host across all services and flag ones that can never route/issue:
  // unresolvable (NXDOMAIN / no record) or dotless. DNS points somewhere but Cloudflare-proxied
  // hosts are fine for routing but break HTTP-01 issuance — flagged separately.
  checkRoutingHealth: protectedProcedure
    .input(z.void())
    .query(async () => {
      const projects = (await dokployFetch('/api/project.all')) as any[]
      const servicesByHost = new Map<string, string[]>()
      for (const project of projects) {
        for (const environment of project.environments || []) {
          for (const composeSummary of environment.compose || []) {
            const compose = await dokployFetch(`/api/compose.one?composeId=${composeSummary.composeId}`)
            for (const dom of (compose.domains || []) as { host: string }[]) {
              const host = String(dom.host || '').toLowerCase().trim()
              if (!host) continue
              const list = servicesByHost.get(host) || []
              list.push(String(compose.name || composeSummary.name || compose.composeId))
              servicesByHost.set(host, list)
            }
          }
        }
      }

      const hosts = await Promise.all(
        Array.from(servicesByHost.keys()).map(async (host) => {
          const dotless = !host.includes('.')
          let ips: string[] = []
          try {
            ips = dotless ? [] : await resolveHostIps(host)
          } catch {
            ips = []
          }
          const cloudflareProxied = ips.length > 0 && ips.every(isCloudflareIp)
          return {
            host,
            services: servicesByHost.get(host) || [],
            dotless,
            resolvable: ips.length > 0,
            cloudflareProxied,
            ips,
          }
        })
      )
      return {
        checkedAt: Date.now(),
        hosts,
        unhealthy: hosts.filter((h) => h.dotless || !h.resolvable || h.cloudflareProxied),
      }
    }),

  getRelaykitVersion: protectedProcedure
    .query(async () => {
      const [version, imageRef] = await Promise.all([readRelaykitVersion(), getOwnImageRef()])
      return { ...version, imageRef }
    }),

  checkRelaykitUpdate: protectedProcedure
    .query(async () => {
      const current = await readRelaykitVersion()
      const channel = await readUpdateChannel()
      const imageRef = await getOwnImageRef()
      let latest: RemoteVersion | null = null
      let error: string | null = null
      const updateCheckSupported = isRegistryRef(imageRef)
      if (updateCheckSupported && imageRef) {
        try {
          latest = await fetchRemoteImageVersion(imageRef, channel)
        } catch (e: unknown) {
          error = e instanceof Error ? e.message : 'failed to reach image registry'
        }
      }
      return {
        current,
        channel,
        channels: RELAYKIT_UPDATE_CHANNELS,
        imageRef,
        latest,
        updateAvailable: !!latest && compareVersions(latest.version, current.version) > 0,
        updateCheckSupported,
        changelog: await readChangelog(),
        error,
      }
    }),

  setUpdateChannel: protectedProcedure
    .input(z.object({ channel: z.enum(RELAYKIT_UPDATE_CHANNELS) }))
    .mutation(async ({ input }) => {
      await writeUpdateChannel(input.channel as RelaykitUpdateChannel)
      return { success: true, channel: input.channel }
    }),

  /**
   * Update the whole relaykit stack (relaykit + pinned dokploy/traefik/postgres/redis) to the
   * release-channel image. Responds before the stack is recreated: this container is replaced
   * mid-update by the detached helper, so the UI must expect a connection drop after success.
   */
  updateRelaykit: protectedProcedure
    .mutation(async () => {
      const channel = await readUpdateChannel()
      const { imageRef } = await startSelfUpdate(os.hostname(), channel)
      return {
        success: true,
        imageRef,
        message: 'Update started. RelayKit is restarting; the dashboard will reconnect automatically.',
      }
    }),



  deployService: protectedProcedure
    .input(z.object({
      presetId: z.string(),
      config: z.record(z.string(), z.string()),
      environmentId: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const presetDir = path.join(PRESETS_DIR, input.presetId)
        const composeContent = await fs.readFile(path.join(presetDir, 'docker-compose.yml'), 'utf-8')
        let configForDeploy = { ...input.config }
        if (isNpanelType(input.presetId)) {
          if (!(configForDeploy.NSITE_PARENT_DOMAIN ?? '').trim()) {
            throw new Error('Site domain is required (the suffix after the site label, e.g. relayk.it).')
          }
          configForDeploy = applyNsiteHostnameToEnv(configForDeploy)
          configForDeploy = finalizeNsiteRouterEnv(configForDeploy)
          configForDeploy[NPANEL_NIP05_USERS_ENV_KEY] = normalizeNpanelNip05UsersEnv(
            configForDeploy[NPANEL_NIP05_USERS_ENV_KEY] ?? '',
          )
        }
        const envString = stringifyEnvVars(configForDeploy)
        const environmentId = input.environmentId ?? (await ensureADefaultProjectExistsForServices()).environmentId

        const uniqueSuffix = Date.now()
        const composeName = `${input.presetId}-${uniqueSuffix}`
        const composeFile = composeContent.replace(/\{\{DEPLOY_SUFFIX\}\}/g, String(uniqueSuffix))

        const createCompose = await dokployFetch('/api/compose.create', {
          method: 'POST',
          body: JSON.stringify({
            name: composeName,
            description: input.presetId,
            appName: input.presetId,
            composeType: 'docker-compose',
            sourceType: 'raw',
            composeFile,
            env: envString,
            environmentId
          })
        })
        await dokployFetch('/api/compose.update', {
          method: 'POST',
          body: JSON.stringify({ composeId: createCompose.composeId, env: envString, sourceType: 'raw' })
        })

        // Register routing + TLS for every configured public host (router host in multi-site
        // mode, visitor host in vanity mode; the canonical host is internal addressing — Caddy
        // rewrites the Host container-to-container — so it's never registered). A fresh
        // compose has no rows yet, so this just creates them.
        const presetData = await getPresetMetadata(input.presetId)
        await syncServiceDomains(createCompose.composeId, presetData, configForDeploy, [])

        await dokployFetch('/api/compose.deploy', {
          method: 'POST',
          body: JSON.stringify({ composeId: createCompose.composeId })
        })

        return {
          success: true,
          composeId: createCompose.composeId,
          message: 'Service deployment started (may take a moment to become fully running)'
        }
      } catch (error: any) {
        throw new Error(`Failed to deploy service: ${error.message}`)
      }
    }),
})

export type AppRouter = typeof appRouter

