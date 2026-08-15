import { useEffect, useState } from 'react'
import { Button, Divider, Group, Select, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { nip19 } from 'nostr-tools'
import { DISCOVERY_RELAYS, NpubInput, RelayPillsInput, fetchRelayList, npubToHex } from '@relaykit/ui'
import type { RelaySuggestionGroup } from '@relaykit/ui'
import { saveConfig, type HubConfigResponse } from '@/lib/api'
import { type HubParams } from '@/lib/queryParams'
import { LINK_CLIENTS, type LinkClient } from '../../types'

/** relaykit passes the identity as a raw hex pubkey via ?npub=; accept both formats. */
const toNpub = (value: string | null): string => {
  if (!value) return ''
  if (/^[a-fA-F0-9]{64}$/.test(value)) {
    try {
      return nip19.npubEncode(value.toLowerCase())
    } catch {
      return ''
    }
  }
  return value
}

export const SettingsView = ({ config, params }: { config: HubConfigResponse; params: HubParams }) => {
  const queryClient = useQueryClient()
  // Only ever what's actually saved — nothing is prefilled from the launch params, since a
  // silently seeded npub/relay gets saved by accident and then watched for real.
  const [npub, setNpub] = useState(toNpub(config.npub))
  const [relays, setRelays] = useState<string[]>(config.relays)
  const [discoveryRelays, setDiscoveryRelays] = useState<string[]>(config.discoveryRelays)
  const [linkClient, setLinkClient] = useState<LinkClient>(config.linkClient)
  const [ownRelays, setOwnRelays] = useState<string[]>([])

  const npubHex = npubToHex(npub)
  useEffect(() => {
    setOwnRelays([])
    if (!npubHex) return
    let cancelled = false
    fetchRelayList(npubHex).then((list) => {
      if (!cancelled) setOwnRelays(list)
    })
    return () => {
      cancelled = true
    }
  }, [npubHex])

  const relaySuggestions: RelaySuggestionGroup[] = [
    { label: 'your relay list', relays: ownRelays },
    { label: 'from relaykit', relays: params.relays },
  ].filter((group) => group.relays.length > 0)

  const discoverySuggestions: RelaySuggestionGroup[] = [
    { label: 'aggregators', relays: [...DISCOVERY_RELAYS] },
    { label: 'your relay list', relays: ownRelays },
  ].filter((group) => group.relays.length > 0)

  const dirty =
    npub.trim() !== (config.npub ?? '') ||
    linkClient !== config.linkClient ||
    relays.join(',') !== config.relays.join(',') ||
    discoveryRelays.join(',') !== config.discoveryRelays.join(',')

  const saveMutation = useMutation({
    mutationFn: () => saveConfig(npub.trim(), relays, discoveryRelays, linkClient),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      notifications.show({ message: 'settings saved' })
    },
    onError: (err) => notifications.show({ color: 'red', message: String(err) }),
  })

  return (
    <Stack gap="lg" maw={640}>
      <Text size="sm" fw={600}>settings</Text>

      {!config.npub && (
        <Text size="xs" c="dimmed">
          set your npub and the relays to watch. matching events will be pushed to your registered devices.
        </Text>
      )}

      <NpubInput
        size="xs"
        label="your npub"
        value={npub}
        onChange={setNpub}
        mine={toNpub(params.npub) || null}
      />

      <Divider />

      <Stack gap="md">
        <Stack gap={4}>
          <Text size="xs" fw={500}>relays to watch</Text>
          <Text size="xs" c="dimmed">
            only these are watched for events — pick the ones you actually publish and receive on
          </Text>
          <RelayPillsInput
            value={relays}
            onChange={setRelays}
            knownUrls={params.relays}
            storageKey="nh:previous-relays"
            suggestions={relaySuggestions}
          />
        </Stack>

        <Stack gap={4}>
          <Text size="xs" fw={500}>discovery relays</Text>
          <Text size="xs" c="dimmed">
            profile aggregators used to resolve names and avatars when the watch relays don't have them
          </Text>
          <RelayPillsInput
            value={discoveryRelays}
            onChange={setDiscoveryRelays}
            knownUrls={[]}
            storageKey="nh:previous-discovery-relays"
            suggestions={discoverySuggestions}
          />
        </Stack>
      </Stack>

      <Divider />

      <Select
        size="xs"
        label="open notifications in"
        description="which client a tapped notification opens the event in"
        data={Object.entries(LINK_CLIENTS).map(([value, { label }]) => ({ value, label }))}
        value={linkClient}
        onChange={(value) => value && setLinkClient(value as LinkClient)}
        allowDeselect={false}
      />

      <Divider />

      <Group justify="flex-end">
        <Button
          size="xs"
          disabled={!dirty || !npub.trim().startsWith('npub1') || relays.length === 0}
          loading={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          save
        </Button>
      </Group>
    </Stack>
  )
}
