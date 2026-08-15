import { useState, useMemo, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import {
  getNsiteDefaultRelayEnv,
  mergeNsiteRelayDefaults,
  normalizeNpanelNip05UsersEnv,
  NPANEL_NIP05_USERS_ENV_KEY,
  NSITE_RELAY_ENV_KEYS,
  tryBuildNsitePublicHostname,
  parsePubkeyHex as toPubkeyHex,
  fetchNsiteRelayEnvFromProfile,
  fetchNsiteManifestDtags,
  getNsiteManifestScanRelays,
} from '../../../shared/nsite';
import { BlossomServersField, RelaysField } from './PresetFieldInputs';
import { FormSection } from './FormSection';
import { TextInput, Stack, Text, Group, Button, Switch, Combobox, Pill, PillsInput, useCombobox } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';

type ProfileStatus = 'idle' | 'loading' | 'ok' | 'error' | 'skipped';

/** Sentinel option value for "serve the root site" (empty d-tag) in the site-id combobox. */
const ROOT_SITE = '\u0000root-site';

/** Initialise deploy config defaults for an nsite preset. */
export const buildNsiteDeployDefaults = (preset: any, ownerPubkeyHex: string | null): Record<string, string> => {
  const defaults: Record<string, string> = {};
  preset.requiredConfig.forEach((field: any) => {
    if (field.default) defaults[field.id] = field.default;
  });
  Object.assign(defaults, getNsiteDefaultRelayEnv());
  if (ownerPubkeyHex) defaults.NSITE_SITE_NPUB = ownerPubkeyHex;
  return defaults;
};

/** Merge relay defaults before sending to backend (fills blank relay fields). */
export const prepareNsiteConfigForSave = (config: Record<string, string>): Record<string, string> =>
  (() => {
    const merged = mergeNsiteRelayDefaults(config);
    const normalizedUsers = normalizeNpanelNip05UsersEnv(merged[NPANEL_NIP05_USERS_ENV_KEY] ?? '');
    return {
      ...merged,
      [NPANEL_NIP05_USERS_ENV_KEY]: normalizedUsers,
    };
  })();

/**
 * Nsite-specific fields for the deploy or edit-config modal.
 * Encapsulates profile fetching, hostname preview, d-tag discovery, and relay URL editors.
 */
export const NsiteDeployFields = ({
  preset,
  config,
  setConfig,
  ownerPubkeyHex,
  autoFetchProfile = false,
}: {
  preset: any;
  config: Record<string, string>;
  setConfig: (c: Record<string, string> | ((p: Record<string, string>) => Record<string, string>)) => void;
  ownerPubkeyHex: string | null;
  autoFetchProfile?: boolean;
}) => {
  const relayKeySet = new Set<string>(NSITE_RELAY_ENV_KEYS);
  const advancedFields = preset.requiredConfig.filter((f: { id: string }) => relayKeySet.has(f.id));

  const [manualSiteId, setManualSiteId] = useState(false);
  const [siteIdSearch, setSiteIdSearch] = useState('');
  const siteIdCombobox = useCombobox({ onDropdownClose: () => siteIdCombobox.resetSelectedOption() });
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('idle');
  const [profileMeta, setProfileMeta] = useState<{
    foundKind10002: boolean;
    foundKind10063: boolean;
    userRelayUrlCount: number;
    userBlossomUrlCount: number;
  } | null>(null);
  const [dDiscoverLoading, setDDiscoverLoading] = useState(false);
  const [dDiscovered, setDDiscovered] = useState<string[]>([]);
  const [nip05Rows, setNip05Rows] = useState<Array<{ name: string; pubkey: string }>>([]);

  useEffect(() => {
    const raw = (config[NPANEL_NIP05_USERS_ENV_KEY] ?? '').trim();
    if (!raw) {
      setNip05Rows([]);
      return;
    }
    const rows = raw
      .split(/[\n,]+/g)
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => {
        const i = token.indexOf('=');
        if (i <= 0) return { name: token, pubkey: '' };
        return { name: token.slice(0, i).trim(), pubkey: token.slice(i + 1).trim() };
      });
    setNip05Rows(rows);
  }, [config[NPANEL_NIP05_USERS_ENV_KEY]]);

  const syncNip05Rows = (rows: Array<{ name: string; pubkey: string }>) => {
    setNip05Rows(rows);
    const compact = rows
      .map((row) => ({ name: row.name.trim(), pubkey: row.pubkey.trim() }))
      .filter((row) => row.name || row.pubkey)
      .map((row) => `${row.name}=${row.pubkey}`)
      .join(',');
    setConfig((prev) => ({ ...prev, [NPANEL_NIP05_USERS_ENV_KEY]: compact }));
  };

  const fetchProfile = useCallback(
    (opts?: { silent?: boolean; configSnapshot?: Record<string, string> }) => {
      const snap = opts?.configSnapshot;
      const siteField = (snap !== undefined ? snap.NSITE_SITE_NPUB : config.NSITE_SITE_NPUB ?? '').toString().trim();
      const raw = siteField || (ownerPubkeyHex ?? '').trim();
      const hex = toPubkeyHex(raw);
      if (!hex) {
        setProfileMeta(null);
        setProfileStatus('skipped');
        return;
      }
      setProfileStatus('loading');
      setProfileMeta(null);
      fetchNsiteRelayEnvFromProfile(hex)
        .then(({ env, meta }) => {
          setConfig((prev) => ({ ...prev, ...env }));
          setProfileMeta(meta);
          setProfileStatus('ok');
          if (!opts?.silent) {
            const got = meta.foundKind10002 || meta.foundKind10063;
            toast.success(
              got
                ? 'Merged site pubkey kind 10002 / 10063 with defaults'
                : 'No kind 10002/10063 on queried relays — using defaults only',
            );
          }
        })
        .catch(() => {
          setProfileMeta(null);
          setProfileStatus('error');
          if (!opts?.silent) toast.error('Could not load Nostr lists for this site pubkey');
        });
    },
    [ownerPubkeyHex, config.NSITE_SITE_NPUB, setConfig],
  );

  useEffect(() => {
    if (autoFetchProfile) fetchProfile({ silent: true, configSnapshot: config });
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hostnamePreview = useMemo(
    () =>
      tryBuildNsitePublicHostname({
        parentDomain: config.NSITE_PARENT_DOMAIN ?? '',
        siteNpub: config.NSITE_SITE_NPUB ?? '',
        siteD: config.NSITE_SITE_D,
      }),
    [config.NSITE_PARENT_DOMAIN, config.NSITE_SITE_NPUB, config.NSITE_SITE_D],
  );

  // One "domain" maps to the parent suffix. Vanity (default): the visitor host tracks the domain so the
  // single site is served at the domain root. Multi-site: visitor host is empty and each key is served at
  // <key>.domain. Default to vanity (don't infer from an empty visitor host, which a fresh deploy also has).
  const domainValue = config.NSITE_PARENT_DOMAIN ?? '';
  const [multiSite, setMultiSiteState] = useState<boolean>(() => {
    const v = (config.NSITE_VISITOR_HOST ?? '').trim();
    const d = (config.NSITE_PARENT_DOMAIN ?? '').trim();
    return !!d && !v;
  });
  const canonicalHost = hostnamePreview.ok ? hostnamePreview.hostname : null;
  const servedAtHost = multiSite ? canonicalHost : domainValue;

  const setDomain = (value: string) =>
    setConfig((prev) => ({ ...prev, NSITE_PARENT_DOMAIN: value, ...(multiSite ? {} : { NSITE_VISITOR_HOST: value }) }));

  const setMultiSite = (on: boolean) => {
    setMultiSiteState(on);
    setConfig((prev) => ({ ...prev, NSITE_VISITOR_HOST: on ? '' : (prev.NSITE_PARENT_DOMAIN ?? '') }));
  };

  const scanRelays = useMemo(
    () =>
      getNsiteManifestScanRelays({
        NOSTR_RELAYS: config.NOSTR_RELAYS ?? '',
        LOOKUP_RELAYS: config.LOOKUP_RELAYS ?? '',
      }),
    [config.NOSTR_RELAYS, config.LOOKUP_RELAYS],
  );

  const runDiscoverManifests = useCallback((opts?: { silent?: boolean }) => {
    const hex = toPubkeyHex((config.NSITE_SITE_NPUB ?? '').trim());
    if (!hex) {
      if (!opts?.silent) toast.error('Enter a valid publishing key first.');
      return;
    }
    setDDiscoverLoading(true);
    fetchNsiteManifestDtags(hex, scanRelays.join(','))
      .then((tags) => {
        setDDiscovered(tags);
        if (opts?.silent) return;
        if (tags.length === 0) toast('No site manifests (kind 15128/35128) found on the queried relays.');
        else toast.success(`Found ${tags.length} site(s).`);
      })
      .catch(() => {
        if (!opts?.silent) toast.error('Could not query relays for site manifests.');
      })
      .finally(() => setDDiscoverLoading(false));
  }, [config.NSITE_SITE_NPUB, scanRelays]);

  const manifestScanPubkey = (config.NSITE_SITE_NPUB ?? '').trim();

  // Auto-discover whenever the publishing key or scan relays change.
  useEffect(() => {
    if (!toPubkeyHex(manifestScanPubkey)) return;
    const t = setTimeout(() => runDiscoverManifests({ silent: true }), 400);
    return () => clearTimeout(t);
  }, [manifestScanPubkey, runDiscoverManifests]);

  const renderEndpointField = (field: { id: string; name: string; description?: string }) => {
    const props = {
      label: field.name,
      description: field.description,
      value: config[field.id] ?? '',
      onChange: (csv: string) => setConfig((c) => ({ ...c, [field.id]: csv })),
    };
    return field.id === 'BLOSSOM_SERVERS' ? (
      <BlossomServersField key={field.id} {...props} />
    ) : (
      <RelaysField key={field.id} {...props} />
    );
  };

  const siteIdValue = (config.NSITE_SITE_D ?? '').trim();
  const useSelectForSiteId = dDiscovered.length > 0 && !manualSiteId;
  const siteIdOptions = (() => {
    const set = new Set(dDiscovered);
    set.delete('');
    if (siteIdValue) set.add(siteIdValue);
    return [...set];
  })();
  const siteIdFiltered = siteIdOptions.filter((o) => o.toLowerCase().includes(siteIdSearch.trim().toLowerCase()));

  return (
    <Stack gap="lg">
      <FormSection title="site" description="what to serve and where">
        <TextInput
          label="domain"
          description="the address people visit your site at, e.g. nsitetest.com"
          required
          placeholder="nsitetest.com"
          value={domainValue}
          onChange={(e) => setDomain(e.currentTarget.value)}
        />

        <TextInput
          label="publishing key"
          description="hex pubkey or npub of the account that signs your site in shakespeare"
          required
          placeholder="npub1… or hex"
          value={config.NSITE_SITE_NPUB ?? ''}
          onChange={(e) => setConfig((c) => ({ ...c, NSITE_SITE_NPUB: e.currentTarget.value }))}
        />

        <Stack gap={6}>
          {useSelectForSiteId ? (
            <Combobox
              store={siteIdCombobox}
              onOptionSubmit={(val) => {
                setConfig((c) => ({ ...c, NSITE_SITE_D: val === ROOT_SITE ? '' : val }));
                setSiteIdSearch('');
                siteIdCombobox.closeDropdown();
              }}
            >
              <Combobox.DropdownTarget>
                <PillsInput
                  label="site id"
                  description="search and pick which site under this key to serve"
                  onClick={() => siteIdCombobox.openDropdown()}
                >
                  <Pill.Group>
                    <Pill
                      withRemoveButton={siteIdValue !== ''}
                      onRemove={() => setConfig((c) => ({ ...c, NSITE_SITE_D: '' }))}
                    >
                      {siteIdValue || 'root site'}
                    </Pill>
                    <Combobox.EventsTarget>
                      <PillsInput.Field
                        value={siteIdSearch}
                        placeholder="change site…"
                        onFocus={() => siteIdCombobox.openDropdown()}
                        onChange={(e) => {
                          siteIdCombobox.openDropdown();
                          setSiteIdSearch(e.currentTarget.value);
                        }}
                      />
                    </Combobox.EventsTarget>
                  </Pill.Group>
                </PillsInput>
              </Combobox.DropdownTarget>
              <Combobox.Dropdown>
                <Combobox.Options>
                  <Combobox.Option value={ROOT_SITE} active={siteIdValue === ''}>
                    root site
                  </Combobox.Option>
                  {siteIdFiltered.map((id) => (
                    <Combobox.Option value={id} key={id} active={siteIdValue === id}>
                      {id}
                    </Combobox.Option>
                  ))}
                  {siteIdFiltered.length === 0 && <Combobox.Empty>no match</Combobox.Empty>}
                </Combobox.Options>
              </Combobox.Dropdown>
            </Combobox>
          ) : (
            <TextInput
              label="site id"
              description="which site under this key (15128 root or 35128 named). leave empty for root site."
              placeholder={dDiscoverLoading ? 'discovering published sites…' : 'myblog — empty = root site'}
              value={config.NSITE_SITE_D ?? ''}
              onChange={(e) => setConfig((c) => ({ ...c, NSITE_SITE_D: e.currentTarget.value }))}
            />
          )}
          <Group gap="md">
            <Button
              variant="subtle"
              size="compact-xs"
              px={0}
              leftSection={<IconRefresh size={12} />}
              onClick={() => runDiscoverManifests()}
              loading={dDiscoverLoading}
            >
              re-scan sites
            </Button>
            {dDiscovered.length > 0 && (
              <Button variant="subtle" size="compact-xs" px={0} onClick={() => setManualSiteId((m) => !m)}>
                {manualSiteId ? 'pick from discovered' : 'enter manually'}
              </Button>
            )}
          </Group>
          {scanRelays.length > 0 && (
            <Text size="xs" c="dimmed">
              site scan uses event/manifest + discovery relays below
              {scanRelays.map((r) => (
                <Text key={r} component="div" ff="monospace" mt={2}>
                  {r}
                </Text>
              ))}
            </Text>
          )}
        </Stack>

        {hostnamePreview.ok && servedAtHost && (
          <Text size="sm">
            <Text component="span" c="dimmed">serves at </Text>
            <Text component="span" ff="monospace" style={{ wordBreak: 'break-all' }}>
              https://{servedAtHost}
            </Text>
          </Text>
        )}
      </FormSection>

      <FormSection title="serving" description="how the gateway maps keys to hostnames">
        <Switch
          label="multi-site gateway"
          description="serve each key at its own subdomain (<key>.domain) instead of serving one site at the domain root"
          checked={multiSite}
          onChange={(e) => setMultiSite(e.currentTarget.checked)}
        />
      </FormSection>

      <FormSection
        title="relays & blossom"
        description="optional overrides — defaults are fine for most setups"
        action={
          <Button
            size="compact-xs"
            variant="subtle"
            leftSection={<IconRefresh size={12} />}
            onClick={() => fetchProfile({ configSnapshot: config })}
          >
            refresh from profile
          </Button>
        }
      >
        {profileStatus === 'loading' && (
          <Text size="sm" c="dimmed">loading this site pubkey&apos;s kind 10002 (relays) and 10063 (Blossom)…</Text>
        )}
        {profileStatus === 'ok' && profileMeta && (
          <Text size="sm" c="dimmed">
            {!profileMeta.foundKind10002 && !profileMeta.foundKind10063 ? (
              <>
                no kind <Text component="span" fw={700}>10002</Text> or{' '}
                <Text component="span" fw={700}>10063</Text> found for this key on the relays we queried — showing
                relaykit defaults only. publish nip-65 / blossom lists for that key, then refresh.
              </>
            ) : (
              <>
                {profileMeta.foundKind10002 && (
                  <>merged <Text component="span" fw={700}>{profileMeta.userRelayUrlCount}</Text> relay url(s) from kind 10002. </>
                )}
                {profileMeta.foundKind10063 && (
                  <>merged <Text component="span" fw={700}>{profileMeta.userBlossomUrlCount}</Text> blossom base url(s) from kind 10063. </>
                )}
                default relays stay appended for discovery.
              </>
            )}
          </Text>
        )}
        {profileStatus === 'error' && (
          <Text size="sm" c="dimmed">could not load profile events for this key from the network. defaults below still apply — edit as needed.</Text>
        )}
        {profileStatus === 'skipped' && (
          <Text size="sm" c="dimmed">
            enter a valid <Text component="span" fw={700}>publishing key</Text> above, then refresh — or set relay urls
            manually below.
          </Text>
        )}
        {advancedFields.map(renderEndpointField)}
      </FormSection>

      <FormSection
        title="nip-05 names"
        description="optionally publish name@your-domain identities in /.well-known/nostr.json"
      >
        {nip05Rows.length === 0 ? (
          <Text size="sm" c="dimmed">no names yet.</Text>
        ) : (
          nip05Rows.map((row, index) => (
            <Group key={index} gap="xs" align="end" wrap="nowrap">
              <TextInput
                label="username"
                placeholder="sam"
                value={row.name}
                onChange={(e) => {
                  const next = [...nip05Rows];
                  next[index] = { ...next[index], name: e.currentTarget.value };
                  syncNip05Rows(next);
                }}
                style={{ flex: 1 }}
              />
              <TextInput
                label="npub / hex pubkey"
                placeholder="npub1…"
                value={row.pubkey}
                onChange={(e) => {
                  const next = [...nip05Rows];
                  next[index] = { ...next[index], pubkey: e.currentTarget.value };
                  syncNip05Rows(next);
                }}
                style={{ flex: 2 }}
              />
              <Button
                size="xs"
                variant="light"
                color="red"
                onClick={() => syncNip05Rows(nip05Rows.filter((_, i) => i !== index))}
              >
                remove
              </Button>
            </Group>
          ))
        )}
        <Group>
          <Button
            size="xs"
            variant="default"
            onClick={() => syncNip05Rows([...nip05Rows, { name: '', pubkey: '' }])}
          >
            add user
          </Button>
        </Group>
      </FormSection>
    </Stack>
  );
};
