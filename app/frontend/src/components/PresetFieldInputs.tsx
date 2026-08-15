import { useMemo } from 'react';
import { Button, Stack, Text, TextInput } from '@mantine/core';
import { nip19 } from 'nostr-tools';
import { NpubInput, RelayPillsInput, dedupeHttpsUrls, dedupeRelays } from '@relaykit/ui';
import { useAuth } from '../contexts/AuthContext';
import { useRefreshServices } from '../contexts/RefreshServicesContext';
import { isRelayType, SERVICE_TYPE } from '../../../shared/serviceType';

const toNpub = (value: string | null): string | null => {
  if (!value) return null;
  if (value.startsWith('npub1')) return value;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    try {
      return nip19.npubEncode(value.toLowerCase());
    } catch {
      return null;
    }
  }
  return null;
};

/** Domain input with a one-tap "use <sub>.<relaykit host>" prefill suggestion. */
export const DomainField = ({
  label,
  description,
  required,
  subdomain,
  instanceHost,
  value,
  onChange,
  error,
}: {
  label: string;
  description?: string;
  required?: boolean;
  subdomain?: string;
  /** Instance domain as configured at install time (RELAYKIT_HOST); comes with listPresets. */
  instanceHost?: string | null;
  value: string;
  onChange: (value: string) => void;
  error?: React.ReactNode;
}) => {
  const suggestion = subdomain && instanceHost ? `${subdomain}.${instanceHost}` : null;
  return (
    <Stack gap={4}>
      <TextInput
        label={label}
        description={description}
        required={required}
        placeholder={suggestion ?? undefined}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        error={error}
        styles={{ input: { fontFamily: 'monospace' } }}
      />
      {suggestion && value !== suggestion && (
        <Button size="compact-xs" variant="subtle" px={0} style={{ alignSelf: 'flex-start' }} onClick={() => onChange(suggestion)}>
          use {suggestion}
        </Button>
      )}
    </Stack>
  );
};

/** npub input with a one-tap "use mine" fill from the authed relaykit identity. */
export const NpubField = ({
  label,
  description,
  required,
  value,
  onChange,
  error,
}: {
  label: string;
  description?: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  error?: React.ReactNode;
}) => {
  const { npub } = useAuth();
  return (
    <NpubInput
      label={label}
      description={description}
      required={required}
      value={value}
      onChange={onChange}
      mine={toNpub(npub)}
      error={error}
    />
  );
};

/** Relay list editor (pills + typeahead) storing its value as a comma-separated string. */
export const RelaysField = (props: {
  label: string;
  description?: string;
  value: string;
  onChange: (csv: string) => void;
}) => <EndpointListField {...props} scheme="relay" />;

/** Blossom / https URL list editor (pills + typeahead) storing its value as a comma-separated string. */
export const BlossomServersField = (props: {
  label: string;
  description?: string;
  value: string;
  onChange: (csv: string) => void;
}) => <EndpointListField {...props} scheme="https" />;

const ENDPOINT_FIELD = {
  relay: {
    dedupe: dedupeRelays,
    storageKey: 'rk:previous-relays',
    matchService: isRelayType,
    toServiceUrl: (host: string) => `wss://${host}`,
  },
  https: {
    dedupe: dedupeHttpsUrls,
    storageKey: 'rk:previous-blossom-urls',
    matchService: (type: string) => type === SERVICE_TYPE.BLOSSOM,
    toServiceUrl: (host: string) => `https://${host}`,
  },
} as const;

const EndpointListField = ({
  label,
  description,
  value,
  onChange,
  scheme,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (csv: string) => void;
  scheme: keyof typeof ENDPOINT_FIELD;
}) => {
  const cfg = ENDPOINT_FIELD[scheme];
  const { services } = useRefreshServices();
  const knownUrls = useMemo(
    () =>
      ENDPOINT_FIELD[scheme].dedupe(
        (Array.isArray(services) ? services : [])
          .filter((service: any) => ENDPOINT_FIELD[scheme].matchService(service?.type) && service?.domains?.[0]?.host)
          .map((service: any) => ENDPOINT_FIELD[scheme].toServiceUrl(service.domains[0].host)),
      ),
    [services, scheme],
  );
  const urls = useMemo(
    () => ENDPOINT_FIELD[scheme].dedupe(value.split(',').map((r) => r.trim()).filter(Boolean)),
    [value, scheme],
  );
  return (
    <Stack gap={4}>
      <Stack gap={0}>
        <Text size="sm" fw={500}>{label}</Text>
        {description && <Text size="xs" c="dimmed">{description}</Text>}
      </Stack>
      <RelayPillsInput
        value={urls}
        onChange={(next: string[]) => onChange(next.join(','))}
        knownUrls={knownUrls}
        storageKey={cfg.storageKey}
        scheme={scheme}
      />
    </Stack>
  );
};
