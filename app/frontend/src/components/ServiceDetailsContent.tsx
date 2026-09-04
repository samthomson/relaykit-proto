import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { LineChart } from '@mantine/charts';
import { nip19 } from 'nostr-tools';
import { RubixLoader } from '@samthomson/rubix-loader';
import { SERVICE_TYPE, isNpanelType, isRelayType } from '../../../shared/serviceType';
import { parsePubkeyHex } from '../../../shared/nsite';
import { Text, Group, Anchor, Tooltip, ActionIcon, Button, Stack, Badge, Tabs, Box, Transition, Table, rem, Paper, SimpleGrid, useComputedColorScheme, useMantineTheme } from '@mantine/core';
import { IconExternalLink, IconCheck, IconX, IconAlertOctagon, IconAlertTriangle, IconCircleCheck, IconRefresh, IconPencil } from '@tabler/icons-react';
import { toast } from 'sonner';
import { InlineTextEditRow } from './InlineTextEditRow';
import { CopyControl } from './CopyControl';
import { ServiceConfigEditor } from './ServiceConfigEditor';
import { prepareNsiteConfigForSave } from './NsiteDeployFields';
import { trpc } from '../trpc';
import { serviceTypeToRubixLoaderColor } from '../lib/serviceTypeColor';
import { formatBytes, formatBytesPerSecond, formatPercent, formatWindow, getInsightSeverity, getOverallSeverity, getSeverityColor } from '../../../shared/insights';

/** Set by `Provider` in App only for the details `Modal` (inline expanded card stays default `false`). */
export const ServiceDetailsModalContext = createContext(false);

const SHELL_H_MS = 480;
const FADE_MS = 280;
const HEIGHT_EASE = `${SHELL_H_MS / 1000}s cubic-bezier(0.33, 1, 0.68, 1)`;

const LABEL_COL = 124;

const monoBreakable = { wordBreak: 'break-all' as const, overflowWrap: 'anywhere' as const };

const DetailBlock = ({ label, children }: { label: string; children: ReactNode }) => (
  <Group align="flex-start" gap="lg" wrap="nowrap">
    <Text size="sm" fw={500} c="dimmed" w={LABEL_COL} style={{ flexShrink: 0 }}>
      {label}
    </Text>
    <Stack gap={10} style={{ flex: 1, minWidth: 0 }}>
      {children}
    </Stack>
  </Group>
);

const ServiceDetailsDns = ({
  service,
  domain,
  serverIp,
  onCopy,
}: {
  service: any;
  domain: { host: string };
  serverIp: string;
  onCopy: (text: string) => void;
}) => {
  const dnsCel = 'service-details-dns-cel';
  const dnsCopy = 'service-details-dns-copy';
  const publicHost =
    (isNpanelType(service.type) ? service.nsiteVisitorHost || service.nsiteCanonicalHost : null) || domain.host;
  // Every domain registered on the service (e.g. pulse's bundled ntfy) needs its own record.
  const allHosts = [
    ...new Set([publicHost, ...((service.domains ?? []) as { host: string }[]).map((d) => d.host)]),
  ].filter(Boolean);
  type DnsStatus = 'idle' | 'loading' | 'ok' | 'proxied' | 'fail';
  type DnsEntry = { status: DnsStatus; ips?: string[]; error?: string };
  type DnsResult = { ok: boolean; proxied?: string; ips: string[]; error?: string };

  const DNS_BUTTON: Record<DnsStatus, { variant: 'light' | 'filled'; color?: string; label: string; icon?: React.ReactNode; tooltip?: string }> = {
    idle:    { variant: 'light',  label: 'test' },
    loading: { variant: 'light',  label: 'test' },
    ok:      { variant: 'filled', color: 'green',  label: 'ok',     icon: <IconCheck size={12} /> },
    proxied: { variant: 'filled', color: 'orange', label: 'via CF', tooltip: 'domain resolves via cloudflare proxy — dns is pointed correctly, but the origin ip is hidden' },
    fail:    { variant: 'filled', color: 'red',    label: 'fail',   icon: <IconX size={12} /> },
  };

  const [testState, setTestState] = useState<Record<string, DnsEntry>>({});

  const testDns = async (name: string) => {
    setTestState((s) => ({ ...s, [name]: { status: 'loading' } }));
    try {
      const res = await trpc.testDnsRecord.query({ host: name, expectedIp: serverIp }) as DnsResult;
      const status: DnsStatus = res.ok ? 'ok' : res.proxied === 'cloudflare' ? 'proxied' : 'fail';
      setTestState((s) => ({ ...s, [name]: { status, ips: res.ips, error: res.error } }));
    } catch {
      setTestState((s) => ({ ...s, [name]: { status: 'fail', error: 'request failed' } }));
    }
  };

  const dnsRow = (name: string) => {
    const { status, ips, error }: DnsEntry = testState[name] ?? { status: 'idle' };
    const btn = DNS_BUTTON[status];
    const tooltip = btn.tooltip ?? (ips && ips.length > 0 ? `resolved: ${ips.join(', ')}` : error ?? 'no IPs resolved');
    return (
      <Table.Tr key={name}>
        <Table.Td>
          <Text size="xs" ff="monospace">
            A
          </Text>
        </Table.Td>
        <Table.Td className={dnsCel}>
          <Group gap={0} wrap="nowrap" align="center">
            <Text size="xs" ff="monospace" style={monoBreakable}>
              {name}
            </Text>
            <CopyControl
              text={name}
              onCopy={onCopy}
              tooltip="copy name"
              iconSize={12}
              className={dnsCopy}
              style={{ flexShrink: 0, marginLeft: rem(2) }}
            />
          </Group>
        </Table.Td>
        <Table.Td className={dnsCel}>
          <Group gap={0} wrap="nowrap" align="center">
            <Text size="xs" ff="monospace" style={monoBreakable}>
              {serverIp}
            </Text>
            <CopyControl
              text={serverIp}
              onCopy={onCopy}
              tooltip="copy ip"
              iconSize={12}
              className={dnsCopy}
              style={{ flexShrink: 0, marginLeft: rem(2) }}
            />
          </Group>
        </Table.Td>
        <Table.Td>
          <Group gap="xs" wrap="nowrap">
            <Tooltip disabled={status === 'idle' || status === 'loading' || status === 'ok'} label={tooltip} withArrow multiline maw={280}>
              <Button size="xs" variant={btn.variant} color={btn.color} loading={status === 'loading'} leftSection={btn.icon} onClick={() => void testDns(name)}>
                {btn.label}
              </Button>
            </Tooltip>
          </Group>
        </Table.Td>
      </Table.Tr>
    );
  };

  return (
    <>
      <style>
        {`
          .${dnsCel}:hover .${dnsCopy} { opacity: 1; pointer-events: auto; }
          .${dnsCopy} { opacity: 0; pointer-events: none; transition: opacity 80ms ease; }
        `}
      </style>
      <Table.ScrollContainer minWidth={440}>
        <Table
          striped
          highlightOnHover
          withTableBorder
          withColumnBorders
          verticalSpacing="xs"
          horizontalSpacing="sm"
          fz="xs"
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Type</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Content</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {allHosts.map((host) => dnsRow(host))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {isNpanelType(service.type) && service.nsiteCanonicalHost && service.nsiteCanonicalHost !== publicHost && (
        <Text size="xs" c="dimmed" mt="xs">
          point this one A record at the server. the long nip-5a host is internal — relaykit doesn&apos;t route it
          publicly, so it needs no dns.
        </Text>
      )}
    </>
  );
};

export type ServiceDetailsContentProps = {
  service: any;
  serverIp: string | null;
  editingDomain: { composeId: string; domainId: string; currentHost: string } | null;
  newDomainHost: string;
  setNewDomainHost: (v: string) => void;
  onEditDomain: (composeId: string, domain: any) => void;
  onSaveDomain: () => void;
  onCancelEdit: () => void;
  onCopy: (text: string) => void;
  onOpenRelayExplorer: () => void;
  onOpenBlossomExplorer: () => void;
  onOpenNsiteExplorer: () => void;
  onOpenGraspExplorer: () => void;
  /** When host is edited in the service card header / modal title instead. */
  omitHostEditor?: boolean;
  /** Tab to open on first render (e.g. 'config'). */
  initialSection?: string;
  /** Called after the config tab successfully saves, so the parent can refresh. */
  onConfigSaved?: () => void;
};

const ServiceDetailsInfo = (props: ServiceDetailsContentProps) => {
  const {
    service,
    editingDomain,
    newDomainHost,
    setNewDomainHost,
    onEditDomain,
    onSaveDomain,
    onCancelEdit,
    onCopy,
    onOpenRelayExplorer,
    onOpenBlossomExplorer,
    onOpenNsiteExplorer,
    onOpenGraspExplorer,
    omitHostEditor = false,
  } = props;
  const domain = service.domains?.[0];
  const whitelistedPubkeys: string[] = service.whitelistedPubkeys || [];
  const whitelistedKinds: string[] = service.whitelistedKinds || [];
  const blacklistedKinds: string[] = service.blacklistedKinds || [];
  const requireNip42: boolean = !!service.requireNip42;

  const isEditing = editingDomain?.domainId === domain?.domainId;
  // domainFields[0] is always the primary domain (already shown above); anything after is an
  // extra public domain for a sidecar container (e.g. pulse's bundled ntfy server).
  const extraDomainFields = ((service.domainFields ?? []) as Array<{ domainId: string; host: string; label: string }>).slice(1);
  const createdAt = new Date(service.createdAt);
  const createdStr = format(createdAt, 'd MMM yyyy, h:mm a');
  const createdAgo = formatDistanceToNow(createdAt, { addSuffix: true });
  const npanel = isNpanelType(service.type);
  const publicHost = (npanel ? service.nsiteVisitorHost || service.nsiteCanonicalHost : null) || domain?.host;
  const httpsUrl = publicHost ? `https://${publicHost}` : '';
  const wssUrl = publicHost ? `wss://${publicHost}` : '';
  const hasConfig = whitelistedKinds.length > 0 || blacklistedKinds.length > 0 || whitelistedPubkeys.length > 0 || requireNip42;
  const domainBaseChars = Math.max(12, Math.min(42, (publicHost || '').trim().length || 12));
  const domainDisplayWidthCh = domainBaseChars;
  const domainEditWidthCh = Math.min(56, Math.max(domainBaseChars + 8, 28));
  const domainFieldWidthCh = `${isEditing ? domainEditWidthCh : domainDisplayWidthCh}ch`;

  return (
    <Stack gap="xl">
      {service.brokenPreset && (
        <DetailBlock label="Status">
          <Stack gap={6}>
            <Badge color="red" variant="filled" w="fit-content">misconfigured service</Badge>
            <Text size="xs" c="dimmed" style={monoBreakable}>
              {service.brokenPresetReason || 'Preset metadata is missing for this service.'}
            </Text>
            <Text size="xs" c="dimmed">Delete and recreate this service with the current preset.</Text>
          </Stack>
        </DetailBlock>
      )}
      <DetailBlock label="Service ID">
        <Group gap="xs" wrap="nowrap" align="center" style={{ minWidth: 0, width: 'fit-content' }}>
          <Text size="sm" ff="monospace" style={monoBreakable} title={service.composeId}>
            {service.composeId}
          </Text>
          <CopyControl text={service.composeId} onCopy={onCopy} tooltip="copy service id" />
        </Group>
      </DetailBlock>
      {domain ? (
        <>
          <DetailBlock label="Domain">
            {isEditing && !omitHostEditor ? (
              <InlineTextEditRow
                value={newDomainHost}
                onChange={setNewDomainHost}
                onSave={onSaveDomain}
                onCancel={onCancelEdit}
                density="comfortable"
                inputStyle={{ width: domainFieldWidthCh, maxWidth: '100%', transition: 'width 180ms ease' }}
                rowStyle={{ minHeight: rem(28), width: 'fit-content', maxWidth: '100%' }}
              />
            ) : (
              <Group gap="xs" wrap="nowrap" align="center" style={{ minHeight: rem(28), minWidth: 0, width: 'fit-content', maxWidth: '100%' }}>
                <Text
                  size="sm"
                  ff="monospace"
                  style={{
                    width: domainFieldWidthCh,
                    maxWidth: '100%',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    transition: 'width 180ms ease',
                  }}
                  title={publicHost}
                >
                  {publicHost}
                </Text>
                <CopyControl text={publicHost} onCopy={onCopy} tooltip="copy domain" />
                <Tooltip label="edit domain">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={() => onEditDomain(service.composeId, domain)}
                    aria-label="edit domain"
                  >
                    <IconPencil size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            )}
          </DetailBlock>
          {extraDomainFields.map((field) => {
            const rowEditing = editingDomain?.domainId === field.domainId && !omitHostEditor;
            return (
              <DetailBlock key={field.domainId} label={field.label}>
                {rowEditing ? (
                  <InlineTextEditRow
                    value={newDomainHost}
                    onChange={setNewDomainHost}
                    onSave={onSaveDomain}
                    onCancel={onCancelEdit}
                    density="comfortable"
                    inputStyle={{ maxWidth: '100%' }}
                    rowStyle={{ minHeight: rem(28), width: 'fit-content', maxWidth: '100%' }}
                  />
                ) : (
                  <Group gap="xs" wrap="nowrap" align="center" style={{ minHeight: rem(28), minWidth: 0 }}>
                    <Text size="sm" ff="monospace" style={monoBreakable}>
                      {field.host}
                    </Text>
                    <CopyControl text={field.host} onCopy={onCopy} tooltip="copy domain" />
                    <Tooltip label="edit domain">
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        onClick={() => onEditDomain(service.composeId, { domainId: field.domainId, host: field.host })}
                        aria-label="edit domain"
                      >
                        <IconPencil size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                )}
              </DetailBlock>
            );
          })}
          <DetailBlock label="HTTPS">
            <Group gap="xs" wrap="wrap" align="center">
              <Anchor href={httpsUrl} target="_blank" size="sm" fw={500} style={monoBreakable}>
                {httpsUrl} ↗
              </Anchor>
              <CopyControl text={httpsUrl} onCopy={onCopy} tooltip="copy https url" />
              {isNpanelType(service.type) && (
                <Anchor href={`${httpsUrl}/status`} target="_blank" size="xs" variant="light" color="relaykit">Status</Anchor>
              )}
            </Group>
            {isNpanelType(service.type) && (
              <Text size="xs" c="dimmed">
                Republished the site? Use <Text component="span" fw={500}>refresh nsite content</Text> (in the manage menu) so
                the gateway pulls the fresh manifest.
              </Text>
            )}
          </DetailBlock>
          {isRelayType(service.type) && (
            <DetailBlock label="WSS">
              <Group gap="xs" wrap="wrap" align="flex-start">
                <Text size="sm" ff="monospace" style={{ flex: '1 1 12rem', minWidth: 0, ...monoBreakable }} title={wssUrl}>
                  {wssUrl}
                </Text>
                <CopyControl text={wssUrl} onCopy={onCopy} tooltip="copy wss url" />
              </Group>
            </DetailBlock>
          )}
          {(isRelayType(service.type) || service.type === SERVICE_TYPE.BLOSSOM || isNpanelType(service.type) || service.presetId === 'grasp') && (
            <DetailBlock label="Data">
              <Group gap="xs" wrap="wrap" align="center">
                {isRelayType(service.type) && (
                  <Button
                    size="xs"
                    variant="light"
                    color="relaykit"
                    onClick={onOpenRelayExplorer}
                    rightSection={<IconExternalLink size={12} />}
                  >
                    relay explorer
                  </Button>
                )}
                {service.type === SERVICE_TYPE.BLOSSOM && (
                  <Button
                    size="xs"
                    variant="light"
                    color="relaykit"
                    onClick={onOpenBlossomExplorer}
                    rightSection={<IconExternalLink size={12} />}
                  >
                    blossom explorer
                  </Button>
                )}
                {isNpanelType(service.type) && (
                  <Button
                    size="xs"
                    variant="light"
                    color="relaykit"
                    onClick={onOpenNsiteExplorer}
                    rightSection={<IconExternalLink size={12} />}
                  >
                    nPanel
                  </Button>
                )}
                {service.presetId === 'grasp' && (
                  <Button
                    size="xs"
                    variant="light"
                    color="relaykit"
                    onClick={onOpenGraspExplorer}
                    rightSection={<IconExternalLink size={12} />}
                  >
                    grasp explorer
                  </Button>
                )}
              </Group>
            </DetailBlock>
          )}
          {npanel &&
            service.nsiteCanonicalHost &&
            service.nsiteCanonicalHost !== publicHost && (() => {
              const h = service.nsiteCanonicalHost;
              return (
                <DetailBlock label="internal host">
                  <Group gap="xs" wrap="wrap" align="flex-start">
                    <Text size="xs" ff="monospace" c="dimmed" style={{ flex: '1 1 12rem', minWidth: 0, ...monoBreakable }} title={h}>
                      {h}
                    </Text>
                    <CopyControl text={h} onCopy={onCopy} tooltip="copy internal host" />
                  </Group>
                  <Text size="xs" c="dimmed">
                    nip-5a encodes your pubkey + site id into this hostname. caddy rewrites the request to it inside the
                    server so the gateway knows which site to serve — it&apos;s not a public url you need to visit.
                  </Text>
                </DetailBlock>
              );
            })()}
        </>
      ) : (
        <DetailBlock label="Domain">
          <Text size="xs" c="dimmed" fs="italic">No domain configured</Text>
        </DetailBlock>
      )}

      {isNpanelType(service.type) &&
        (service.nsiteSiteNpub ||
          service.nsiteSiteD ||
          (!service.nsiteSiteNpub && service.nsiteManifestEventId)) && (
          <Stack gap="md">
            {service.nsiteSiteNpub && (() => {
              const raw = service.nsiteSiteNpub.trim();
              const hex = parsePubkeyHex(raw);
              if (!hex) {
                return (
                  <DetailBlock label="Publishing key">
                    <Group gap="xs" wrap="wrap" align="flex-start">
                      <Text size="xs" ff="monospace" style={{ flex: '1 1 12rem', minWidth: 0, ...monoBreakable }} title={raw}>
                        {raw}
                      </Text>
                      <CopyControl text={raw} onCopy={onCopy} tooltip="copy publishing key" />
                    </Group>
                  </DetailBlock>
                );
              }
              const npub = nip19.npubEncode(hex);
              const storedAsHex = /^[0-9a-f]{64}$/i.test(raw);
              const hexRow = (
                <DetailBlock key="pub-hex" label="Pubkey (hex)">
                  <Group gap="xs" wrap="wrap" align="flex-start">
                    <Text size="xs" ff="monospace" style={{ flex: '1 1 12rem', minWidth: 0, ...monoBreakable }} title={hex}>
                      {hex}
                    </Text>
                    <CopyControl text={hex} onCopy={onCopy} tooltip="copy pubkey hex" />
                  </Group>
                </DetailBlock>
              );
              const npubRow = (
                <DetailBlock key="npub" label="Npub">
                  <Group gap="xs" wrap="wrap" align="flex-start">
                    <Text size="xs" ff="monospace" style={{ flex: '1 1 12rem', minWidth: 0, ...monoBreakable }} title={npub}>
                      {npub}
                    </Text>
                    <CopyControl text={npub} onCopy={onCopy} tooltip="copy npub" />
                  </Group>
                </DetailBlock>
              );
              return storedAsHex ? (
                <>
                  {hexRow}
                  {npubRow}
                </>
              ) : (
                <>
                  {npubRow}
                  {hexRow}
                </>
              );
            })()}
            {service.nsiteSiteD && (
              <DetailBlock label="Site id">
                <Group gap="xs" wrap="wrap" align="flex-start">
                  <Text size="xs" ff="monospace" style={{ flex: '1 1 12rem', minWidth: 0, ...monoBreakable }} title={service.nsiteSiteD}>
                    {service.nsiteSiteD}
                  </Text>
                  <CopyControl text={service.nsiteSiteD} onCopy={onCopy} tooltip="copy site id" />
                </Group>
              </DetailBlock>
            )}
            {!service.nsiteSiteNpub && service.nsiteManifestEventId && (
              <DetailBlock label="Manifest id">
                <Group gap="xs" wrap="wrap" align="flex-start">
                  <Text size="xs" ff="monospace" style={{ flex: '1 1 12rem', minWidth: 0, ...monoBreakable }} title={service.nsiteManifestEventId}>
                    {service.nsiteManifestEventId}
                  </Text>
                  <CopyControl text={service.nsiteManifestEventId} onCopy={onCopy} tooltip="copy manifest id" />
                </Group>
              </DetailBlock>
            )}
          </Stack>
        )}

      {hasConfig && (
        <Stack gap="md">
          {whitelistedKinds.length > 0 && (
            <DetailBlock label="Kinds +">
              <Group gap={4} wrap="wrap">
                {whitelistedKinds.map((k) => (
                  <Badge key={k} variant="light" color="green" size="xs">{k}</Badge>
                ))}
              </Group>
            </DetailBlock>
          )}
          {blacklistedKinds.length > 0 && (
            <DetailBlock label="Kinds -">
              <Group gap={4} wrap="wrap">
                {blacklistedKinds.map((k) => (
                  <Badge key={k} variant="light" color="red" size="xs">{k}</Badge>
                ))}
              </Group>
            </DetailBlock>
          )}
          {whitelistedPubkeys.length > 0 && (
            <DetailBlock label="Pubkeys +">
              <Group gap={4} wrap="wrap">
                {whitelistedPubkeys.map((p) => (
                  <Badge key={p} variant="light" color="green" size="xs">{p.slice(0, 8)}…</Badge>
                ))}
              </Group>
            </DetailBlock>
          )}
          {requireNip42 && (
            <DetailBlock label="Auth">
              <Badge color="relaykit" variant="light">NIP-42 required</Badge>
            </DetailBlock>
          )}
        </Stack>
      )}

      <DetailBlock label="Created">
        <Stack gap={2}>
          <Text size="sm">{createdStr}</Text>
          <Text size="xs" c="dimmed" fs="italic">{createdAgo}</Text>
        </Stack>
      </DetailBlock>
    </Stack>
  );
};

const ServiceDetailsInsights = ({
  composeId,
  serviceType,
  presetId,
}: {
  composeId: string;
  serviceType?: string | null;
  presetId?: string | null;
}) => {
  const [insights, setInsights] = useState<Awaited<ReturnType<typeof trpc.getServiceInsights.query>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loaderColor = serviceTypeToRubixLoaderColor(serviceType, presetId);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const next = await trpc.getServiceInsights.query({ composeId });
        if (!mounted) return;
        setInsights(next);
        setError(null);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || 'Could not load service insights');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    const poll = window.setInterval(() => {
      void load();
    }, 30000);
    return () => {
      mounted = false;
      window.clearInterval(poll);
    };
  }, [composeId]);

  if (loading && !insights) {
    return (
      <Stack align="center" justify="center" gap="sm" style={{ minHeight: rem(220) }}>
        <RubixLoader size={128} colors={[loaderColor]} speed={1.35} />
        <Text size="sm" c="dimmed">loading service insights…</Text>
      </Stack>
    );
  }

  if (error && !insights) {
    return (
      <Paper withBorder p="md">
        <Text fw={500} c="red">could not load service insights</Text>
        <Text size="xs" c="dimmed" mt={4}>{error}</Text>
      </Paper>
    );
  }

  if (!insights) return null;

  const { current, thresholds } = insights;
  const cpuSeverity = getInsightSeverity(current.cpuPct, thresholds.cpu.warn, thresholds.cpu.critical);
  const memSeverity = getInsightSeverity(current.memoryUsedPct, thresholds.memory.warn, thresholds.memory.critical);
  const overallSeverity = getOverallSeverity([cpuSeverity, memSeverity]);
  const overallHealth = overallSeverity === 'critical'
    ? { label: 'critical', color: 'red', icon: <IconAlertOctagon size={14} /> }
    : overallSeverity === 'warn'
      ? { label: 'watch', color: 'yellow', icon: <IconAlertTriangle size={14} /> }
      : { label: 'healthy', color: 'green', icon: <IconCircleCheck size={14} /> };

  const chartData = insights.history.map((point, idx, arr) => {
    const prev = arr[idx - 1];
    const deltaSec = prev ? Math.max(1, (point.ts - prev.ts) / 1000) : Math.max(1, insights.sampleIntervalMs / 1000);
    const netRxRate = prev ? Math.max(0, (point.networkInBytes - prev.networkInBytes) / deltaSec) : 0;
    const netTxRate = prev ? Math.max(0, (point.networkOutBytes - prev.networkOutBytes) / deltaSec) : 0;
    const ioReadRate = prev ? Math.max(0, (point.blockReadBytes - prev.blockReadBytes) / deltaSec) : 0;
    const ioWriteRate = prev ? Math.max(0, (point.blockWriteBytes - prev.blockWriteBytes) / deltaSec) : 0;
    return {
      time: new Date(point.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      cpu: Number(point.cpuPct.toFixed(1)),
      memory: Number(point.memoryUsedPct.toFixed(1)),
      rx: netRxRate,
      tx: netTxRate,
      ioRead: ioReadRate,
      ioWrite: ioWriteRate,
    };
  });

  const latest = chartData[chartData.length - 1];
  const historyWindowSec = Math.max(0, Math.round((chartData.length * insights.sampleIntervalMs) / 1000));
  const historyWindowLabel = formatWindow(historyWindowSec);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Text fw={600}>service runtime</Text>
          <Text size="xs" c="dimmed">Container: {insights.appName}</Text>
        </Stack>
        <Badge variant="filled" color={overallHealth.color} leftSection={overallHealth.icon}>
          health: {overallHealth.label}
        </Badge>
      </Group>

      {error && (
        <Text size="xs" c="dimmed">Last refresh error: {error}</Text>
      )}

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
        <Paper withBorder p="lg">
          <Group justify="space-between" mb={6}>
            <Text fw={600}>cpu</Text>
            <Badge variant="filled" color={getSeverityColor(cpuSeverity)}>{cpuSeverity}</Badge>
          </Group>
          <Text size="xl" fw={700}>{formatPercent(current.cpuPct)}</Text>
        </Paper>
        <Paper withBorder p="lg">
          <Group justify="space-between" mb={6}>
            <Text fw={600}>memory</Text>
            <Badge variant="filled" color={getSeverityColor(memSeverity)}>{memSeverity}</Badge>
          </Group>
          <Text size="xl" fw={700}>{formatPercent(current.memoryUsedPct)}</Text>
          <Text size="xs" c="dimmed" mt={4}>
            {formatBytes(current.memoryUsedBytes)} / {formatBytes(current.memoryTotalBytes)}
          </Text>
        </Paper>
        <Paper withBorder p="lg">
          <Text fw={600}>network + disk i/o</Text>
          <Text size="sm" mt={8}>In: {formatBytesPerSecond(latest?.rx || 0)}</Text>
          <Text size="sm">Out: {formatBytesPerSecond(latest?.tx || 0)}</Text>
          <Text size="xs" c="dimmed" mt={8}>
            Disk read {formatBytesPerSecond(latest?.ioRead || 0)} | write {formatBytesPerSecond(latest?.ioWrite || 0)}
          </Text>
        </Paper>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
        <Paper withBorder p="lg">
          <Text fw={600} mb="sm">cpu trend</Text>
          <LineChart
            h={200}
            data={chartData}
            dataKey="time"
            series={[{ name: 'cpu', color: 'relaykit' }]}
            withDots={false}
            withLegend={false}
            yAxisProps={{ domain: [0, 100] }}
            tooltipProps={{ cursor: false }}
            valueFormatter={(value) => formatPercent(value)}
          />
          <Text size="xs" c="dimmed" mt={8}>Window: last {historyWindowLabel}</Text>
        </Paper>
        <Paper withBorder p="lg">
          <Text fw={600} mb="sm">memory trend</Text>
          <LineChart
            h={200}
            data={chartData}
            dataKey="time"
            series={[{ name: 'memory', color: 'blue' }]}
            withDots={false}
            withLegend={false}
            yAxisProps={{ domain: [0, 100] }}
            tooltipProps={{ cursor: false }}
            valueFormatter={(value) => formatPercent(value)}
          />
          <Text size="xs" c="dimmed" mt={8}>Window: last {historyWindowLabel}</Text>
        </Paper>
        <Paper withBorder p="lg">
          <Text fw={600} mb="sm">network trend</Text>
          <LineChart
            h={200}
            data={chartData}
            dataKey="time"
            series={[
              { name: 'rx', color: 'teal', label: 'inbound' },
              { name: 'tx', color: 'grape', label: 'outbound' },
            ]}
            withDots={false}
            withLegend
            tooltipProps={{ cursor: false }}
            valueFormatter={(value) => formatBytesPerSecond(value)}
          />
          <Text size="xs" c="dimmed" mt={8}>Window: last {historyWindowLabel}</Text>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
};

const ServiceDetailsLogs = ({ composeId, serviceType, presetId }: { composeId: string; serviceType?: string; presetId?: string }) => {
  const inModal = useContext(ServiceDetailsModalContext);
  const [logs, setLogs] = useState<Awaited<ReturnType<typeof trpc.getServiceLogs.query>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedContainerIds, setSelectedContainerIds] = useState<string[]>([]);
  const logsPaperRef = useRef<HTMLDivElement>(null);
  const colorScheme = useComputedColorScheme('light');
  const loaderColor = serviceTypeToRubixLoaderColor(serviceType, presetId);
  const containerSwatches = colorScheme === 'dark'
    ? ['cyan', 'grape', 'pink', 'orange', 'teal', 'lime', 'blue', 'yellow']
    : ['blue', 'teal', 'grape', 'pink', 'orange', 'cyan', 'lime', 'indigo'];

  const loadLogs = async () => {
    try {
      const next = await trpc.getServiceLogs.query({ composeId, tail: 200 });
      setLogs(next);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load service logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!mounted) return;
      await loadLogs();
    };
    void load();
    const poll = window.setInterval(() => {
      void load();
    }, 5000);
    return () => {
      mounted = false;
      window.clearInterval(poll);
    };
  }, [composeId]);

  useEffect(() => {
    if (!logs) return;
    const allIds = logs.containers.map((c) => c.containerId);
    setSelectedContainerIds((prev) => {
      if (prev.length === 0) return allIds;
      const keep = prev.filter((id) => allIds.includes(id));
      return keep.length > 0 ? keep : allIds;
    });
  }, [logs]);

  const decoratedContainers = useMemo(() => {
    if (!logs) return [];
    return logs.containers.map((container, idx) => ({
      ...container,
      badgeColor: containerSwatches[idx % containerSwatches.length],
    }));
  }, [logs, containerSwatches]);

  const allContainerIds = decoratedContainers.map((c) => c.containerId);
  const activeContainerIds = selectedContainerIds.length > 0 ? selectedContainerIds : allContainerIds;
  const activeSet = new Set(activeContainerIds);

  const mergedRows = useMemo(() => {
    const rows: Array<{
      key: string;
      ts: number;
      tsText: string;
      message: string;
      containerId: string;
      containerLabel: string;
      badgeColor: string;
      idx: number;
    }> = [];
    let idx = 0;
    for (const container of decoratedContainers) {
      if (!activeSet.has(container.containerId)) continue;
      for (const line of container.lines) {
        const firstSpace = line.indexOf(' ');
        const maybeTs = firstSpace > 0 ? line.slice(0, firstSpace) : '';
        const parsedTs = maybeTs ? Date.parse(maybeTs) : Number.NaN;
        const hasTs = Number.isFinite(parsedTs);
        rows.push({
          key: `${container.containerId}:${idx}`,
          ts: hasTs ? Number(parsedTs) : 0,
          tsText: hasTs ? maybeTs : '',
          message: hasTs ? line.slice(firstSpace + 1) : line,
          containerId: container.containerId,
          containerLabel: container.service || container.name,
          badgeColor: container.badgeColor,
          idx,
        });
        idx += 1;
      }
    }
    rows.sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      return a.idx - b.idx;
    });
    return rows;
  }, [decoratedContainers, activeSet]);

  if (loading && !logs) {
    return (
      <Stack align="center" justify="center" gap="sm" style={{ minHeight: rem(220) }}>
        <RubixLoader size={128} colors={[loaderColor]} speed={1.35} />
        <Text size="sm" c="dimmed">Loading service logs…</Text>
      </Stack>
    );
  }

  if (error && !logs) {
    return (
      <Paper withBorder p="md">
        <Text fw={500} c="red">Could not load service logs</Text>
        <Text size="xs" c="dimmed" mt={4}>{error}</Text>
      </Paper>
    );
  }

  if (!logs) return null;

  const stackFill = inModal
    ? {
        flex: '1 1 0%',
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column' as const,
        overflow: 'hidden',
      }
    : undefined

  return (
    <Stack gap="md" style={stackFill}>
      <Group justify="space-between" align="center">
        <Stack gap={2}>
          <Text fw={600}>service logs</Text>
          <Text size="xs" c="dimmed">
            tail {logs.tail} lines per container • updated {formatDistanceToNow(new Date(logs.fetchedAt), { addSuffix: true })}
          </Text>
        </Stack>
        <ActionIcon variant="subtle" color="relaykit" onClick={() => void loadLogs()} aria-label="refresh logs">
          <IconRefresh size={16} />
        </ActionIcon>
      </Group>

      <Group gap={6} wrap="wrap">
        <Badge
          variant={activeContainerIds.length === allContainerIds.length ? 'filled' : 'light'}
          color="relaykit"
          style={{ cursor: 'pointer' }}
          onClick={() => setSelectedContainerIds(allContainerIds)}
        >
          all
        </Badge>
        {decoratedContainers.map((container) => {
          const active = activeSet.has(container.containerId);
          return (
            <Badge
              key={container.containerId}
              variant={active ? 'filled' : 'light'}
              color={container.badgeColor}
              style={{ cursor: 'pointer', opacity: active ? 1 : 0.55 }}
              onClick={() =>
                setSelectedContainerIds((prev) =>
                  prev.includes(container.containerId)
                    ? prev.filter((id) => id !== container.containerId)
                    : [...prev, container.containerId]
                )
              }
            >
              {container.service}
            </Badge>
          );
        })}
      </Group>

      {decoratedContainers.some((container) => !!container.error) && (
        <Stack gap={4}>
          {decoratedContainers
            .filter((container) => !!container.error)
            .map((container) => (
              <Text key={container.containerId} size="xs" c="dimmed">
                {container.service}: {container.error}
              </Text>
            ))}
        </Stack>
      )}

      <Paper 
        ref={logsPaperRef} 
        withBorder 
        p="sm" 
        style={{ 
          ...(inModal ? { flex: '1 1 0%', minHeight: 0, minWidth: 0 } : { maxHeight: rem(320) }),
          overflowY: 'scroll',
          overflowAnchor: 'none',
          scrollbarGutter: 'stable',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--mantine-color-gray-5) var(--mantine-color-gray-2)',
        }}
      >
        {mergedRows.length === 0 ? (
          <Text size="xs" c="dimmed">No logs available for current filter.</Text>
        ) : (
          <Stack gap={2}>
            {mergedRows.map((row) => (
              <Text key={row.key} size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <Text component="span" fw={700} c={row.badgeColor}>
                  [{row.containerLabel}]
                </Text>
                {row.tsText ? (
                  <>
                    <Text component="span"> </Text>
                    <Text component="span" c="dimmed">
                      {row.tsText}
                    </Text>
                  </>
                ) : null}
                <Text component="span"> {row.message}</Text>
              </Text>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
};

const ServiceDetailsConfig = ({ service, onSaved }: { service: any; onSaved?: () => void }) => {
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<any[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    trpc.getServiceConfig
      .query({ composeId: service.composeId })
      .then((r) => {
        if (cancelled) return;
        setFields(r.fields || []);
        setValues(r.config || {});
      })
      .catch((e: any) => {
        if (!cancelled) toast.error(`failed to load config: ${e.message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [service.composeId]);

  const submit = async (next: Record<string, string>) => {
    setSaving(true);
    try {
      const toSave = isNpanelType(service.type) ? prepareNsiteConfigForSave(next) : next;
      await trpc.updateServiceConfig.mutate({ composeId: service.composeId, config: toSave });
      toast.success('config updated and redeployed');
      onSaved?.();
    } catch (e: any) {
      toast.error(`failed to update config: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Text size="sm" c="dimmed">loading config…</Text>;
  if (fields.length === 0) return <Text size="sm" c="dimmed">no editable config for this service.</Text>;

  return (
    <ServiceConfigEditor service={service} fields={fields} initialValues={values} saving={saving} onSubmit={submit} />
  );
};

export const ServiceDetailsContent = (props: ServiceDetailsContentProps) => {
  const { service, serverIp } = props;
  const inModal = useContext(ServiceDetailsModalContext);
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme('light');
  const domain = service.domains?.[0];
  const hasDNS = domain && serverIp;
  const hasInsights = !!service.composeId;
  const hasLogs = !!service.composeId;
  const canEditConfig = !!service.canEditConfig;
  const activePanelBg = colorScheme === 'dark' ? theme.colors.dark[8] : theme.colors.gray[0];
  const panelShadow = colorScheme === 'dark'
    ? '0 4px 12px rgba(0,0,0,0.18)'
    : '0 4px 12px rgba(15,23,42,0.06)';
  const activeTabBg = activePanelBg;
  const activeTabColor = colorScheme === 'dark' ? theme.white : theme.black;
  const inactiveTabColor = colorScheme === 'dark' ? theme.colors.gray[4] : theme.colors.gray[7];
  const tabsRailBg = 'transparent';
  const inactiveTabHoverBg = colorScheme === 'dark' ? theme.colors.dark[7] : theme.colors.gray[1];
  const activeTabAccent = theme.colors.relaykit[6];
  const panelContentStyle = {
    minWidth: 0,
    paddingTop: rem(18),
    paddingRight: rem(18),
    paddingBottom: rem(18),
    paddingLeft: rem(24),
    background: activePanelBg,
  };
  const getTabStyle = (active: boolean) => ({
    background: active ? activeTabBg : 'transparent',
    color: active ? activeTabColor : inactiveTabColor,
    boxShadow: active ? `inset 3px 0 0 ${activeTabAccent}` : 'none',
  });

  const [section, setSection] = useState(
    props.initialSection && (props.initialSection !== 'config' || canEditConfig) ? props.initialSection : 'info',
  );
  const innerRef = useRef<HTMLDivElement>(null);
  const [shellH, setShellH] = useState<number | null>(null);
  const [maxShellH, setMaxShellH] = useState<number>(0);
  // logs and config can be tall/dynamic — let them fill the modal and scroll internally instead of forcing
  // the animated fixed-height shell (which would clip them with no scrollbar).
  const fillLayout = inModal && (section === 'logs' || section === 'config')

  useLayoutEffect(() => {
    if (fillLayout) return
    const el = innerRef.current;
    if (!el) return;
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      setShellH(h);
      setMaxShellH((prev) => (h > prev ? h : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fillLayout, section]);

  const stretch = fillLayout ? ({ flex: '1 1 0%', minHeight: 0, minWidth: 0 } as const) : null

  const shellStyle = stretch
    ? { ...stretch, display: 'flex' as const, flexDirection: 'column' as const, overflow: 'hidden' as const }
    : {
        height: shellH != null ? Math.max(shellH, maxShellH) : undefined,
        transition: shellH != null ? `height ${HEIGHT_EASE}` : undefined,
        overflow: 'hidden' as const,
      }

  return (
    <Box style={shellStyle}>
      <Box
        ref={innerRef}
        style={stretch ? { ...stretch, display: 'flex', flexDirection: 'column' } : undefined}
      >
        <Tabs
          value={section}
          onChange={(v) => v != null && setSection(v)}
          orientation="vertical"
          variant="unstyled"
          styles={{
            root: {
              width: '100%',
              ...(stretch ? { ...stretch, display: 'flex', flexDirection: 'row', alignItems: 'stretch' } : {}),
            },
            list: {
              border: 'none',
              background: tabsRailBg,
            },
            tab: {
              color: inactiveTabColor,
              fontWeight: 500,
              paddingInline: rem(22),
              paddingBlock: rem(13),
              transition: 'background-color 120ms ease, color 120ms ease',
              '&:hover': {
                background: inactiveTabHoverBg,
              },
            },
          }}
        >
          <Group
            align="stretch"
            gap={0}
            wrap="nowrap"
            w="100%"
            style={stretch ? { ...stretch } : undefined}
          >
            <Tabs.List aria-label="Details sections" miw={rem(132)} style={{ flexShrink: 0 }}>
              <Tabs.Tab value="info" style={getTabStyle(section === 'info')}>info</Tabs.Tab>
              {canEditConfig && (
                <Tabs.Tab value="config" style={getTabStyle(section === 'config')}>config</Tabs.Tab>
              )}
              <Tabs.Tab value="dns" style={getTabStyle(section === 'dns')}>dns</Tabs.Tab>
              <Tabs.Tab value="insights" style={getTabStyle(section === 'insights')}>insights</Tabs.Tab>
              <Tabs.Tab value="logs" style={getTabStyle(section === 'logs')}>logs</Tabs.Tab>
            </Tabs.List>
            <Box
              style={{
                background: activePanelBg,
                boxShadow: panelShadow,
                ...(stretch ? { ...stretch, display: 'flex', flexDirection: 'column', overflow: 'hidden' } : { flex: 1, minWidth: 0 }),
              }}
            >
              <Transition transition="fade" duration={FADE_MS} exitDuration={0} mounted={section === 'info'}>
                {(tStyle) => (
                  <Box style={{ ...panelContentStyle, ...tStyle }}>
                    <ServiceDetailsInfo {...props} />
                  </Box>
                )}
              </Transition>
              {canEditConfig && (
                <Transition transition="fade" duration={FADE_MS} exitDuration={0} mounted={section === 'config'}>
                  {(tStyle) => (
                    <Box
                      style={{
                        ...panelContentStyle,
                        ...tStyle,
                        ...(stretch ? { ...stretch, overflowY: 'auto' as const } : {}),
                      }}
                    >
                      <ServiceDetailsConfig service={service} onSaved={props.onConfigSaved} />
                    </Box>
                  )}
                </Transition>
              )}
              <Transition transition="fade" duration={FADE_MS} exitDuration={0} mounted={section === 'dns'}>
                {(tStyle) => (
                  <Box style={{ ...panelContentStyle, ...tStyle }}>
                    {hasDNS ? (
                      <ServiceDetailsDns
                        service={service}
                        domain={domain}
                        serverIp={serverIp}
                        onCopy={props.onCopy}
                      />
                    ) : null}
                  </Box>
                )}
              </Transition>
              <Transition transition="fade" duration={FADE_MS} exitDuration={0} mounted={section === 'insights'}>
                {(tStyle) => (
                  <Box style={{ ...panelContentStyle, ...tStyle }}>
                    {hasInsights ? (
                      <ServiceDetailsInsights
                        composeId={service.composeId}
                        serviceType={service.type}
                        presetId={service.presetId}
                      />
                    ) : null}
                  </Box>
                )}
              </Transition>
              <Transition transition="fade" duration={FADE_MS} exitDuration={0} mounted={section === 'logs'}>
                {(tStyle) => (
                  <Box
                    style={{
                      ...panelContentStyle,
                      ...tStyle,
                      ...(stretch ? { ...stretch, display: 'flex', flexDirection: 'column', overflow: 'hidden' } : {}),
                    }}
                  >
                    {hasLogs ? (
                      <ServiceDetailsLogs composeId={service.composeId} serviceType={service.type} presetId={service.presetId} />
                    ) : null}
                  </Box>
                )}
              </Transition>
            </Box>
          </Group>
        </Tabs>
      </Box>
    </Box>
  );
};
