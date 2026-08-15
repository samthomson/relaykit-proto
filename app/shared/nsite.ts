import { nip19, SimplePool } from 'nostr-tools'

type NostrEvent = {
  kind: number
  tags: string[][]
  content: string
  created_at: number
  pubkey: string
  id: string
  sig: string
}

// ── Pubkey parsing ──────────────────────────────────────────────────

export const parsePubkeyHex = (npubOrHex: string): string | null => {
  const t = npubOrHex.trim()
  if (/^[0-9a-f]{64}$/i.test(t)) return t.toLowerCase()
  if (t.startsWith('npub1')) {
    try {
      const d = nip19.decode(t)
      return d.type === 'npub' ? d.data : null
    } catch {
      return null
    }
  }
  return null
}

export const NPANEL_NIP05_USERS_ENV_KEY = 'NPANEL_NIP05_USERS' as const

export type NpanelNip05User = {
  name: string
  pubkey: string
  npub: string
}

export const parseNpanelNip05Users = (raw: string): NpanelNip05User[] => {
  const tokens = raw
    .split(/[\n,]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
  const users: NpanelNip05User[] = []
  const seen = new Set<string>()
  for (const token of tokens) {
    const sep = token.indexOf('=')
    if (sep <= 0) throw new Error(`Invalid NIP-05 user mapping "${token}" (expected name=npub|hex).`)
    const name = token.slice(0, sep).trim().toLowerCase()
    const pubkeyRaw = token.slice(sep + 1).trim()
    if (!/^[a-z0-9_]+$/.test(name)) {
      throw new Error(`Invalid NIP-05 username "${name}" (allowed: a-z, 0-9, underscore).`)
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate NIP-05 username "${name}".`)
    }
    const pubkey = parsePubkeyHex(pubkeyRaw)
    if (!pubkey) {
      throw new Error(`Invalid pubkey for NIP-05 username "${name}" (must be npub or 64-char hex).`)
    }
    users.push({ name, pubkey, npub: pubkeyRaw })
    seen.add(name)
  }
  return users
}

export const stringifyNpanelNip05Users = (users: NpanelNip05User[]): string =>
  users.map((u) => `${u.name}=${u.npub}`).join(',')

export const normalizeNpanelNip05UsersEnv = (raw: string): string => {
  const t = raw.trim()
  if (!t) return ''
  const users = parseNpanelNip05Users(t)
  // Convert to hex format for Docker container
  return users.map((u) => `${u.name}=${u.pubkey}`).join(',')
}

// ── Base36 / NIP-5A hostname ────────────────────────────────────────

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz'

export const pubkeyHexToBase36Label = (hex: string): string => {
  const h = hex.replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('invalid pubkey hex')
  let n = BigInt(`0x${h}`)
  if (n === 0n) return '0'.repeat(50)
  let s = ''
  while (n > 0n) {
    s = B36[Number(n % 36n)] + s
    n /= 36n
  }
  if (s.length > 50) throw new Error('pubkey base36 longer than 50 chars')
  return s.padStart(50, '0')
}

export const isValidNsiteNamedD = (d: string): boolean =>
  /^[a-z0-9-]{1,13}$/.test(d) && !d.endsWith('-')

export type NsiteHostnameResult =
  | { ok: true; hostname: string }
  | { ok: false; error: string }

export const tryBuildNsitePublicHostname = (input: {
  parentDomain: string
  siteNpub: string
  siteD?: string
}): NsiteHostnameResult => {
  const hex = parsePubkeyHex(input.siteNpub)
  if (!hex) return { ok: false, error: 'Publishing key is missing or invalid.' }
  const parent = input.parentDomain.trim().toLowerCase().replace(/^\.+/, '')
  if (!parent) return { ok: false, error: 'Site domain is required.' }
  const dRaw = (input.siteD ?? '').trim()
  if (dRaw) {
    if (!isValidNsiteNamedD(dRaw)) {
      return { ok: false, error: 'Site id must be 1–13 chars [a-z0-9-] and must not end with - (NIP-5A).' }
    }
    try {
      const label = `${pubkeyHexToBase36Label(hex)}${dRaw}`
      return { ok: true, hostname: `${label}.${parent}` }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Invalid pubkey' }
    }
  }
  return { ok: true, hostname: `${nip19.npubEncode(hex)}.${parent}` }
}

export const normalizeVisitorHost = (raw: string): string => {
  const s = raw.trim().toLowerCase()
  if (!s) return ''
  const noProto = s.replace(/^https?:\/\//, '')
  return noProto.split('/')[0]?.split(':')[0]?.replace(/\.$/, '') ?? ''
}

export const previewNsiteRouterHost = (canonicalHostname: string, visitorRaw: string): string => {
  const v = normalizeVisitorHost(visitorRaw)
  return v || canonicalHostname
}

// ── Backend env helpers ─────────────────────────────────────────────

export const applyNsiteHostnameToEnv = (env: Record<string, string>): Record<string, string> => {
  const apex = (env.NSITE_PARENT_DOMAIN ?? '').trim()
  if (!apex) return env
  const built = tryBuildNsitePublicHostname({
    parentDomain: apex,
    siteNpub: env.NSITE_SITE_NPUB ?? '',
    siteD: env.NSITE_SITE_D,
  })
  if (!built.ok) throw new Error(built.error)
  return { ...env, NSITE_DOMAIN: built.hostname }
}

export const finalizeNsiteRouterEnv = (env: Record<string, string>): Record<string, string> => {
  const v = normalizeVisitorHost(env.NSITE_VISITOR_HOST ?? '')
  const base: Record<string, string> = { ...env, NSITE_VISITOR_HOST: v }
  const canon = (base.NSITE_DOMAIN ?? '').trim()
  if (!canon) return base
  return { ...base, NSITE_ROUTER_HOST: v || canon }
}

// ── Relay / Blossom defaults ────────────────────────────────────────

export const PROFILE_DISCOVERY_RELAYS = [
  'wss://purplepag.es',
  'wss://user.kindpag.es',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
] as const

export const DEFAULT_NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://nsite.run',
] as const

export const DEFAULT_LOOKUP_RELAYS = [
  'wss://purplepag.es',
  'wss://user.kindpag.es',
] as const

export const DEFAULT_BLOSSOM_SERVERS = [
  'https://nostr.download',
  'https://cdn.satellite.earth',
] as const

export const NSITE_RELAY_ENV_KEYS = ['NOSTR_RELAYS', 'LOOKUP_RELAYS', 'BLOSSOM_SERVERS'] as const

const toCsv = (arr: readonly string[]): string => arr.join(',')

export const getNsiteDefaultRelayEnv = (): Record<(typeof NSITE_RELAY_ENV_KEYS)[number], string> => ({
  NOSTR_RELAYS: toCsv(DEFAULT_NOSTR_RELAYS),
  LOOKUP_RELAYS: toCsv(DEFAULT_LOOKUP_RELAYS),
  BLOSSOM_SERVERS: toCsv(DEFAULT_BLOSSOM_SERVERS),
})

export const mergeNsiteRelayDefaults = (config: Record<string, string>): Record<string, string> => {
  const defaults = getNsiteDefaultRelayEnv()
  const out = { ...config }
  for (const k of NSITE_RELAY_ENV_KEYS) {
    if (!out[k]?.trim()) out[k] = defaults[k]
  }
  return out
}

// ── Profile relay / blossom fetching (frontend) ─────────────────────

export type NsiteProfileFetchMeta = {
  foundKind10002: boolean
  foundKind10063: boolean
  userRelayUrlCount: number
  userBlossomUrlCount: number
}

export type NsiteProfileFetchResult = {
  env: Record<'NOSTR_RELAYS' | 'LOOKUP_RELAYS' | 'BLOSSOM_SERVERS', string>
  meta: NsiteProfileFetchMeta
}

const mergeCsvPreferUser = (userUrls: string[], fallbackCsv: string): string => {
  const fall = fallbackCsv.split(',').map((s) => s.trim()).filter(Boolean)
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of userUrls) { const x = u.trim(); if (x && !seen.has(x)) { seen.add(x); out.push(x) } }
  for (const x of fall) { if (!seen.has(x)) { seen.add(x); out.push(x) } }
  return out.join(',')
}

const parseRelayUrlsFrom10002 = (ev: NostrEvent): string[] => {
  const out: string[] = []
  for (const t of ev.tags) {
    if (t[0] === 'r' && t[1] && /^wss?:\/\//i.test(t[1])) out.push(t[1].trim())
  }
  return [...new Set(out)]
}

const parseBlossomUrlsFrom10063 = (ev: NostrEvent): string[] => {
  const out: string[] = []
  for (const t of ev.tags) {
    if (t[0] === 'server' && t[1] && /^https?:\/\//i.test(t[1])) out.push(t[1].trim().replace(/\/$/, ''))
  }
  return [...new Set(out)]
}

const pickLatest = (events: NostrEvent[]) => {
  let latest10002: NostrEvent | undefined
  let latest10063: NostrEvent | undefined
  for (const e of events) {
    if (e.kind === 10002 && (!latest10002 || e.created_at > latest10002.created_at)) latest10002 = e
    if (e.kind === 10063 && (!latest10063 || e.created_at > latest10063.created_at)) latest10063 = e
  }
  return { latest10002, latest10063 }
}

const expandRelayList = (current: string[], extras: string[], max: number): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of [...current, ...extras]) {
    const u = r.trim()
    if (!u || seen.has(u)) continue
    seen.add(u)
    out.push(u)
    if (out.length >= max) break
  }
  return out
}

export const fetchNsiteRelayEnvFromProfile = async (pubkeyHex: string): Promise<NsiteProfileFetchResult> => {
  const d = getNsiteDefaultRelayEnv()
  const pool = new SimplePool()
  const filter = { authors: [pubkeyHex], kinds: [10002, 10063], limit: 80 }
  const bootstrap: string[] = [...PROFILE_DISCOVERY_RELAYS]
  let relaysUsed: string[] = bootstrap

  try {
    let batch = await pool.querySync(bootstrap, filter)
    let { latest10002, latest10063 } = pickLatest(batch)

    const needMore = !latest10002 || !latest10063
    const fromKnown10002 = latest10002 ? parseRelayUrlsFrom10002(latest10002) : []
    const defaultWss = [...DEFAULT_NOSTR_RELAYS] as string[]

    if (needMore) {
      const expanded = expandRelayList(bootstrap, [...fromKnown10002, ...defaultWss], 20)
      if (expanded.length > bootstrap.length) {
        relaysUsed = expanded
        const batch2 = await pool.querySync(expanded, filter)
        batch = [...batch, ...batch2]
        const picked = pickLatest(batch)
        latest10002 = picked.latest10002 ?? latest10002
        latest10063 = picked.latest10063 ?? latest10063
      }
    }

    const rurls = latest10002 ? parseRelayUrlsFrom10002(latest10002) : []
    const burls = latest10063 ? parseBlossomUrlsFrom10063(latest10063) : []

    return {
      env: {
        NOSTR_RELAYS: mergeCsvPreferUser(rurls, d.NOSTR_RELAYS),
        LOOKUP_RELAYS: mergeCsvPreferUser(rurls, d.LOOKUP_RELAYS),
        BLOSSOM_SERVERS: mergeCsvPreferUser(burls, d.BLOSSOM_SERVERS),
      },
      meta: {
        foundKind10002: !!latest10002,
        foundKind10063: !!latest10063,
        userRelayUrlCount: rurls.length,
        userBlossomUrlCount: burls.length,
      },
    }
  } finally {
    pool.close(relaysUsed)
  }
}

// ── Publishing-key profile (kind 0) ─────────────────────────────────

const wssFromCsv = (csv: string): string[] =>
  csv.split(',').map((s) => s.trim()).filter((s) => /^wss?:\/\//i.test(s))

export type NpanelProfile = { name?: string; picture?: string }

export const fetchNpanelProfile = async (pubkeyHex: string, extraRelaysCsv = ''): Promise<NpanelProfile> => {
  const pool = new SimplePool()
  // Query the site's own relays first (that's where the key's kind 0 most likely lives), then public discovery relays.
  const relays = [...new Set([...wssFromCsv(extraRelaysCsv), ...PROFILE_DISCOVERY_RELAYS])]
  try {
    const evs = await pool.querySync(relays, { authors: [pubkeyHex], kinds: [0], limit: 5 })
    let latest: NostrEvent | undefined
    for (const e of evs) if (!latest || e.created_at > latest.created_at) latest = e
    if (!latest) return {}
    try {
      const meta = JSON.parse(latest.content) as Record<string, unknown>
      const name = (meta.display_name as string) || (meta.name as string) || undefined
      const picture = (meta.picture as string) || undefined
      return { name: name?.trim() || undefined, picture: picture?.trim() || undefined }
    } catch {
      return {}
    }
  } finally {
    pool.close(relays)
  }
}

// ── D-tag discovery (frontend) ──────────────────────────────────────

/** Relays used to discover kind 15128/35128 site manifests: event/manifest + discovery relays, with defaults if blank. */
export const getNsiteManifestScanRelays = (config: Record<string, string>): string[] => {
  const merged = mergeNsiteRelayDefaults(config)
  const relayCsv = `${merged.NOSTR_RELAYS},${merged.LOOKUP_RELAYS}`
  const relays = wssFromCsv(relayCsv)
  return relays.length > 0 ? [...new Set(relays.slice(0, 18))] : [...PROFILE_DISCOVERY_RELAYS]
}

/** Discover site ids: empty string = root site (kind 15128), otherwise named site d-tags (kind 35128). */
export const fetchNsiteManifestDtags = async (pubkeyHex: string, relayCsv: string): Promise<string[]> => {
  const relays = wssFromCsv(relayCsv)
  const pool = new SimplePool()
  const useRelays: string[] = relays.length > 0 ? relays.slice(0, 18) : [...PROFILE_DISCOVERY_RELAYS]
  const filter = { kinds: [15128 as const, 35128 as const], authors: [pubkeyHex], limit: 500 }
  try {
    const evs = await pool.querySync(useRelays, filter)
    const dtags = new Set<string>()
    for (const e of evs) {
      if (e.kind === 15128) {
        dtags.add('')
      } else if (e.kind === 35128) {
        for (const t of e.tags) {
          if (t[0] === 'd' && typeof t[1] === 'string' && t[1]) dtags.add(t[1])
        }
      }
    }
    return [...dtags].sort()
  } finally {
    pool.close(useRelays)
  }
}
