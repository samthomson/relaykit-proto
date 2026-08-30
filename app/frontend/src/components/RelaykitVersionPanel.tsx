import { useCallback, useEffect, useRef, useState } from 'react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../../backend/src/trpc'
import { Badge, Group, Modal, Overlay, Paper, SegmentedControl, Stack, Text, Button, Center, Loader, Tooltip } from '@mantine/core'
import { IconArrowUp } from '@tabler/icons-react'
import { trpc } from '../trpc'

type RouterOutputs = inferRouterOutputs<AppRouter>
type UpdateCheck = RouterOutputs['checkRelaykitUpdate']

/**
 * Version + self-update surface for the relaykit stack.
 * - navbar row: current version (dokploy engine pin in tooltip), badge when an update is available
 * - modal: channel picker (stable/beta), latest version + notes, update button
 * - after update starts: overlay + poll until the backend is back, then reload
 */
export const RelaykitVersionPanel = () => {
  const [check, setCheck] = useState<UpdateCheck | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [channelSwitching, setChannelSwitching] = useState(false)
  const pollRef = useRef<number | null>(null)

  const loadCheck = useCallback(async () => {
    try {
      setCheck(await trpc.checkRelaykitUpdate.query())
    } catch {
      // nav stays quiet when the check can't run (e.g. no docker socket)
    }
  }, [])

  useEffect(() => {
    void loadCheck()
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current)
    }
  }, [loadCheck])

  // After the update starts the old backend dies mid-recreate; poll until the new one answers, then reload.
  const waitForBackend = useCallback(() => {
    // Give compose a moment to tear the old container down before polling for the new one.
    window.setTimeout(() => {
      pollRef.current = window.setInterval(async () => {
        try {
          await trpc.getRelaykitVersion.query()
          window.location.reload()
        } catch {
          // still down (or old container mid-shutdown) — keep waiting
        }
      }, 2000)
    }, 5000)
  }, [])

  const startUpdate = useCallback(async () => {
    setUpdateError(null)
    try {
      await trpc.updateRelaykit.mutate()
      setUpdating(true)
      setModalOpen(false)
      waitForBackend()
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : 'update failed to start')
    }
  }, [waitForBackend])

  if (!check) return null

  return (
    <>
      <Tooltip label={`dokploy engine ${check.current.dokployVersion}`} withArrow position="right">
        <Paper
          withBorder
          p="xs"
          mt="xs"
          style={{ cursor: 'pointer' }}
          onClick={() => setModalOpen(true)}
        >
          <Group gap={6} wrap="nowrap" justify="space-between">
            <Group gap={6} wrap="nowrap">
              <Text size="xs" fw={600}>relaykit</Text>
              <Text size="xs" c="dimmed">v{check.current.version}</Text>
            </Group>
            {check.updateAvailable ? (
              <Badge size="xs" variant="light" color="green" leftSection={<IconArrowUp size={10} />}>
                update
              </Badge>
            ) : null}
          </Group>
        </Paper>
      </Tooltip>

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title="relaykit" size="md" centered>
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start">
            <Text size="sm" c="dimmed">current</Text>
            <Stack gap={2} align="flex-end">
              <Text size="sm">v{check.current.version}</Text>
              <Text size="xs" c="dimmed" ml="md">dokploy {check.current.dokployVersion}</Text>
            </Stack>
          </Group>
          {check.updateCheckSupported ? (
            <>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">channel</Text>
                <SegmentedControl
                  size="xs"
                  disabled={channelSwitching}
                  value={check.channel}
                  data={(check.channels ?? ['stable']).map((c: string) => ({ value: c, label: c }))}
                  onChange={(value) => {
                    void (async () => {
                      setChannelSwitching(true)
                      try {
                        await trpc.setUpdateChannel.mutate({ channel: value as 'stable' | 'beta' })
                        await loadCheck()
                      } finally {
                        setChannelSwitching(false)
                      }
                    })()
                  }}
                />
              </Group>
              {check.updateAvailable && check.latest ? (
                <>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">available</Text>
                    <Text size="sm" fw={600}>v{check.latest.version}</Text>
                  </Group>
                  {check.latest.notes ? (
                    <Paper withBorder p="sm">
                      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{check.latest.notes}</Text>
                    </Paper>
                  ) : null}
                  <Text size="xs" c="dimmed">
                    updates the whole stack: relaykit + dokploy + traefik. your services stay online;
                    the dashboard restarts (~a minute).
                  </Text>
                  <Group justify="flex-end">
                    <Button size="sm" onClick={startUpdate}>update to v{check.latest.version}</Button>
                  </Group>
                </>
              ) : check.error ? (
                <Text size="sm" c="dimmed">
                  couldn't check for updates right now
                  {check.error ? <Tooltip label={check.error} withArrow><Text component="span" size="xs" c="dimmed" style={{ textDecoration: 'underline dotted' }}> (details)</Text></Tooltip> : null}
                </Text>
              ) : (
                <Text size="sm" c="dimmed">up to date</Text>
              )}
            </>
          ) : (
            <Text size="sm" c="dimmed">updates aren't available on this instance</Text>
          )}
          {updateError ? (
            <Text size="sm" c="red">{updateError}</Text>
          ) : null}
        </Stack>
      </Modal>

      {updating ? (
        <Overlay fixed blur={2} zIndex={200}>
          <Center h="100%">
            <Stack align="center" gap="xs">
              <Loader />
              <Text size="sm" fw={500}>updating relaykit…</Text>
              <Text size="xs" c="dimmed">this page will reconnect automatically</Text>
            </Stack>
          </Center>
        </Overlay>
      ) : null}
    </>
  )
}
