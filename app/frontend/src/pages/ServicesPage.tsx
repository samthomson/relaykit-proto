import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { toast } from 'sonner';
import { RubixLoader, RubixLoaderColor } from '@samthomson/rubix-loader';
import { trpc } from '../trpc';
import { useAuth } from '../contexts/AuthContext';
import { useDokploy } from '../contexts/DokployContext';
import { useRefreshServices } from '../contexts/RefreshServicesContext';
import {
  SERVICE_TYPE,
  isNpanelType,
  isRelayType,
} from '../../../shared/serviceType';
import { EmbeddedAppModal } from '../embedded/EmbeddedAppModal';
import { AddServicePresetModal } from '../components/AddServicePresetModal';
import { NsiteDeployFields, buildNsiteDeployDefaults, prepareNsiteConfigForSave } from '../components/NsiteDeployFields';
import { DomainField, NpubField, RelaysField } from '../components/PresetFieldInputs';
import { NpanelSiteIdentity } from '../components/NpanelSiteIdentity';
import { ServiceDetailsContent, ServiceDetailsModalContext } from '../components/ServiceDetailsContent';
import { InlineTextEditRow, INLINE_TITLE_ROW_H } from '../components/InlineTextEditRow';
import { ServiceHostTitleView } from '../components/ServiceHostTitleView';
import { CopyControl } from '../components/CopyControl';
import { serviceTypeToRubixLoaderColor } from '../lib/serviceTypeColor';
import {
  Button,
  Text,
  Modal,
  Group,
  Badge,
  ActionIcon,
  TextInput,
  Select,
  Stack,
  Paper,
  Anchor,
  Card,
  Tooltip,
  SegmentedControl,
  Box,
  SimpleGrid,
  rem,
  Switch,
  useComputedColorScheme,
  useMantineTheme,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { DropdownButton } from '@relaykit/ui';
import {
  IconExternalLink,
  IconPencil,
  IconCpu,
  IconDatabase,
  IconServer,
  IconKey,
  IconAlertTriangle,
} from '@tabler/icons-react';

const serviceDetailsModalStyles = {
  content: { maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 },
  body: { flex: '1 1 0%', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
} as const;

const formatPercentRounded = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${Math.round(value)}%`
}

const formatBytesRounded = (bytes: number | null): string => {
  if (bytes === null || !Number.isFinite(bytes)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = Math.max(0, bytes)
  let idx = 0
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024
    idx += 1
  }
  return `${Math.round(size)}${units[idx]}`
}

const formatBytesPerSecondRounded = (bytesPerSec: number | null): string => {
  if (bytesPerSec === null || !Number.isFinite(bytesPerSec)) return '—'
  return `${formatBytesRounded(bytesPerSec)}/s`
}

const isImageIcon = (icon: string): boolean =>
  /^https?:\/\//.test(icon) || icon.startsWith('/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(icon)

const renderIcon = (icon: string | undefined, size: number): ReactNode => {
  if (!icon) return null
  if (!isImageIcon(icon)) return <span style={{ fontSize: Math.max(12, size - 6), lineHeight: 1 }}>{icon}</span>
  return (
    <img
      src={icon}
      alt=""
      style={{ width: size, height: size, objectFit: 'contain', borderRadius: 4 }}
    />
  )
}

const ServiceTypeIcon = ({ service, size, marginRight }: { service: any; size: number; marginRight?: number }) => {
  if (!service.icon) return null;
  const accent = serviceTypeToRubixLoaderColor(service.type, service.presetId);
  const tip = service.brokenPreset
    ? 'misconfigured service'
    : String(service.serviceType || service.type || 'service');
  return (
    <Tooltip label={tip} withArrow>
      <Box
        component="span"
        style={{
          display: 'inline-flex',
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginRight: marginRight ?? 0,
          marginTop: size >= 22 ? 3 : undefined,
          color: accent,
          lineHeight: 1,
        }}
      >
        {renderIcon(service.icon, size)}
      </Box>
    </Tooltip>
  );
};

const CogMenu = ({
  items,
  showLabel = false,
}: {
  items: { label: string; onClick: () => void; danger?: boolean }[];
  /** Bordered “Actions” button; otherwise icon-only chevron (overview / tight rows). */
  showLabel?: boolean;
}) => (
  <DropdownButton
    variant="default"
    size="sm"
    menuWidth={200}
    iconOnly={!showLabel}
    tooltip={showLabel ? undefined : 'actions'}
    items={items.map((item, i) => ({
      id: String(i),
      label: item.label,
      color: item.danger ? 'red' : undefined,
      onSelect: item.onClick,
    }))}
  >
    actions
  </DropdownButton>
);

const ConfirmModal = ({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = false,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) => (
  <Modal opened onClose={onCancel} title={title} centered size="sm">
    <Text size="sm" c="dimmed" mb="lg">
      {message}
    </Text>
    <Group justify="flex-end">
      <Button variant="default" onClick={onCancel}>cancel</Button>
      <Button color={danger ? 'red' : 'relaykit'} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </Group>
  </Modal>
);

const InlineMetric = ({ label, value, icon }: { label: string; value: string; icon: ReactNode }) => (
  <Tooltip label={label} withArrow>
    <Group
      gap={5}
      wrap="nowrap"
      style={{
        width: 'fit-content',
      }}
    >
      <Box c="dimmed" style={{ display: 'inline-flex', alignItems: 'center' }}>
        {icon}
      </Box>
      <Text size="xs" c="dimmed" fw={500} lh={1.1} style={{ whiteSpace: 'nowrap' }}>{value}</Text>
    </Group>
  </Tooltip>
);

const FlowDot = ({ label, value, color }: { label: string; value: number | null; color: string }) => {
  const active = Number(value) > 0
  return (
    <Tooltip label={`${label}: ${formatBytesPerSecondRounded(value)}`} withArrow>
      <Box
        style={{
          width: 9,
          height: 9,
          borderRadius: 999,
          border: '1px solid var(--mantine-color-gray-5)',
          background: active ? `var(--mantine-color-${color}-5)` : 'transparent',
        }}
      />
    </Tooltip>
  )
}

const MoveServiceModal = ({
  serviceName,
  currentLocation,
  currentEnvironmentId,
  targets,
  onSelect,
  onClose,
}: {
  serviceName: string;
  currentLocation: string;
  currentEnvironmentId: string;
  targets: { environmentId: string; label: string }[];
  onSelect: (environmentId: string) => void;
  onClose: () => void;
}) => {
  const [selectedTarget, setSelectedTarget] = useState<{ environmentId: string; label: string; fullLabel: string } | null>(null);
  const groupedTargets = targets.reduce<Record<string, { environmentId: string; label: string; fullLabel: string }[]>>((acc, target) => {
    const [projectName, environmentName] = target.label.includes(' → ')
      ? target.label.split(' → ')
      : ['Other', target.label];
    if (!acc[projectName]) acc[projectName] = [];
    acc[projectName].push({
      environmentId: target.environmentId,
      label: environmentName || target.label,
      fullLabel: target.label,
    });
    return acc;
  }, {});

  const groupNames = Object.keys(groupedTargets);

  return (
    <Modal opened onClose={onClose} title="move service" size="lg" centered>
      <Text size="sm" c="dimmed" mb="md">
        Select a target environment for <Text component="span" ff="monospace">{serviceName}</Text>{' '}
        <Text component="span" fs="italic">(currently in {currentLocation})</Text>.
      </Text>
      <Stack gap="sm" maw={700} style={{ maxHeight: 300, overflowY: 'auto' }}>
        {groupNames.map((groupName) => (
          <Paper key={groupName} p="sm" withBorder>
            <Text size="xs" tt="uppercase" fw={500} c="dimmed" mb="xs">{groupName}</Text>
            <Group gap="xs">
              {groupedTargets[groupName].map((target) => (
                <Badge
                  key={target.environmentId}
                  variant={selectedTarget?.environmentId === target.environmentId ? 'filled' : 'outline'}
                  color={target.environmentId === currentEnvironmentId ? 'gray' : 'relaykit'}
                  style={{ cursor: target.environmentId === currentEnvironmentId ? 'not-allowed' : 'pointer' }}
                  onClick={() => {
                    if (target.environmentId !== currentEnvironmentId) {
                      setSelectedTarget((prev) =>
                        prev?.environmentId === target.environmentId ? null : target
                      );
                    }
                  }}
                >
                  {target.label}
                </Badge>
              ))}
            </Group>
          </Paper>
        ))}
      </Stack>
      <Paper p="sm" withBorder mt="md">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Move to environment:{' '}
            <Text component="span" fw={500}>{selectedTarget ? selectedTarget.fullLabel : '—'}</Text>
          </Text>
          <Button
            color="relaykit"
            disabled={!selectedTarget}
            onClick={() => selectedTarget && onSelect(selectedTarget.environmentId)}
          >
            confirm move
          </Button>
        </Group>
      </Paper>
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose}>cancel</Button>
      </Group>
    </Modal>
  );
};

const AddServiceButton = ({
  preselectedEnvironmentId,
  compact = false,
}: {
  preselectedEnvironmentId?: string;
  compact?: boolean;
}) => {
  const { triggerRefresh, refreshTrigger } = useRefreshServices();
  const { npub } = useAuth();
  const [presets, setPresets] = useState<any[]>([]);
  const [instanceHost, setInstanceHost] = useState<string | null>(null);
  const [environments, setEnvironments] = useState<{ environmentId: string; label: string }[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<any>(null);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState('');
  const [deployConfig, setDeployConfig] = useState<Record<string, string>>({});
  const [deployResult, setDeployResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [presetsResult, projectsResult] = await Promise.all([
          trpc.listPresets.query(undefined),
          trpc.listProjects.query(),
        ]);
        if (!alive) return;
        setPresets(presetsResult.presets);
        setInstanceHost(presetsResult.instanceHost);
        setEnvironments(
          projectsResult.flatMap((p: any) =>
            p.environments.map((e: any) => ({ environmentId: e.environmentId, label: `${p.name} → ${e.name}` })),
          ),
        );
      } catch (error) {
        console.error('Error loading deploy data:', error);
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshTrigger]);

  const handleSelectPreset = (preset: any) => {
    setPickerOpen(false);
    setSelectedPreset(preset);
    const isNsite = isNpanelType(preset.id);
    const defaults = isNsite
      ? buildNsiteDeployDefaults(preset, npub)
      : Object.fromEntries(
          preset.requiredConfig
            .filter((f: any) => f.default !== undefined && f.default !== null && String(f.default).length > 0)
            .map((f: any) => [f.id, f.default]),
        );
    setDeployConfig(defaults);
    setDeployResult(null);
    setSelectedEnvironmentId(preselectedEnvironmentId ?? '');
    setDeployModalOpen(true);
  };

  const handleDeploy = async (payload: { environmentId: string; config: Record<string, string> }) => {
    setLoading(true);
    setDeployResult(null);
    try {
      const isNsite = isNpanelType(selectedPreset.id);
      const config = isNsite ? prepareNsiteConfigForSave(payload.config) : payload.config;
      await trpc.deployService.mutate({
        presetId: selectedPreset.id,
        config,
        environmentId: payload.environmentId || undefined,
      });
      toast.success('Service deployment started!');
      setDeployModalOpen(false);
      triggerRefresh();
    } catch (error: any) {
      console.error('Deploy error:', error);
      setDeployResult({ error: error.message });
      toast.error(`Deploy failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        color="relaykit"
        size={compact ? 'xs' : 'sm'}
        onClick={() => setPickerOpen(true)}
      >
        add service +
      </Button>
      <AddServicePresetModal
        opened={pickerOpen}
        presets={presets}
        onClose={() => setPickerOpen(false)}
        onSelectPreset={handleSelectPreset}
        renderIcon={renderIcon}
      />
      {deployModalOpen && selectedPreset && (
        <DeployModal
          preset={selectedPreset}
          initialConfig={deployConfig}
          loading={loading}
          deployResult={deployResult}
          onSubmit={handleDeploy}
          onClose={() => setDeployModalOpen(false)}
          environments={environments}
          initialEnvironmentId={selectedEnvironmentId}
          ownerPubkeyHex={npub}
          instanceHost={instanceHost}
        />
      )}
    </>
  );
};


const ServiceCard = ({
  service,
  serverIp,
  editingDomain,
  newDomainHost,
  setNewDomainHost,
  onEditDomain,
  onSaveDomain,
  onCancelEdit,
  onCopy,
  onStart,
  onStop,
  onDelete,
  onConfigSaved,
  onRefreshNsite,
  onRedeploy,
  onMove,
  allEnvironments,
  availableRelays,
  showDetails,
  summary,
}: {
  service: any;
  serverIp: string | null;
  editingDomain: { composeId: string; domainId: string; currentHost: string } | null;
  newDomainHost: string;
  setNewDomainHost: (v: string) => void;
  onEditDomain: (composeId: string, domain: any) => void;
  onSaveDomain: () => void;
  onCancelEdit: () => void;
  onCopy: (text: string) => void;
  onStart: (composeId: string) => void;
  onStop: (composeId: string) => void;
  onDelete: (composeId: string, name: string) => void;
  onConfigSaved: () => void;
  onRefreshNsite: (composeId: string) => void;
  onRedeploy: (composeId: string) => void;
  onMove: (composeId: string, targetEnvironmentId: string) => void;
  allEnvironments: { environmentId: string; label: string }[];
  availableRelays: string[];
  showDetails: boolean;
  summary?: {
    cpuPct: number | null;
    memoryUsedPct: number | null;
    memoryUsedBytes: number | null;
    memoryTotalBytes: number | null;
    storageUsedBytes: number | null;
    networkInBps: number | null;
    networkOutBps: number | null;
    blockReadBps: number | null;
    blockWriteBps: number | null;
  } | null;
}) => {
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme('light');
  const serviceCardBg = colorScheme === 'dark' ? theme.colors.dark[5] : theme.white;
  const { npub: ownerNpub } = useAuth();
  const [showExplorer, setShowExplorer] = useState(false);
  const [showBlossomExplorer, setShowBlossomExplorer] = useState(false);
  const [showNsiteExplorer, setShowNsiteExplorer] = useState(false);
  const [showGraspExplorer, setShowGraspExplorer] = useState(false);
  const [showNotifApp, setShowNotifApp] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [detailsInitialSection, setDetailsInitialSection] = useState('info');
  const openConfig = () => {
    if (isEditing) onCancelEdit();
    setDetailsInitialSection('config');
    setDetailsModalOpen(true);
  };
  const openDetails = () => {
    if (isEditing) onCancelEdit();
    setDetailsInitialSection('info');
    setDetailsModalOpen(true);
  };
  const domain = service.domains?.[0];
  const isEditing = editingDomain?.domainId === domain?.domainId;
  const npanel = isNpanelType(service.type);
  // For npanel the public-facing host is the visitor host; the canonical NIP-5A host is internal addressing.
  const publicHost = (npanel ? service.nsiteVisitorHost || service.nsiteCanonicalHost : null) || domain?.host;
  const canonicalHost = npanel ? service.nsiteCanonicalHost : undefined;
  const showCanonical = npanel && canonicalHost && canonicalHost !== publicHost;
  const httpsUrl = publicHost ? `https://${publicHost}` : '';
  const wssUrl = publicHost ? `wss://${publicHost}` : '';
  // Apps on their own domain get the same context params as registry-embedded ones.
  const notifAppSrc = `${httpsUrl}/?${new URLSearchParams({
    embedded: '1',
    ...(ownerNpub ? { npub: ownerNpub } : {}),
    ...(availableRelays.length > 0 ? { relays: availableRelays.join(',') } : {}),
  })}`;
  const titleHost = domain ? publicHost ?? domain.host : service.name;
  const statusNorm = String(service.status ?? '').toLowerCase();
  const moveTargets = allEnvironments.filter((env) => env.environmentId !== service.environmentId);
  const manageItems: { label: string; onClick: () => void; danger?: boolean }[] = [];
  if (domain && !isEditing) {
    manageItems.push({ label: 'edit domain', onClick: () => onEditDomain(service.composeId, domain) });
  }
  if (service.canEditConfig) {
    manageItems.push({ label: 'edit config', onClick: openConfig });
  }
  if (isNpanelType(service.type)) {
    manageItems.push({ label: 'refresh nsite content', onClick: () => onRefreshNsite(service.composeId) });
  }
  manageItems.push({ label: 'redeploy', onClick: () => onRedeploy(service.composeId) });
  if (statusNorm === 'running') {
    manageItems.push({ label: 'stop', onClick: () => onStop(service.composeId) });
  } else {
    manageItems.push({ label: 'start', onClick: () => onStart(service.composeId) });
  }
  if (moveTargets.length > 0) {
    manageItems.push({ label: 'move service…', onClick: () => setShowMoveModal(true) });
  }
  manageItems.push({ label: 'delete', onClick: () => onDelete(service.composeId, service.name), danger: true });

  const statusColor = statusNorm === 'running' ? 'green' : statusNorm === 'error' ? 'red' : 'gray';
  const isBrokenPreset = !!service.brokenPreset;
  const brokenCardStyle = isBrokenPreset ? { background: 'rgba(255, 59, 48, 0.06)' } : undefined;
  const brokenContentStyle = isBrokenPreset ? { opacity: 0.35, pointerEvents: 'none' as const } : undefined;
  const brokenOverlay = isBrokenPreset ? (
    <Box
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(255, 59, 48, 0.14)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      <Paper p="sm" shadow="sm" style={{ background: 'rgba(255,255,255,0.95)' }}>
        <Group gap={6} align="center" justify="center" wrap="nowrap">
          <IconAlertTriangle size={16} color="var(--mantine-color-red-7)" />
          <Text size="sm" fw={700} c="red">
            misconfigured
          </Text>
      </Group>
      </Paper>
    </Box>
  ) : null;
  const showNip42Badge = isRelayType(service.type) && service.presetId === 'nostr-rs-relay';
  const nip42Enabled = !!service.requireNip42;
  const nip42Badge = showNip42Badge ? (
    <Badge
      variant="light"
      color={nip42Enabled ? 'green' : 'gray'}
      size="xs"
      w="fit-content"
      leftSection={<IconKey size={11} />}
      style={nip42Enabled ? undefined : { textDecoration: 'line-through' }}
    >
      nip-42
    </Badge>
  ) : null;
  const summaryView = summary ?? {
    cpuPct: null,
    memoryUsedPct: null,
    memoryUsedBytes: null,
    memoryTotalBytes: null,
    storageUsedBytes: null,
    networkInBps: null,
    networkOutBps: null,
    blockReadBps: null,
    blockWriteBps: null,
  }

  const detailsContentProps = {
    service,
    serverIp,
    editingDomain,
    newDomainHost,
    setNewDomainHost,
    onEditDomain,
    onSaveDomain,
    onCancelEdit,
    onCopy,
    onOpenRelayExplorer: () => setShowExplorer(true),
    onOpenBlossomExplorer: () => setShowBlossomExplorer(true),
    onOpenNsiteExplorer: () => setShowNsiteExplorer(true),
    onOpenGraspExplorer: () => setShowGraspExplorer(true),
    onConfigSaved,
  };

  return (
    <>
      {showExplorer && domain && (
        <EmbeddedAppModal
          appId="relay-explorer"
          context={{ relay: wssUrl, relays: availableRelays.join(',') }}
          presetId={service.presetId}
          onClose={() => setShowExplorer(false)}
        />
      )}
      {showBlossomExplorer && domain && (
        <EmbeddedAppModal
          appId="blossom-explorer"
          context={{ server: httpsUrl }}
          presetId={service.presetId}
          onClose={() => setShowBlossomExplorer(false)}
        />
      )}
      {showNsiteExplorer && domain && (
        <EmbeddedAppModal
          appId="nsite-explorer"
          context={{
            gateway: httpsUrl,
            pubkey: service.nsiteSiteNpub,
            siteD: service.nsiteSiteD,
            relays: service.nsiteRelays,
          }}
          presetId={service.presetId}
          onClose={() => setShowNsiteExplorer(false)}
        />
      )}
      {showGraspExplorer && domain && (
        <EmbeddedAppModal
          appId="grasp-explorer"
          context={{ relay: wssUrl, server: httpsUrl }}
          presetId={service.presetId}
          onClose={() => setShowGraspExplorer(false)}
        />
      )}
      {showNotifApp && domain && (
        <EmbeddedAppModal
          externalSrc={notifAppSrc}
          externalLabel="pulse"
          presetId={service.presetId}
          onClose={() => setShowNotifApp(false)}
        />
      )}
      {showMoveModal && (
        <MoveServiceModal
          serviceName={service.name}
          currentLocation={`${service.projectName} → ${service.environmentName}`}
          currentEnvironmentId={service.environmentId}
          targets={allEnvironments}
          onClose={() => setShowMoveModal(false)}
          onSelect={(environmentId) => {
            setShowMoveModal(false);
            onMove(service.composeId, environmentId);
          }}
        />
      )}
      <Paper
        withBorder
        p={showDetails ? 'md' : undefined}
        px={showDetails ? undefined : 10}
        py={showDetails ? undefined : 10}
        bg={serviceCardBg}
        style={
          showDetails
            ? brokenCardStyle
            : {
                width: 260,
                maxWidth: '100%',
                flexShrink: 0,
                position: 'relative',
                overflow: 'hidden',
                ...(brokenCardStyle ?? {}),
              }
        }
      >
        {brokenOverlay}
        {showDetails ? (
          <>
            <Group justify="space-between" align="center" wrap="nowrap" gap="sm" style={{ minHeight: INLINE_TITLE_ROW_H }}>
              <Group
                align="center"
                gap="xs"
                wrap="nowrap"
                style={{ minWidth: 0, flex: 1, minHeight: INLINE_TITLE_ROW_H, ...brokenContentStyle }}
              >
                <ServiceTypeIcon service={service} size={20} marginRight={6} />
                <ServiceHostTitleView
                  title={titleHost}
                  density="comfortable"
                  domain={null}
                  canEditConfig={false}
                  composeId={service.composeId}
                  service={service}
                  onEditDomain={onEditDomain}
                  onEditConfig={openConfig}
                  rowStyle={{ flex: 1, minWidth: 0 }}
                  trailing={
                    <Group gap={6} wrap="nowrap">
                      <Badge variant="filled" color={statusColor} size="sm">{statusNorm}</Badge>
                      {npanel && <Badge variant="light" color="relaykit" size="sm">site</Badge>}
                      {nip42Badge}
                    </Group>
                  }
                />
              </Group>
              <Box style={{ position: 'relative', zIndex: 3 }}>
                <CogMenu showLabel items={manageItems} />
              </Box>
            </Group>
            <Stack mt="md" style={brokenContentStyle}>
              <ServiceDetailsContent {...detailsContentProps} />
            </Stack>
          </>
        ) : (
          <>
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                <Group align="flex-start" gap={6} style={{ minWidth: 0, flex: 1, ...brokenContentStyle }}>
                  <ServiceTypeIcon service={service} size={20} />
                  <Stack gap={6} style={{ minWidth: 0, flex: 1 }}>
                    {isEditing && domain ? (
                      <InlineTextEditRow
                        value={newDomainHost}
                        onChange={setNewDomainHost}
                        onSave={() => void onSaveDomain()}
                        onCancel={onCancelEdit}
                        autoFocus
                        inputStyle={{ flex: 1, minWidth: 0 }}
                        rowStyle={{ width: '100%' }}
                      />
                    ) : (
                      <ServiceHostTitleView
                        title={titleHost}
                        density="compact"
                        domain={domain}
                        canEditConfig={service.canEditConfig}
                        composeId={service.composeId}
                        service={service}
                        onEditDomain={onEditDomain}
                        onEditConfig={openConfig}
                        rowStyle={{ minWidth: 0, flex: 1 }}
                      />
                    )}
                    <Group gap={6} wrap="wrap">
                      <Badge variant="filled" color={statusColor} size="xs" w="fit-content">{statusNorm}</Badge>
                      {npanel && <Badge variant="light" color="relaykit" size="xs" w="fit-content">site</Badge>}
                      {nip42Badge}
                    </Group>
                    {npanel && (
                      <NpanelSiteIdentity npubOrHex={service.nsiteSiteNpub} relaysCsv={service.nsiteRelays} />
                    )}
                    {statusNorm === 'running' && (
                      <Stack gap={4}>
                        <Group gap={8} wrap="nowrap">
                          <InlineMetric
                            label={`CPU usage: ${formatPercentRounded(summaryView.cpuPct)}`}
                            value={formatPercentRounded(summaryView.cpuPct)}
                            icon={<IconCpu size={12} />}
                          />
                          <Text size="xs" c="gray.5">•</Text>
                          <InlineMetric
                            label={`Memory used: ${formatBytesRounded(summaryView.memoryUsedBytes)} / ${formatBytesRounded(summaryView.memoryTotalBytes)} (${formatPercentRounded(summaryView.memoryUsedPct)})`}
                            value={formatBytesRounded(summaryView.memoryUsedBytes)}
                            icon={<IconServer size={12} />}
                          />
                          <Text size="xs" c="gray.5">•</Text>
                          <InlineMetric
                            label={`Storage used on disk: ${formatBytesRounded(summaryView.storageUsedBytes)} (writable layer)`}
                            value={formatBytesRounded(summaryView.storageUsedBytes)}
                            icon={<IconDatabase size={12} />}
                          />
                        </Group>
                        <Group gap={7} wrap="nowrap">
                          <FlowDot label="Network inbound throughput" value={summaryView.networkInBps} color="blue" />
                          <FlowDot label="Network outbound throughput" value={summaryView.networkOutBps} color="blue" />
                          <Text size="xs" c="gray.5">•</Text>
                          <FlowDot label="Disk read throughput" value={summaryView.blockReadBps} color="grape" />
                          <FlowDot label="Disk write throughput" value={summaryView.blockWriteBps} color="grape" />
                        </Group>
                      </Stack>
                    )}
                    <Stack gap={6} style={{ minWidth: 0, ...(brokenContentStyle ?? {}) }}>
                      {domain ? (
                        <Stack gap={4} style={{ minWidth: 0 }}>
                          <Group gap={6} wrap="nowrap" align="center" style={{ minWidth: 0, width: '100%' }}>
                            <Anchor
                              href={httpsUrl}
                              target="_blank"
                              size="xs"
                              c="relaykit"
                              style={{
                                flex: '0 1 auto',
                                minWidth: 0,
                                maxWidth: 'calc(100% - 28px)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={httpsUrl}
                            >
                              {httpsUrl} ↗
                            </Anchor>
                            <CopyControl text={httpsUrl} onCopy={onCopy} tooltip="copy https url" style={{ flexShrink: 0 }} />
                          </Group>
                          {isRelayType(service.type) && (
                            <Group gap={6} wrap="nowrap" align="center" style={{ minWidth: 0, width: '100%' }}>
                              <Text
                                size="xs"
                                ff="monospace"
                                c="dimmed"
                                style={{
                                  flex: '0 1 auto',
                                  minWidth: 0,
                                  maxWidth: 'calc(100% - 28px)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                                title={wssUrl}
                              >
                                {wssUrl}
                              </Text>
                              <CopyControl text={wssUrl} onCopy={onCopy} tooltip="copy wss url" style={{ flexShrink: 0 }} />
                            </Group>
                          )}
                          {showCanonical && (
                            <Tooltip label="internal nip-5a host — the gateway uses this to find your site; you don't set it" multiline w={240}>
                              <Text
                                size="xs"
                                ff="monospace"
                                c="dimmed"
                                style={{ minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.7 }}
                                title={canonicalHost}
                              >
                                nip-5a: {canonicalHost}
                              </Text>
                            </Tooltip>
                          )}
                        </Stack>
                      ) : (
                        <Text size="xs" c="dimmed" fs="italic">No domain configured</Text>
                      )}
                      <Group gap="xs" wrap="wrap">
                        <Button
                          size="xs"
                          variant="light"
                          color="gray"
                          onClick={openDetails}
                          style={{ flexShrink: 0 }}
                        >
                          config
                        </Button>
                        {domain && isRelayType(service.type) && (
                          <Button
                            size="xs"
                            variant="light"
                            color="relaykit"
                            onClick={() => setShowExplorer(true)}
                            rightSection={<IconExternalLink size={12} />}
                            style={{ flexShrink: 0 }}
                          >
                            data
                          </Button>
                        )}
                        {domain && service.type === SERVICE_TYPE.BLOSSOM && (
                          <Button
                            size="xs"
                            variant="light"
                            color="relaykit"
                            onClick={() => setShowBlossomExplorer(true)}
                            rightSection={<IconExternalLink size={12} />}
                            style={{ flexShrink: 0 }}
                          >
                            data
                          </Button>
                        )}
                        {domain && isNpanelType(service.type) && (
                          <Button
                            size="xs"
                            variant="light"
                            color="relaykit"
                            onClick={() => setShowNsiteExplorer(true)}
                            rightSection={<IconExternalLink size={12} />}
                            style={{ flexShrink: 0 }}
                          >
                            data
                          </Button>
                        )}
                        {domain && service.presetId === 'grasp' && (
                          <Button
                            size="xs"
                            variant="light"
                            color="relaykit"
                            onClick={() => setShowGraspExplorer(true)}
                            rightSection={<IconExternalLink size={12} />}
                            style={{ flexShrink: 0 }}
                          >
                            data
                          </Button>
                        )}
                        {domain && service.presetId === 'notif-hub' && (
                          <Button
                            size="xs"
                            variant="light"
                            color="relaykit"
                            onClick={() => setShowNotifApp(true)}
                            rightSection={<IconExternalLink size={12} />}
                            style={{ flexShrink: 0 }}
                          >
                            app
                          </Button>
                        )}
                      </Group>
                    </Stack>
                  </Stack>
                </Group>
                <Box pt={2} style={{ position: 'relative', zIndex: 3 }}>
                  <CogMenu items={manageItems} />
                </Box>
              </Group>
            </Stack>
            <Modal
              opened={detailsModalOpen}
              onClose={() => {
                setDetailsModalOpen(false);
                if (isEditing) onCancelEdit();
              }}
              title={
                <Group justify="space-between" align="center" gap="sm" wrap="nowrap" w="100%" maw="calc(100% - 2.5rem)" style={{ minHeight: INLINE_TITLE_ROW_H }}>
                  <ServiceHostTitleView
                    title={titleHost}
                    density="comfortable"
                    domain={null}
                    canEditConfig={false}
                    composeId={service.composeId}
                    service={service}
                    onEditDomain={onEditDomain}
                    onEditConfig={openConfig}
                    rowStyle={{ flex: 1, minWidth: 0 }}
                    trailing={nip42Badge}
                  />
                  <CogMenu showLabel items={manageItems} />
                </Group>
              }
              size="82vw"
              centered
              styles={{
                header: { alignItems: 'center' },
                title: { flex: 1, marginRight: 0, width: '100%' },
                ...serviceDetailsModalStyles,
              }}
            >
              <ServiceDetailsModalContext.Provider value={true}>
                <ServiceDetailsContent
                  {...detailsContentProps}
                  initialSection={detailsInitialSection}
                  onConfigSaved={() => {
                    setDetailsModalOpen(false);
                    onConfigSaved();
                  }}
                />
              </ServiceDetailsModalContext.Provider>
            </Modal>
          </>
        )}
      </Paper>
    </>
  );
};

export const ServiceList = () => {
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme('light');
  const projectBorderColor = colorScheme === 'dark' ? theme.colors.dark[4] : theme.colors.gray[4];
  const projectBg = colorScheme === 'dark' ? theme.colors.dark[8] : theme.colors.gray[0];
  const envBorderColor = colorScheme === 'dark' ? theme.colors.dark[3] : theme.colors.gray[4];
  const envBg = colorScheme === 'dark' ? theme.colors.dark[7] : theme.colors.gray[1];
  const { refreshTrigger, triggerRefresh, services, servicesLoading, servicesError } = useRefreshServices();
  const { setDokployConnectionError, setDokployReady } = useDokploy();
  const { logout } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [serverIp, setServerIp] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [serviceOverviewSummaries, setServiceOverviewSummaries] = useState<
    Record<string, {
      cpuPct: number | null;
      memoryUsedPct: number | null;
      memoryUsedBytes: number | null;
      memoryTotalBytes: number | null;
      storageUsedBytes: number | null;
      networkInBps: number | null;
      networkOutBps: number | null;
      blockReadBps: number | null;
      blockWriteBps: number | null;
    }>
  >({});

  const [editingDomain, setEditingDomain] = useState<{ composeId: string; domainId: string; currentHost: string } | null>(null);
  const [newDomainHost, setNewDomainHost] = useState('');
  const [tlsRestarting, setTlsRestarting] = useState(false);

  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [newEnvTarget, setNewEnvTarget] = useState<string | null>(null);
  const [newEnvName, setNewEnvName] = useState('');
  const [renamingEnvId, setRenamingEnvId] = useState<string | null>(null);
  const [renameEnvValue, setRenameEnvValue] = useState('');
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameProjectValue, setRenameProjectValue] = useState('');
  const [confirmModal, setConfirmModal] = useState<{ type: 'deleteGroup'; projectId: string; name: string } | { type: 'deleteEnv'; environmentId: string; name: string } | { type: 'deleteService'; composeId: string; name: string } | null>(null);
  const [listLoaded, setListLoaded] = useState(false);

  const allEnvironments: { environmentId: string; label: string }[] = projects.flatMap((p: any) =>
    p.environments.map((e: any) => ({ environmentId: e.environmentId, label: `${p.name} → ${e.name}` }))
  );

  const availableRelays = useMemo(
    () =>
      Array.from(
        new Set(
          services
            .filter((service: any) => isRelayType(service.type) && service.domains?.[0]?.host)
            .map((service: any) => `wss://${service.domains[0].host}`),
        ),
      ),
    [services],
  );

  const loadData = async () => {
    setDokployConnectionError(null);
    try {
      const [projResult, ipResult] = await Promise.all([
        trpc.listProjects.query(),
        trpc.getServerIp.query().catch(() => null),
      ]);
      setProjects(projResult);
      setServerIp(ipResult?.ip ?? null);
      setDokployReady(true);
    } catch (error: any) {
      const code = error?.data?.code;
      const msg = error?.message || '';
      if (code === 'UNAUTHORIZED' && msg.includes('Authentication required')) {
        logout();
        return;
      }
      setDokployConnectionError(msg || 'Could not load services. Run the setup script (see README).');
      setProjects([]);
    } finally {
      setListLoaded(true);
    }
  };

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  useEffect(() => {
    if (servicesLoading) return;
    if (servicesError) {
      setDokployConnectionError(servicesError);
      return;
    }
    setDokployConnectionError(null);
  }, [servicesLoading, servicesError, setDokployConnectionError]);

  useEffect(() => {
    if (showDetails) return;
    const runningComposeIds = services
      .filter((s: any) => s.status === 'running' && s.composeId)
      .map((s: any) => s.composeId);
    if (runningComposeIds.length === 0) {
      setServiceOverviewSummaries({});
      return;
    }

    let mounted = true;
    const loadSummaries = async () => {
      try {
        const result = await trpc.getServicesInsights.query({ composeIds: runningComposeIds });
        if (!mounted) return;
        const next: Record<string, {
          cpuPct: number | null;
          memoryUsedPct: number | null;
          memoryUsedBytes: number | null;
          memoryTotalBytes: number | null;
          storageUsedBytes: number | null;
          networkInBps: number | null;
          networkOutBps: number | null;
          blockReadBps: number | null;
          blockWriteBps: number | null;
        }> = {};
        for (const composeId of runningComposeIds) {
          next[composeId] = {
            cpuPct: null,
            memoryUsedPct: null,
            memoryUsedBytes: null,
            memoryTotalBytes: null,
            storageUsedBytes: null,
            networkInBps: null,
            networkOutBps: null,
            blockReadBps: null,
            blockWriteBps: null,
          }
          const insight = result[composeId];
          if (!insight) continue;
          const history = insight.history || [];
          const curr = insight.current;
          const prev = history.length >= 2 ? history[history.length - 2] : null;
          const elapsedSec = prev ? Math.max((curr.ts - prev.ts) / 1000, 1) : 1;
          const networkInBps = prev ? Math.max(0, (curr.networkInBytes - prev.networkInBytes) / elapsedSec) : 0;
          const networkOutBps = prev ? Math.max(0, (curr.networkOutBytes - prev.networkOutBytes) / elapsedSec) : 0;
          const blockReadBps = prev ? Math.max(0, (curr.blockReadBytes - prev.blockReadBytes) / elapsedSec) : 0;
          const blockWriteBps = prev ? Math.max(0, (curr.blockWriteBytes - prev.blockWriteBytes) / elapsedSec) : 0;
          next[composeId] = {
            cpuPct: curr.cpuPct,
            memoryUsedPct: curr.memoryUsedPct,
            memoryUsedBytes: curr.memoryUsedBytes,
            memoryTotalBytes: curr.memoryTotalBytes,
            storageUsedBytes: curr.storageUsedBytes,
            networkInBps,
            networkOutBps,
            blockReadBps,
            blockWriteBps,
          };
        }
        setServiceOverviewSummaries(next);
      } catch {
        if (!mounted) return;
      }
    };

    void loadSummaries();
    const poll = window.setInterval(() => {
      void loadSummaries();
    }, 60000);
    return () => {
      mounted = false;
      window.clearInterval(poll);
    };
  }, [services, showDetails]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!');
  };

  const openDeleteServiceConfirm = (composeId: string, serviceName: string) => {
    setConfirmModal({ type: 'deleteService', composeId, name: serviceName });
  };

  const handleStopService = async (composeId: string) => {
    try {
      await trpc.stopService.mutate({ composeId });
      await loadData();
      toast.success('Service stopped');
    } catch (error: any) {
      toast.error(`Failed to stop service: ${error.message}`);
    }
  };

  const handleStartService = async (composeId: string) => {
    try {
      await trpc.startService.mutate({ composeId });
      await loadData();
      toast.success('Service started');
    } catch (error: any) {
      toast.error(`Failed to start service: ${error.message}`);
    }
  };

  const handleRedeployService = async (composeId: string) => {
    try {
      await trpc.updateServiceConfig.mutate({ composeId, config: {} });
      await loadData();
      toast.success('Service redeployed');
    } catch (error: any) {
      toast.error(`Failed to redeploy service: ${error.message}`);
    }
  };

  const handleRefreshNsite = async (composeId: string) => {
    try {
      await trpc.refreshNpanelGateway.mutate({ composeId });
      toast.success('refreshing nsite content');
    } catch (error: any) {
      toast.error(`failed to refresh: ${error.message}`);
    }
  };

  const handleMoveService = async (composeId: string, targetEnvironmentId: string) => {
    try {
      await trpc.moveService.mutate({ composeId, targetEnvironmentId });
      toast.success('Service moved');
      await loadData();
    } catch (error: any) {
      toast.error(`Failed to move service: ${error.message}`);
    }
  };

  const handleEditDomain = (composeId: string, domain: any) => {
    setEditingDomain({ composeId, domainId: domain.domainId, currentHost: domain.host });
    setNewDomainHost(domain.host);
  };

  const handleSaveDomain = async () => {
    if (!editingDomain) return;
    try {
      const result = await trpc.updateServiceDomain.mutate({
        composeId: editingDomain.composeId,
        domainId: editingDomain.domainId,
        newHost: newDomainHost
      });
      setEditingDomain(null);
      // The retry path restarts Traefik shortly after responding; the dashboard rides the same
      // proxy, so block behind a modal until the proxy is back instead of showing error toasts.
      if (result?.message === 'Retrying TLS certificate') {
        setTlsRestarting(true);
        return;
      }
      await loadData();
      toast.success('Domain updated successfully');
    } catch (error: any) {
      toast.error(`Failed to update domain: ${error.message}`);
    }
  };

  // While the edge proxy restarts (tls retry), every request through it fails. Poll until it
    // answers consistently again, then refresh — same shape as the updater's waitForBackend.
  useEffect(() => {
    if (!tlsRestarting) return;
    let goodPolls = 0;
    const timer = setInterval(async () => {
      try {
        const status = await trpc.checkDokploy.query();
        if (status.reachable) {
          goodPolls += 1;
        } else {
          goodPolls = 0;
        }
      } catch {
        goodPolls = 0;
      }
      if (goodPolls >= 3) {
        clearInterval(timer);
        setTlsRestarting(false);
        await loadData();
        toast.success('edge proxy back — certificate retry issued');
      }
    }, 1500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tlsRestarting]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    setCreatingProject(true);
    try {
      await trpc.createProject.mutate({ name: newProjectName.trim() });
      setNewProjectName('');
      toast.success('Group created');
      triggerRefresh();
    } catch (error: any) {
      toast.error(`Failed to create group: ${error.message}`);
    } finally {
      setCreatingProject(false);
    }
  };

  const handleCreateEnvironment = async (projectId: string) => {
    if (!newEnvName.trim()) return;
    try {
      await trpc.createEnvironment.mutate({ projectId, name: newEnvName.trim() });
      setNewEnvTarget(null);
      setNewEnvName('');
      toast.success('Environment created');
      triggerRefresh();
    } catch (error: any) {
      toast.error(`Failed to create environment: ${error.message}`);
    }
  };

  const handleRenameEnvironment = async (environmentId: string) => {
    if (!renameEnvValue.trim()) return;
    try {
      await trpc.renameEnvironment.mutate({ environmentId, name: renameEnvValue.trim() });
      setRenamingEnvId(null);
      setRenameEnvValue('');
      toast.success('Environment renamed');
      await loadData();
    } catch (error: any) {
      toast.error(`Failed to rename environment: ${error.message}`);
    }
  };

  const openDeleteGroupConfirm = (projectId: string, projectName: string) => {
    setConfirmModal({ type: 'deleteGroup', projectId, name: projectName });
  };

  const openDeleteEnvConfirm = (environmentId: string, envName: string) => {
    setConfirmModal({ type: 'deleteEnv', environmentId, name: envName });
  };

  const handleConfirmDelete = async () => {
    if (!confirmModal) return;
    if (confirmModal.type === 'deleteGroup') {
      try {
        await trpc.deleteProject.mutate({ projectId: confirmModal.projectId });
        toast.success('Group deleted');
        await loadData();
      } catch (error: any) {
        toast.error(`Failed to delete group: ${error.message}`);
      }
    } else if (confirmModal.type === 'deleteEnv') {
      try {
        await trpc.deleteEnvironment.mutate({ environmentId: confirmModal.environmentId });
        toast.success('Environment deleted');
        await loadData();
      } catch (error: any) {
        toast.error(`Failed to delete environment: ${error.message}`);
      }
    } else {
      try {
        await trpc.deleteService.mutate({ composeId: confirmModal.composeId });
        toast.success('Service deleted');
        await loadData();
      } catch (error: any) {
        toast.error(`Failed to delete service: ${error.message}`);
      }
    }
    setConfirmModal(null);
  };

  const handleRenameProject = async (projectId: string) => {
    if (!renameProjectValue.trim()) return;
    try {
      await trpc.renameProject.mutate({ projectId, name: renameProjectValue.trim() });
      setRenamingProjectId(null);
      setRenameProjectValue('');
      toast.success('Group renamed');
      await loadData();
    } catch (error: any) {
      toast.error(`Failed to rename group: ${error.message}`);
    }
  };

  const grouped = projects.map((project: any) => ({
    ...project,
    environments: project.environments.map((env: any) => ({
      ...env,
      services: services.filter((s: any) => s.environmentId === env.environmentId),
    })),
  }));

  const isDefaultProject = (name: string) => name === 'relaykit.ungrouped';

  const displayProjectName = (name: string) => 
    name === 'relaykit.ungrouped' ? '' : name;
  const viewToggleBg = colorScheme === 'dark' ? '#111315' : theme.colors.gray[1];

  if (!listLoaded || servicesLoading) {
    return (
      <Stack align="center" justify="center" gap="sm" style={{ minHeight: rem(480) }}>
        <RubixLoader size={144} colors={[RubixLoaderColor.RelayKit]} speed={1.35} />
        <Text size="sm" c="dimmed">loading services…</Text>
      </Stack>
    );
  }

  return (
    <Stack gap="xl">
      <Group justify="flex-end">
        <Box
          style={{
            border: 'none',
            background: viewToggleBg,
            paddingTop: 3,
            paddingBottom: 4,
            paddingInline: 4,
          }}
        >
          <SegmentedControl
            size="xs"
            color="relaykit"
            value={showDetails ? 'details' : 'overview'}
            onChange={(v) => setShowDetails(v === 'details')}
            data={[
              { label: 'overview', value: 'overview' },
              { label: 'details', value: 'details' },
            ]}
            styles={{
              root: {
                border: 'none',
                background: 'transparent',
                padding: 0,
              },
              indicator: {
                border: 'none',
                boxShadow: 'none',
              },
              control: {
                border: 'none',
              },
              label: {
                paddingInline: 18,
              },
            }}
          />
        </Box>
      </Group>

      {grouped.length === 0 ? (
        <Paper withBorder p="xl">
          <Stack align="center" gap="sm">
            <Text c="dimmed">no services yet.</Text>
            <Text size="sm" c="dimmed">deploy your first relay or media server.</Text>
          </Stack>
        </Paper>
      ) : (
        <Stack gap="md">
          {grouped.map((project: any) => {
            const projectItems = [
              {
                label: 'Add environment…',
                onClick: () => {
                  setNewEnvTarget(project.projectId);
                  setNewEnvName('');
                },
              },
              {
                label: 'Delete group',
                onClick: () => openDeleteGroupConfirm(project.projectId, project.name),
                danger: true,
              },
            ];
            return (
              <Paper
                key={project.projectId}
                withBorder
                p="md"
                style={{
                  backgroundColor: projectBg,
                  borderColor: projectBorderColor,
                }}
              >
                <Group justify="space-between" mb="md" wrap="wrap" align="center" w="100%" style={{ minHeight: INLINE_TITLE_ROW_H }}>
                  {renamingProjectId === project.projectId ? (
                    <>
                      <InlineTextEditRow
                        value={renameProjectValue}
                        onChange={setRenameProjectValue}
                        onSave={() => handleRenameProject(project.projectId)}
                        onCancel={() => { setRenamingProjectId(null); setRenameProjectValue(''); }}
                        saveDisabled={!renameProjectValue.trim()}
                        autoFocus
                        inputStyle={{ flex: 1, minWidth: 120 }}
                        rowStyle={{ flex: 1, minWidth: 0 }}
                      />
                      <CogMenu items={projectItems} />
                    </>
                  ) : (
                    <>
                      <Group gap={4} wrap="nowrap" align="center" style={{ flex: 1, minWidth: 0, minHeight: INLINE_TITLE_ROW_H }}>
                        {displayProjectName(project.name) && (
                          <Text fw={600} fz="md" style={{ lineHeight: INLINE_TITLE_ROW_H, display: 'flex', alignItems: 'center' }}>
                            {displayProjectName(project.name)}
                          </Text>
                        )}
                        {displayProjectName(project.name) && !isDefaultProject(project.name) && (
                          <ActionIcon variant="subtle" size="xs" onClick={() => { setRenamingProjectId(project.projectId); setRenameProjectValue(project.name); }} aria-label="Rename group">
                            <IconPencil size={14} />
                          </ActionIcon>
                        )}
                      </Group>
                      <CogMenu items={projectItems} />
                    </>
                  )}
                </Group>
                <Stack gap="sm">
                  {showDetails ? (
                    project.environments.map((env: any) => {
                      const isDefaultEnv = env.isDefault === true;
                      return (
                        <Card
                          key={env.environmentId}
                          withBorder
                          padding="sm"
                          style={{
                            backgroundColor: envBg,
                            borderColor: envBorderColor,
                            borderStyle: 'dashed',
                          }}
                        >
                          <Group justify="space-between" align="center" mb="xs" wrap="nowrap" w="100%" gap="xs" style={{ minHeight: INLINE_TITLE_ROW_H }}>
                            {renamingEnvId === env.environmentId ? (
                              <InlineTextEditRow
                                value={renameEnvValue}
                                onChange={setRenameEnvValue}
                                onSave={() => handleRenameEnvironment(env.environmentId)}
                                onCancel={() => { setRenamingEnvId(null); setRenameEnvValue(''); }}
                                saveDisabled={!renameEnvValue.trim()}
                                autoFocus
                                inputStyle={{ width: rem(200), maxWidth: '100%', flexShrink: 1 }}
                                rowStyle={{ maxWidth: '100%' }}
                              />
                            ) : (
                              <>
                                <Group gap={4} wrap="nowrap" align="center" style={{ minHeight: INLINE_TITLE_ROW_H }}>
                                  <Badge variant="light" color="relaykit" size="sm">{env.name}</Badge>
                                  {!isDefaultEnv && (
                                    <ActionIcon variant="subtle" size="xs" onClick={() => { setRenamingEnvId(env.environmentId); setRenameEnvValue(env.name); }} aria-label="Rename environment">
                                      <IconPencil size={14} />
                                    </ActionIcon>
                                  )}
                                </Group>
                                <CogMenu items={[
                                  { label: 'Delete environment', onClick: () => openDeleteEnvConfirm(env.environmentId, env.name), danger: true },
                                ]} />
                              </>
                            )}
                          </Group>
                          <Stack gap="sm">
                            {env.services.length === 0 ? (
                              <Text c="dimmed" size="sm" fs="italic">no services in this environment.</Text>
                            ) : (
                              env.services.map((service: any) => (
                                <ServiceCard
                                  key={service.composeId}
                                  service={service}
                                  serverIp={serverIp}
                                  editingDomain={editingDomain}
                                  newDomainHost={newDomainHost}
                                  setNewDomainHost={setNewDomainHost}
                                  onEditDomain={handleEditDomain}
                                  onSaveDomain={handleSaveDomain}
                                  onCancelEdit={() => setEditingDomain(null)}
                                  onCopy={copyToClipboard}
                                  onStart={handleStartService}
                                  onStop={handleStopService}
                                  onDelete={openDeleteServiceConfirm}
                                  onConfigSaved={loadData}
                                  onRefreshNsite={handleRefreshNsite}
                                  onRedeploy={handleRedeployService}
                                  onMove={handleMoveService}
                                  allEnvironments={allEnvironments}
                                  availableRelays={availableRelays}
                                  showDetails={showDetails}
                                  summary={serviceOverviewSummaries[service.composeId] ?? null}
                                />
                              ))
                            )}
                            <Group justify="flex-end" wrap="wrap" gap="sm" align="center">
                              <AddServiceButton compact preselectedEnvironmentId={env.environmentId} />
                            </Group>
                          </Stack>
                        </Card>
                      );
                    })
                  ) : (
                    <>
                      <Group align="flex-start" gap="md" wrap="wrap">
                        {project.environments.map((env: any) => {
                          const isDefaultEnv = env.isDefault === true;
                          return (
                            <Box
                              key={env.environmentId}
                              style={{
                                flex: '0 1 auto',
                                minWidth: rem(200),
                                maxWidth: '100%',
                                border: `1px dashed ${envBorderColor}`,
                                borderRadius: 0,
                                backgroundColor: envBg,
                              }}
                            >
                              <Stack gap="sm" p="sm" pt="sm">
                                <Group justify="space-between" align="center" wrap="nowrap" gap="xs" style={{ minHeight: INLINE_TITLE_ROW_H }}>
                                  {renamingEnvId === env.environmentId ? (
                                    <InlineTextEditRow
                                      value={renameEnvValue}
                                      onChange={setRenameEnvValue}
                                      onSave={() => handleRenameEnvironment(env.environmentId)}
                                      onCancel={() => { setRenamingEnvId(null); setRenameEnvValue(''); }}
                                      saveDisabled={!renameEnvValue.trim()}
                                      autoFocus
                                      inputStyle={{ width: rem(200), maxWidth: '100%', flexShrink: 1 }}
                                      rowStyle={{ maxWidth: '100%' }}
                                    />
                                  ) : (
                                    <>
                                      <Group gap={4} wrap="nowrap" align="center" style={{ minHeight: INLINE_TITLE_ROW_H }}>
                                        <Badge variant="light" color="relaykit" size="sm">{env.name}</Badge>
                                        {!isDefaultEnv && (
                                          <ActionIcon variant="subtle" size="xs" onClick={() => { setRenamingEnvId(env.environmentId); setRenameEnvValue(env.name); }} aria-label="Rename environment">
                                            <IconPencil size={14} />
                                          </ActionIcon>
                                        )}
                                      </Group>
                                      <CogMenu items={[
                                        { label: 'Delete environment', onClick: () => openDeleteEnvConfirm(env.environmentId, env.name), danger: true },
                                      ]} />
                                    </>
                                  )}
                                </Group>
                              <Group gap="sm" wrap="wrap" align="flex-start">
                                {env.services.length === 0 ? (
                                  <Text c="dimmed" size="sm" fs="italic">no services</Text>
                                ) : (
                                  env.services.map((service: any) => (
                                    <ServiceCard
                                      key={service.composeId}
                                      service={service}
                                      serverIp={serverIp}
                                      editingDomain={editingDomain}
                                      newDomainHost={newDomainHost}
                                      setNewDomainHost={setNewDomainHost}
                                      onEditDomain={handleEditDomain}
                                      onSaveDomain={handleSaveDomain}
                                      onCancelEdit={() => setEditingDomain(null)}
                                      onCopy={copyToClipboard}
                                      onStart={handleStartService}
                                      onStop={handleStopService}
                                      onDelete={openDeleteServiceConfirm}
                                      onConfigSaved={loadData}
                                      onRefreshNsite={handleRefreshNsite}
                                      onRedeploy={handleRedeployService}
                                      onMove={handleMoveService}
                                      allEnvironments={allEnvironments}
                                      availableRelays={availableRelays}
                                      showDetails={showDetails}
                                      summary={serviceOverviewSummaries[service.composeId] ?? null}
                                    />
                                  ))
                                )}
                              </Group>
                              <Group justify="flex-end">
                                <AddServiceButton compact preselectedEnvironmentId={env.environmentId} />
                              </Group>
                              </Stack>
                            </Box>
                          );
                        })}
                      </Group>
                    </>
                  )}
                  {newEnvTarget === project.projectId && (
                    <Group justify="flex-end" wrap="wrap">
                      <TextInput
                        size="xs"
                        placeholder="Environment name…"
                        value={newEnvName}
                        onChange={(e) => setNewEnvName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleCreateEnvironment(project.projectId)}
                        style={{ width: 170 }}
                        autoFocus
                      />
                      <Button size="xs" color="relaykit" onClick={() => handleCreateEnvironment(project.projectId)} disabled={!newEnvName.trim()}>
                        Add
                      </Button>
                      <Button size="xs" variant="default" onClick={() => { setNewEnvTarget(null); setNewEnvName(''); }}>
                        Cancel
                      </Button>
                    </Group>
                  )}
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}

      <Stack
        gap="md"
        pt="xl"
        mt="md"
        style={{
          borderTop: '1px solid var(--mantine-color-gray-4)',
        }}
      >
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Paper withBorder p="md">
            <Text fw={500} size="sm" mb={4}>add a new group</Text>
            <Text size="xs" c="dimmed" mb="md">create a group to organise services within.</Text>
            <Group wrap="nowrap" align="flex-end">
              <TextInput
                style={{ flex: 1, minWidth: 0 }}
                placeholder="group name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
              />
              <Button variant="outline" color="relaykit" onClick={handleCreateProject} loading={creatingProject} disabled={!newProjectName.trim()}>
                add group
              </Button>
            </Group>
          </Paper>
          <Paper withBorder p="md" id="add-service">
            <Text fw={500} size="sm" mb={4}>
              add service
            </Text>
            <Text size="xs" c="dimmed" mb="md">
              deploy a relay or media server into a group.
            </Text>
            <Group justify="flex-start" wrap="wrap">
              <AddServiceButton />
            </Group>
          </Paper>
        </SimpleGrid>
      </Stack>

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.type === 'deleteGroup' ? 'Delete group?' : confirmModal.type === 'deleteEnv' ? 'Delete environment?' : 'Delete service?'}
          message={confirmModal.type === 'deleteGroup'
            ? `Delete group "${confirmModal.name}" and all its environments and services?`
            : confirmModal.type === 'deleteEnv'
              ? `Delete environment "${confirmModal.name}" and all its services?`
              : `Delete service "${confirmModal.name}"?`}
          confirmLabel={confirmModal.type === 'deleteGroup' ? 'Delete group' : confirmModal.type === 'deleteEnv' ? 'Delete environment' : 'Delete service'}
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      <Modal
        opened={tlsRestarting}
        onClose={() => {}}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        centered
        title="restarting edge proxy"
      >
        <Stack align="center" gap="sm" py="sm">
          <RubixLoader size={96} colors={[RubixLoaderColor.RelayKit]} speed={1.35} />
          <Text size="sm" c="dimmed" ta="center">
            retrying the tls certificate — the proxy (and this dashboard) restarts for a few seconds.
            <br />
            this page reconnects automatically — don't close it.
          </Text>
        </Stack>
      </Modal>
    </Stack>
  );
};

const DeployModal = ({
  preset,
  initialConfig,
  loading,
  deployResult,
  onSubmit,
  onClose,
  environments,
  initialEnvironmentId,
  ownerPubkeyHex,
  instanceHost,
}: {
  preset: any;
  initialConfig: Record<string, string>;
  loading: boolean;
  deployResult: any;
  onSubmit: (payload: { environmentId: string; config: Record<string, string> }) => void | Promise<void>;
  onClose: () => void;
  environments: { environmentId: string; label: string }[];
  initialEnvironmentId: string;
  ownerPubkeyHex: string | null;
  instanceHost: string | null;
}) => {
  const byGroup = environments.reduce<Record<string, { environmentId: string; label: string }[]>>((acc, env) => {
    const [groupName, envName] = env.label.includes(' → ') ? env.label.split(' → ') : [env.label, ''];
    if (!acc[groupName]) acc[groupName] = [];
    acc[groupName].push({ environmentId: env.environmentId, label: envName || env.label });
    return acc;
  }, {});
  const groupNames = Object.keys(byGroup);
  const isNsite = isNpanelType(preset.id);
  const form = useForm<Record<string, string>>({
    initialValues: { environmentId: initialEnvironmentId || '', ...initialConfig },
    validateInputOnChange: true,
    validate: (values: Record<string, string>) => {
      const errors: Record<string, string> = {};
      if (!(values.environmentId || '').trim()) {
        errors.environmentId = 'Environment is required';
      }
      if (!isNsite) {
        for (const field of preset.requiredConfig || []) {
          if (!field.required || field.type === 'boolean') continue;
          if (!(values[field.id] || '').trim()) {
            errors[field.id] = `${field.name} is required`;
          }
        }
      }
      return errors;
    },
  });

  useEffect(() => {
    form.setValues({ environmentId: initialEnvironmentId || '', ...initialConfig });
    form.clearErrors();
  }, [initialEnvironmentId, initialConfig]);

  const canSubmit = !loading && form.isValid();

  const renderField = (field: any) => {
    if (field.type === 'boolean') {
      const checked = (form.values[field.id] || String(field.default || 'false')).toLowerCase() === 'true';
      return (
        <Switch
          key={field.id}
          label={field.name}
          description={field.description}
          checked={checked}
          onChange={(e) => form.setFieldValue(field.id, e.currentTarget.checked ? 'true' : 'false')}
        />
      );
    }
    if (field.type === 'npub') {
      return (
        <NpubField
          key={field.id}
          label={field.name}
          description={field.description}
          required={field.required}
          value={form.values[field.id] ?? ''}
          onChange={(v) => form.setFieldValue(field.id, v)}
          error={form.errors[field.id]}
        />
      );
    }
    if (field.type === 'relays') {
      return (
        <RelaysField
          key={field.id}
          label={field.name}
          description={field.description}
          value={form.values[field.id] ?? ''}
          onChange={(csv) => form.setFieldValue(field.id, csv)}
        />
      );
    }
    if (field.type === 'domain') {
      return (
        <DomainField
          key={field.id}
          label={field.name}
          description={field.description}
          required={field.required}
          subdomain={field.subdomain}
          instanceHost={instanceHost}
          value={form.values[field.id] ?? ''}
          onChange={(v) => form.setFieldValue(field.id, v)}
          error={form.errors[field.id]}
        />
      );
    }

    return (
      <TextInput
        key={field.id}
        label={field.name}
        description={field.description}
        required={field.required}
        {...form.getInputProps(field.id)}
        value={form.values[field.id] ?? String(field.default ?? '')}
      />
    );
  };

  return (
    <Modal opened onClose={onClose} title={
      <Group gap="xs">
        {renderIcon(preset.icon, 18)}
        <Text fw={700}>Deploy {preset.name}</Text>
      </Group>
    } size="md" centered styles={{ body: { maxHeight: '85vh', overflow: 'auto' } }}>
      <Stack gap="md">
        {preset.description && <Text size="sm" c="dimmed">{preset.description}</Text>}
        <form
          onSubmit={form.onSubmit((values: Record<string, string>) => {
            const { environmentId, ...config } = values;
            void onSubmit({ environmentId, config });
          })}
        >
          <Stack gap="md">
            <Select
              label="Deploy into"
              placeholder="Select environment…"
              value={form.values.environmentId || null}
              onChange={(v) => form.setFieldValue('environmentId', v || '')}
              error={form.errors.environmentId}
              required
              data={groupNames.flatMap((groupName) => [
                { group: groupName, items: byGroup[groupName].map((env) => ({ value: env.environmentId, label: env.label })) }
              ])}
            />
            {isNsite ? (
              <NsiteDeployFields
                preset={preset}
                config={Object.fromEntries(Object.entries(form.values).filter(([k]) => k !== 'environmentId')) as Record<string, string>}
                setConfig={(next) => {
                  const prev = Object.fromEntries(Object.entries(form.values).filter(([k]) => k !== 'environmentId')) as Record<string, string>;
                  const resolved = typeof next === 'function' ? next(prev) : next;
                  for (const [key, value] of Object.entries(resolved)) {
                    form.setFieldValue(key, String(value ?? ''));
                  }
                }}
                ownerPubkeyHex={ownerPubkeyHex}
                autoFetchProfile
              />
            ) : (
              preset.requiredConfig.filter((f: any) => !f.hideOnDeploy).map(renderField)
            )}
            {deployResult && (
              <Paper color={deployResult.error ? 'red' : 'green'} p="md">
                <Text fw={700}>{deployResult.error ? 'Error:' : 'Success!'}</Text>
                <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(deployResult, null, 2)}</pre>
              </Paper>
            )}
            <Group justify="space-between">
              <Button variant="default" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" color="green" loading={loading} disabled={!canSubmit}>
                {loading ? 'Deploying...' : 'Deploy'}
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Modal>
  );
};

