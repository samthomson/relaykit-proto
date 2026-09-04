import { Fragment, useEffect, useMemo, useState } from 'react';
import { nip19, SimplePool } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { useQuery } from '@tanstack/react-query';
import {
  ActionIcon,
  Anchor,
  Avatar,
  Badge,
  Box,
  Combobox,
  Group,
  Paper,
  Pill,
  ScrollArea,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
  useCombobox,
} from '@mantine/core';
import { CodeHighlight } from '@mantine/code-highlight';
import { ExternalLink, Lock } from 'lucide-react';
import { RubixLoader, RubixLoaderColor } from '@samthomson/rubix-loader';

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

type PathEntry = { path: string; hash: string };

type SiteData = {
  event: NostrEvent;
  kind: number;
  title?: string;
  identifier?: string;
  siteType: 'root' | 'named';
  paths: PathEntry[];
  blossomServers: string[];
};

type FileCheck = {
  available: boolean;
  server?: string;
  size?: number;
  mimeType?: string;
  lastModified?: number;
};

const parsePubkeyHex = (input: string): string | null => {
  const t = input.trim();
  if (/^[0-9a-f]{64}$/i.test(t)) return t.toLowerCase();
  if (t.startsWith('npub1')) {
    try {
      const d = nip19.decode(t);
      return d.type === 'npub' ? (d.data as string) : null;
    } catch {
      return null;
    }
  }
  return null;
};

const parseSiteEvent = (event: NostrEvent): SiteData => {
  const paths: PathEntry[] = [];
  const blossomServers: string[] = [];
  let title: string | undefined;
  for (const tag of event.tags) {
    if (tag[0] === 'path' && tag[1] && tag[2]) paths.push({ path: tag[1], hash: tag[2] });
    else if (tag[0] === 'server' && tag[1]) blossomServers.push(tag[1]);
    else if (tag[0] === 'title' && tag[1]) title = tag[1];
  }
  paths.sort((a, b) => a.path.localeCompare(b.path));
  const identifier = event.tags.find((t) => t[0] === 'd')?.[1];
  return {
    event,
    kind: event.kind,
    title,
    identifier,
    siteType: event.kind === 35128 ? 'named' : 'root',
    paths,
    blossomServers,
  };
};

const parseRelayList = (raw: string): string[] =>
  raw
    .split(/[\n,\s]+/)
    .map((r) => r.trim())
    .filter((r) => r.startsWith('ws://') || r.startsWith('wss://'));

const formatBytes = (n?: number): string => {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

const formatDate = (secondsOrMs?: number): string => {
  if (!secondsOrMs) return '—';
  const d = new Date(secondsOrMs);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const relativeTime = (ms?: number): string => {
  if (!ms) return '';
  const s = (ms - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(Math.round(s), 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(s / 86400), 'day');
  if (abs < 31536000) return rtf.format(Math.round(s / 2592000), 'month');
  return rtf.format(Math.round(s / 31536000), 'year');
};

// A "page" is a navigable route: root, an .html document, or an extensionless path.
const isPage = (path: string): boolean => {
  if (path === '/' || path.endsWith('/')) return true;
  const last = path.split('/').pop() || '';
  if (last.endsWith('.html')) return true;
  return !last.includes('.');
};

const params = new URLSearchParams(window.location.search);
const EMBEDDED = params.get('embedded') === '1';
const GATEWAY = (params.get('gateway') || '').replace(/\/$/, '');
const PUBKEY_PARAM = params.get('pubkey') || '';
const SITE_D_PARAM = params.get('siteD') || '';
const RELAYS_PARAM = params.get('relays') || '';
const OWNER_PARAM = params.get('owner') || '';
// Browse mode: no specific site was passed in (i.e. opened from /apps rather than a service),
// so we discover nsites across the chosen relays instead of inspecting one publisher.
const BROWSE = !PUBKEY_PARAM;

// Public nsite gateway used to build open/preview URLs for arbitrary discovered sites.
const PUBLIC_NSITE_GATEWAY = 'nsite.lol';
const pubkeyToBase36 = (hex: string): string => BigInt(`0x${hex}`).toString(36).padStart(50, '0');
const publicSiteUrl = (s: SiteData): string =>
  s.siteType === 'root'
    ? `https://${nip19.npubEncode(s.event.pubkey)}.${PUBLIC_NSITE_GATEWAY}`
    : `https://${pubkeyToBase36(s.event.pubkey)}${s.identifier}.${PUBLIC_NSITE_GATEWAY}`;

const shortNpub = (pubkeyHex: string): string => {
  const npub = nip19.npubEncode(pubkeyHex);
  return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
};

type RelayToggle = { url: string; active: boolean };
type AuthorFilter = { hex: string; active: boolean };
type Profile = { name?: string; picture?: string };

const Index = () => {
  const initialRelays = useMemo(() => {
    // Merge the user's own relays (passed in) with sensible public defaults so a publisher's sites
    // are discoverable even if they live on public relays.
    const fromParam = parseRelayList(RELAYS_PARAM);
    return [...new Set([...fromParam, ...DEFAULT_RELAYS])];
  }, []);

  const [relays, setRelays] = useState<RelayToggle[]>(() => initialRelays.map((url) => ({ url, active: true })));
  const [relayDraft, setRelayDraft] = useState('');
  const [authors, setAuthors] = useState<AuthorFilter[]>(() => {
    const hex = parsePubkeyHex(OWNER_PARAM);
    return hex ? [{ hex, active: true }] : [];
  });
  const [authorDraft, setAuthorDraft] = useState('');
  const [pubkey, setPubkey] = useState<string | null>(() => parsePubkeyHex(PUBKEY_PARAM));
  const [selectedId, setSelectedId] = useState<string>(SITE_D_PARAM ? `named:${SITE_D_PARAM}` : '');

  const activeRelays = useMemo(() => relays.filter((r) => r.active).map((r) => r.url), [relays]);
  const activeAuthors = useMemo(() => authors.filter((a) => a.active).map((a) => a.hex), [authors]);

  const authorCombobox = useCombobox({ onDropdownClose: () => authorCombobox.resetSelectedOption() });
  const addAuthorHex = (hex: string) => {
    setAuthors((prev) => (prev.some((a) => a.hex === hex) ? prev : [...prev, { hex, active: true }]));
    setAuthorDraft('');
    authorCombobox.closeDropdown();
  };
  const submitAuthorDraft = () => {
    const hex = parsePubkeyHex(authorDraft);
    if (hex) addAuthorHex(hex);
  };
  const toggleAuthor = (hex: string) =>
    setAuthors((prev) => prev.map((a) => (a.hex === hex ? { ...a, active: !a.active } : a)));
  const removeAuthor = (hex: string) => setAuthors((prev) => prev.filter((a) => a.hex !== hex));

  const addRelay = () => {
    const urls = parseRelayList(relayDraft);
    if (!urls.length) return;
    setRelays((prev) => {
      const seen = new Set(prev.map((r) => r.url));
      return [...prev, ...urls.filter((u) => !seen.has(u)).map((url) => ({ url, active: true }))];
    });
    setRelayDraft('');
  };
  const toggleRelay = (url: string) =>
    setRelays((prev) => prev.map((r) => (r.url === url ? { ...r, active: !r.active } : r)));
  const removeRelay = (url: string) => setRelays((prev) => prev.filter((r) => r.url !== url));

  const {
    data: sites,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['nsite-manifests', pubkey, activeRelays],
    retry: 1,
    enabled: !!pubkey,
    queryFn: async (): Promise<SiteData[]> => {
      const pool = new SimplePool();
      try {
        const events = await pool.querySync(activeRelays, {
          kinds: [15128, 35128],
          authors: [pubkey!],
          limit: 200,
        }, { maxWait: 8000 });
        // Deduplicate replaceable events, keeping the newest per (kind,d).
        const newest = new Map<string, NostrEvent>();
        for (const e of events) {
          const d = e.tags.find((t) => t[0] === 'd')?.[1] ?? '';
          const key = `${e.kind}:${d}`;
          const prev = newest.get(key);
          if (!prev || e.created_at > prev.created_at) newest.set(key, e);
        }
        return [...newest.values()]
          .map(parseSiteEvent)
          .sort((a, b) => (a.siteType === 'root' ? -1 : b.siteType === 'root' ? 1 : (a.identifier || '').localeCompare(b.identifier || '')));
      } finally {
        pool.close(activeRelays);
      }
    },
  });

  const { data: userBlossom = [] } = useQuery({
    queryKey: ['nsite-blossom', pubkey, activeRelays],
    enabled: !!pubkey,
    queryFn: async (): Promise<string[]> => {
      const pool = new SimplePool();
      try {
        const events = await pool.querySync(activeRelays, { kinds: [10063], authors: [pubkey!], limit: 1 }, { maxWait: 8000 });
        return events[0]?.tags.filter((t) => t[0] === 'server' && t[1]).map((t) => t[1]) ?? [];
      } finally {
        pool.close(activeRelays);
      }
    },
  });

  // Discover nsites across the active relays for the browse view. When people are selected,
  // filter to those authors; otherwise discover everyone's sites.
  const { data: discovered, isFetching: discovering } = useQuery({
    queryKey: ['nsite-discover', activeRelays, activeAuthors],
    enabled: BROWSE && !pubkey && activeRelays.length > 0,
    queryFn: async (): Promise<SiteData[]> => {
      const pool = new SimplePool();
      try {
        const filter: Record<string, unknown> = { kinds: [15128, 35128], limit: 100 };
        if (activeAuthors.length) filter.authors = activeAuthors;
        const events = await pool.querySync(activeRelays, filter as never, { maxWait: 8000 });
        const newest = new Map<string, NostrEvent>();
        for (const e of events) {
          const d = e.tags.find((t) => t[0] === 'd')?.[1] ?? '';
          const key = `${e.kind}:${e.pubkey}:${d}`;
          const prev = newest.get(key);
          if (!prev || e.created_at > prev.created_at) newest.set(key, e);
        }
        return [...newest.values()].map(parseSiteEvent).sort((a, b) => b.event.created_at - a.event.created_at);
      } finally {
        pool.close(activeRelays);
      }
    },
  });

  const pickSite = (s: SiteData) => {
    setSelectedId(s.siteType === 'root' ? 'root' : `named:${s.identifier}`);
    setPubkey(s.event.pubkey);
  };

  const siteOptions = useMemo(
    () =>
      (sites ?? []).map((s) => ({
        value: s.siteType === 'root' ? 'root' : `named:${s.identifier}`,
        label: s.siteType === 'root' ? 'root site (15128)' : `${s.identifier} (35128)`,
      })),
    [sites],
  );

  // Resolve selected site (fall back to first when the requested one isn't present).
  const selectedSite = useMemo(() => {
    if (!sites?.length) return undefined;
    const byId = sites.find((s) => (s.siteType === 'root' ? 'root' : `named:${s.identifier}`) === selectedId);
    return byId ?? sites[0];
  }, [sites, selectedId]);

  useEffect(() => {
    if (selectedSite && !siteOptions.some((o) => o.value === selectedId)) {
      setSelectedId(selectedSite.siteType === 'root' ? 'root' : `named:${selectedSite.identifier}`);
    }
  }, [selectedSite, siteOptions, selectedId]);

  // Normalize trailing slashes so the same server from a manifest `server` tag and a kind 10063 list
  // (e.g. "https://x" vs "https://x/") isn't listed twice.
  const servers = useMemo(
    () => [...new Set([...(selectedSite?.blossomServers ?? []), ...userBlossom].map((s) => s.replace(/\/+$/, '')))],
    [selectedSite, userBlossom],
  );

  // Pubkeys we want kind-0 profiles for: any selected people, discovered publishers, and the open site.
  const neededPubkeys = useMemo(() => {
    const set = new Set<string>();
    authors.forEach((a) => set.add(a.hex));
    (discovered ?? []).forEach((s) => set.add(s.event.pubkey));
    if (selectedSite) set.add(selectedSite.event.pubkey);
    return [...set];
  }, [authors, discovered, selectedSite]);

  const { data: profiles = {} } = useQuery({
    queryKey: ['nsite-profiles', neededPubkeys, activeRelays],
    enabled: neededPubkeys.length > 0 && activeRelays.length > 0,
    queryFn: async (): Promise<Record<string, Profile>> => {
      const pool = new SimplePool();
      try {
        const events = await pool.querySync(activeRelays, { kinds: [0], authors: neededPubkeys });
        const newest = new Map<string, NostrEvent>();
        for (const e of events) {
          const prev = newest.get(e.pubkey);
          if (!prev || e.created_at > prev.created_at) newest.set(e.pubkey, e);
        }
        const out: Record<string, Profile> = {};
        for (const [pk, e] of newest) {
          try {
            const meta = JSON.parse(e.content);
            out[pk] = { name: meta.display_name || meta.name, picture: meta.picture };
          } catch {
            /* ignore malformed profiles */
          }
        }
        return out;
      } finally {
        pool.close(activeRelays);
      }
    },
  });

  // Owner's follow list (kind 3) + their profiles, to power the people typeahead.
  const ownerHex = useMemo(() => parsePubkeyHex(OWNER_PARAM), []);
  const { data: follows = [] } = useQuery({
    queryKey: ['nsite-follows', ownerHex, activeRelays],
    enabled: BROWSE && !!ownerHex && activeRelays.length > 0,
    queryFn: async (): Promise<{ hex: string; name?: string; picture?: string }[]> => {
      const pool = new SimplePool();
      try {
        const contacts = await pool.querySync(activeRelays, { kinds: [3], authors: [ownerHex!], limit: 1 });
        const newest = contacts.sort((a, b) => b.created_at - a.created_at)[0];
        const pks = newest
          ? [...new Set(newest.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]))]
          : [];
        if (!pks.length) return [];
        const metas = await pool.querySync(activeRelays, { kinds: [0], authors: pks });
        const byPk = new Map<string, NostrEvent>();
        for (const e of metas) {
          const prev = byPk.get(e.pubkey);
          if (!prev || e.created_at > prev.created_at) byPk.set(e.pubkey, e);
        }
        return pks.map((hex) => {
          const e = byPk.get(hex);
          let name: string | undefined;
          let picture: string | undefined;
          if (e) {
            try {
              const m = JSON.parse(e.content);
              name = m.display_name || m.name;
              picture = m.picture;
            } catch {
              /* ignore */
            }
          }
          return { hex, name, picture };
        });
      } finally {
        pool.close(activeRelays);
      }
    },
  });

  const followMap = useMemo(() => {
    const m = new Map<string, Profile>();
    follows.forEach((f) => m.set(f.hex, { name: f.name, picture: f.picture }));
    return m;
  }, [follows]);

  // Resolve a profile from discovered/selected kind-0 data first, then fall back to the follow list.
  const profileFor = (hex: string): Profile => profiles[hex] || followMap.get(hex) || {};

  const filteredFollows = useMemo(() => {
    const q = authorDraft.trim().toLowerCase();
    const already = new Set(authors.map((a) => a.hex));
    return follows
      .filter((f) => !already.has(f.hex))
      .filter((f) => !q || (f.name ?? '').toLowerCase().includes(q) || f.hex.includes(q))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      .slice(0, 8);
  }, [authorDraft, follows, authors]);

  const previewBase = useMemo(() => {
    if (!selectedSite) return '';
    // For a site opened from its own service we have the exact configured URL; otherwise use the public gateway.
    if (!BROWSE && GATEWAY) return GATEWAY;
    return publicSiteUrl(selectedSite);
  }, [selectedSite]);

  const renderPublisher = (pubkeyHex: string) => {
    const p = profileFor(pubkeyHex);
    return (
      <Group gap={6} wrap="nowrap" miw={0} style={{ lineHeight: 1 }}>
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          published by
        </Text>
        <Avatar src={p?.picture} size={16} radius={0} style={{ flexShrink: 0 }} />
        <Text size="xs" c="dimmed" ff={p?.name ? undefined : 'monospace'} truncate style={{ minWidth: 0 }}>
          {p?.name || shortNpub(pubkeyHex)}
        </Text>
      </Group>
    );
  };

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleRow = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { data: checks = {}, isFetching: checksLoading } = useQuery({
    queryKey: ['nsite-checks', selectedSite?.event.id, servers],
    enabled: !!selectedSite && selectedSite.paths.length > 0 && servers.length > 0,
    queryFn: async (): Promise<Record<string, FileCheck>> => {
      const out: Record<string, FileCheck> = {};
      await Promise.all(
        selectedSite!.paths.map(async (p) => {
          for (const server of servers) {
            try {
              const res = await fetch(`${server.replace(/\/$/, '')}/${p.hash}`, { method: 'HEAD' });
              if (res.ok) {
                const lm = res.headers.get('last-modified');
                out[p.hash] = {
                  available: true,
                  server,
                  size: parseInt(res.headers.get('content-length') ?? '') || undefined,
                  mimeType: res.headers.get('content-type') ?? undefined,
                  lastModified: lm ? Date.parse(lm) : undefined,
                };
                return;
              }
            } catch {
              /* try next server */
            }
          }
          out[p.hash] = { available: false };
        }),
      );
      return out;
    },
  });

  const pages = useMemo(() => (selectedSite?.paths ?? []).filter((p) => isPage(p.path)), [selectedSite]);
  const assets = useMemo(() => (selectedSite?.paths ?? []).filter((p) => !isPage(p.path)), [selectedSite]);
  const totalSize = useMemo(
    () => (selectedSite?.paths ?? []).reduce((sum, p) => sum + (checks[p.hash]?.size ?? 0), 0),
    [selectedSite, checks],
  );
  const availableCount = useMemo(
    () => (selectedSite?.paths ?? []).filter((p) => checks[p.hash]?.available).length,
    [selectedSite, checks],
  );

  const statusColor = (hash: string): string => {
    if (checksLoading) return 'gray';
    const c = checks[hash];
    if (!c) return 'gray';
    return c.available ? 'teal' : 'red';
  };

  const fileRow = (p: PathEntry) => {
    const c = checks[p.hash];
    const key = p.hash + p.path;
    const isOpen = expanded.has(key);
    const url = previewBase ? `${previewBase}${p.path.startsWith('/') ? '' : '/'}${p.path}` : undefined;
    return (
      <Fragment key={key}>
        <Table.Tr style={{ cursor: 'pointer' }} onClick={() => toggleRow(key)}>
          <Table.Td>
            <Group gap={4} wrap="nowrap">
              <Text size="xs" c="dimmed" w={10} style={{ flexShrink: 0 }}>
                {isOpen ? '▾' : '▸'}
              </Text>
              {url ? (
                <Anchor href={url} target="_blank" c="nsiteExplorer" size="xs" onClick={(e) => e.stopPropagation()}>
                  {p.path}
                </Anchor>
              ) : (
                <Text size="xs">{p.path}</Text>
              )}
            </Group>
          </Table.Td>
          <Table.Td>
            <Text size="xs" c="dimmed">
              {c?.mimeType?.split(';')[0] ?? '—'}
            </Text>
          </Table.Td>
          <Table.Td>
            <Text size="xs" c="dimmed">
              {formatBytes(c?.size)}
            </Text>
          </Table.Td>
          <Table.Td>
            <Text size="xs" c="dimmed" ff="monospace">
              {p.hash.slice(0, 10)}…
            </Text>
          </Table.Td>
          <Table.Td>
            <Badge size="xs" variant="light" color={statusColor(p.hash)}>
              {checksLoading ? '…' : checks[p.hash]?.available ? 'ok' : servers.length ? 'missing' : '?'}
            </Badge>
          </Table.Td>
        </Table.Tr>
        {isOpen && (
          <Table.Tr>
            <Table.Td colSpan={5} style={{ background: 'var(--mantine-color-default-hover)' }}>
              <Stack gap={6} p="xs">
                <Info label="sha256" value={p.hash} mono />
                {servers.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    no blossom servers configured
                  </Text>
                ) : (
                  servers.map((s) => {
                    const blobUrl = `${s}/${p.hash}`;
                    return (
                      <Group key={s} gap="xs" wrap="nowrap">
                        <Anchor
                          href={blobUrl}
                          target="_blank"
                          size="xs"
                          c="nsiteExplorer"
                          style={{ wordBreak: 'break-all' }}
                        >
                          {blobUrl}
                        </Anchor>
                        {c?.server === s && (
                          <Badge size="xs" variant="light" color="teal">
                            served
                          </Badge>
                        )}
                      </Group>
                    );
                  })
                )}
              </Stack>
            </Table.Td>
          </Table.Tr>
        )}
      </Fragment>
    );
  };

  const filesTable = (rows: PathEntry[], empty: string) =>
    rows.length === 0 ? (
      <Text size="xs" c="dimmed">
        {empty}
      </Text>
    ) : (
      <Table highlightOnHover withTableBorder verticalSpacing={4} horizontalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>path</Table.Th>
            <Table.Th>type</Table.Th>
            <Table.Th>size</Table.Th>
            <Table.Th>sha256</Table.Th>
            <Table.Th>status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{rows.map(fileRow)}</Table.Tbody>
      </Table>
    );

  return (
    <Box mih="100%" p={EMBEDDED ? 'sm' : 'lg'}>
      <Stack gap="md" maw={EMBEDDED ? 1200 : 880} mx="auto">
        {!EMBEDDED && (
          <Group justify="space-between" align="flex-end">
            <div>
              <Title order={4}>nsite explorer</Title>
              <Text size="xs" c="dimmed">
                inspect a published site&apos;s pages, files and availability
              </Text>
            </div>
          </Group>
        )}

        {/* Relay bar — only in browse mode (no site passed in from a service). */}
        {BROWSE && (
          <Paper withBorder p="sm">
            <Stack gap="xs">
              <Text size="xs" c="dimmed">
                relays — click a relay to toggle it on/off, × to remove
              </Text>
              <Group gap={6}>
                {relays.map((r) => (
                  <Pill
                    key={r.url}
                    withRemoveButton
                    onRemove={() => removeRelay(r.url)}
                    onClick={() => toggleRelay(r.url)}
                    style={{
                      cursor: 'pointer',
                      opacity: r.active ? 1 : 0.4,
                      textDecoration: r.active ? undefined : 'line-through',
                    }}
                  >
                    {r.url.replace(/^wss?:\/\//, '')}
                  </Pill>
                ))}
              </Group>
              <TextInput
                size="xs"
                placeholder="add relay (wss://…) and press enter"
                value={relayDraft}
                onChange={(e) => setRelayDraft(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && addRelay()}
              />
            </Stack>
          </Paper>
        )}

        {/* People filter — defaults to your own npub so you see your sites; clear to browse everyone. */}
        {BROWSE && (
          <Paper withBorder p="sm">
            <Stack gap="xs">
              <Text size="xs" c="dimmed">
                people — showing sites by these npubs; remove all to browse everyone
              </Text>
              {authors.length > 0 && (
                <Group gap={6}>
                  {authors.map((a) => {
                    const p = profileFor(a.hex);
                    return (
                      <Pill
                        key={a.hex}
                        withRemoveButton
                        onRemove={() => removeAuthor(a.hex)}
                        onClick={() => toggleAuthor(a.hex)}
                        style={{
                          cursor: 'pointer',
                          opacity: a.active ? 1 : 0.4,
                          textDecoration: a.active ? undefined : 'line-through',
                        }}
                      >
                        <Group gap={5} wrap="nowrap" style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
                          <Avatar src={p.picture} size={16} radius={0} />
                          <span>{p.name || shortNpub(a.hex)}</span>
                        </Group>
                      </Pill>
                    );
                  })}
                </Group>
              )}
              <Combobox store={authorCombobox} onOptionSubmit={(val) => addAuthorHex(val)}>
                <Combobox.Target>
                  <TextInput
                    size="xs"
                    placeholder="search your follows by name, or paste an npub"
                    value={authorDraft}
                    onChange={(e) => {
                      setAuthorDraft(e.currentTarget.value);
                      authorCombobox.openDropdown();
                    }}
                    onFocus={() => authorCombobox.openDropdown()}
                    onBlur={() => authorCombobox.closeDropdown()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        submitAuthorDraft();
                      }
                    }}
                  />
                </Combobox.Target>
                <Combobox.Dropdown>
                  <Combobox.Options>
                    {filteredFollows.length === 0 ? (
                      <Combobox.Empty>
                        {authorDraft.trim()
                          ? 'no matching follows — press enter to add by npub'
                          : follows.length
                            ? 'type to search your follows'
                            : 'no follow list found'}
                      </Combobox.Empty>
                    ) : (
                      filteredFollows.map((f) => (
                        <Combobox.Option value={f.hex} key={f.hex}>
                          <Group gap={8} wrap="nowrap">
                            <Avatar src={f.picture} size={20} radius={0} />
                            <Text size="xs" truncate>
                              {f.name || shortNpub(f.hex)}
                            </Text>
                          </Group>
                        </Combobox.Option>
                      ))
                    )}
                  </Combobox.Options>
                </Combobox.Dropdown>
              </Combobox>
            </Stack>
          </Paper>
        )}

        {/* Discovery list — browse mode, before a site is selected. */}
        {BROWSE && !pubkey && (
          <>
            {activeRelays.length === 0 ? (
              <Text size="sm" c="dimmed">
                enable at least one relay to discover nsites.
              </Text>
            ) : discovering ? (
              <NpanelLoader label="discovering nsites…" />
            ) : (discovered?.length ?? 0) === 0 ? (
              <Text size="sm" c="dimmed">
                no nsites (kind 15128/35128) found on the active relays.
              </Text>
            ) : (
              <Stack gap="xs">
                <Text size="xs" c="dimmed">
                  {discovered!.length} nsites found — click to inspect
                </Text>
                {discovered!.map((s) => (
                  <Paper key={s.event.id} withBorder p="sm" onClick={() => pickSite(s)} style={{ cursor: 'pointer' }}>
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap="sm" wrap="nowrap" miw={0}>
                        <Badge size="sm" variant="light" color="nsiteExplorer" style={{ flexShrink: 0 }}>
                          {s.siteType === 'root' ? 'root' : s.identifier}
                        </Badge>
                        {s.title && (
                          <Text size="sm" truncate style={{ flexShrink: 0 }}>
                            {s.title}
                          </Text>
                        )}
                        {renderPublisher(s.event.pubkey)}
                      </Group>
                      <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                        {s.paths.length} files · {relativeTime(s.event.created_at * 1000)}
                      </Text>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            )}
          </>
        )}

        {pubkey && isLoading && <NpanelLoader label="loading manifests…" />}

        {error && (
          <Text size="sm" c="red">
            {error instanceof Error ? error.message : 'failed to load'}
          </Text>
        )}

        {pubkey && !isLoading && !error && (sites?.length ?? 0) === 0 && (
          <Text size="sm" c="dimmed">
            no site manifests (kind 15128/35128) found on the selected relays.
          </Text>
        )}

        {selectedSite && (
          <Paper withBorder>
            {/* summary header */}
            <Group justify="space-between" p="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
              <Group gap="xs" wrap="nowrap" miw={0}>
                {BROWSE && (
                  <Tooltip label="back to all nsites" withArrow>
                    <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => setPubkey(null)}>
                      ←
                    </ActionIcon>
                  </Tooltip>
                )}
                {siteOptions.length > 1 ? (
                  <Select
                    size="xs"
                    data={siteOptions}
                    value={selectedId || siteOptions[0]?.value}
                    onChange={(v) => v && setSelectedId(v)}
                    allowDeselect={false}
                    w={200}
                  />
                ) : (
                  <Badge size="sm" variant="light" color="nsiteExplorer">
                    {selectedSite.siteType === 'root' ? 'root site' : selectedSite.identifier}
                  </Badge>
                )}
                {selectedSite.title && (
                  <Text size="sm" truncate>
                    {selectedSite.title}
                  </Text>
                )}
                {renderPublisher(selectedSite.event.pubkey)}
              </Group>
              <Group gap="xs">
                {previewBase && (
                  <Anchor href={previewBase} target="_blank" size="xs" c="nsiteExplorer">
                    open site
                  </Anchor>
                )}
                <Tooltip label="reload from relays" withArrow>
                  <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => refetch()} loading={isFetching}>
                    ↻
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>

            {/* stat strip */}
            <Group gap="xl" p="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
              <Stat label="pages" value={String(pages.length)} />
              <Stat label="files" value={String(assets.length)} />
              <Stat label="total size" value={servers.length ? formatBytes(totalSize) : '—'} />
              <Stat
                label="available"
                value={servers.length ? `${availableCount}/${selectedSite.paths.length}` : 'no servers'}
              />
              <Stat
                label="updated"
                value={formatDate(selectedSite.event.created_at * 1000)}
                sub={relativeTime(selectedSite.event.created_at * 1000)}
              />
            </Group>

            <Tabs defaultValue="pages" color="nsiteExplorer">
              <Tabs.List>
                <Tabs.Tab value="pages">pages ({pages.length})</Tabs.Tab>
                <Tabs.Tab value="files">files ({assets.length})</Tabs.Tab>
                {previewBase && <Tabs.Tab value="preview">preview</Tabs.Tab>}
                <Tabs.Tab value="info">info</Tabs.Tab>
                <Tabs.Tab value="raw">raw</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="pages" p="sm">
                {filesTable(pages, 'no page routes in manifest')}
              </Tabs.Panel>
              <Tabs.Panel value="files" p="sm">
                {filesTable(assets, 'no asset files in manifest')}
                {servers.length === 0 && selectedSite.paths.length > 0 && (
                  <Text size="xs" c="dimmed" mt="xs">
                    no blossom servers found — sizes/availability unknown. add `server` tags to the manifest or publish
                    a kind 10063 list.
                  </Text>
                )}
              </Tabs.Panel>
              {previewBase && (
                <Tabs.Panel value="preview" p="sm">
                  <Stack gap="xs">
                    {/* Faux browser address bar */}
                    <Group
                      gap={0}
                      wrap="nowrap"
                      style={{
                        border: '1px solid var(--mantine-color-default-border)',
                        background: 'var(--mantine-color-default)',
                      }}
                    >
                      <Box px="xs" style={{ display: 'flex', alignItems: 'center', flexShrink: 0, opacity: 0.6 }}>
                        <Lock size={12} />
                      </Box>
                      <Text size="xs" ff="monospace" c="dimmed" truncate py={6} style={{ flex: 1, minWidth: 0 }}>
                        {previewBase}
                      </Text>
                      <Tooltip label="open in new tab" withArrow>
                        <ActionIcon
                          component="a"
                          href={previewBase}
                          target="_blank"
                          variant="subtle"
                          color="gray"
                          size="md"
                          radius={0}
                          style={{ flexShrink: 0 }}
                        >
                          <ExternalLink size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                    <Box
                      style={{
                        border: '1px solid var(--mantine-color-default-border)',
                        height: '70vh',
                        overflow: 'hidden',
                      }}
                    >
                      <iframe
                        src={previewBase}
                        title="site preview"
                        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                      />
                    </Box>
                  </Stack>
                </Tabs.Panel>
              )}
              <Tabs.Panel value="info" p="sm">
                <Stack gap="xs">
                  <Info label="publisher" value={nip19.npubEncode(selectedSite.event.pubkey)} mono />
                  <Info label="event id" value={selectedSite.event.id} mono />
                  <Info label="kind" value={String(selectedSite.kind)} />
                  <Info label="created" value={formatDate(selectedSite.event.created_at * 1000)} />
                  <Info label="relays queried" value={activeRelays.join(', ')} />
                  <Info
                    label="blossom servers"
                    value={servers.length ? servers.join(', ') : 'none configured'}
                  />
                </Stack>
              </Tabs.Panel>
              <Tabs.Panel value="raw" p="sm">
                <ScrollArea.Autosize mah={420}>
                  <CodeHighlight
                    code={JSON.stringify(selectedSite.event, null, 2)}
                    language="json"
                    fz="xs"
                    withCopyButton
                  />
                </ScrollArea.Autosize>
              </Tabs.Panel>
            </Tabs>
          </Paper>
        )}
      </Stack>
    </Box>
  );
};

const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div>
    <Text size="xs" c="dimmed">
      {label}
    </Text>
    <Group gap={6} align="baseline" wrap="nowrap">
      <Text size="sm" fw={600}>
        {value}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed">
          ({sub})
        </Text>
      )}
    </Group>
  </div>
);

const NpanelLoader = ({ label }: { label: string }) => (
  <Stack align="center" justify="center" gap="md" style={{ minHeight: '50vh' }}>
    <RubixLoader size={128} colors={[RubixLoaderColor.Npanel]} speed={1.35} />
    <Text size="sm" c="dimmed">
      {label}
    </Text>
  </Stack>
);

const Info = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <Group gap="xs" align="flex-start" wrap="nowrap">
    <Text size="xs" c="dimmed" w={120} style={{ flexShrink: 0 }}>
      {label}
    </Text>
    <Text size="xs" ff={mono ? 'monospace' : undefined} style={{ wordBreak: 'break-all' }}>
      {value}
    </Text>
  </Group>
);

export default Index;
