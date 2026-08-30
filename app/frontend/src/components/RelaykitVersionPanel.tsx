import { useCallback, useEffect, useRef, useState } from 'react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../../backend/src/trpc'
import { Badge, Button, Center, Collapse, Group, Loader, Modal, Overlay, Paper, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core'
import { IconAlertCircle, IconArrowUp, IconCircleCheck, IconInfoCircle } from '@tabler/icons-react'
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
  const [notesOpen, setNotesOpen] = useState(false)
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

  // After the update starts the old backend dies mid-recreate; poll until the new one is up AND
  // dokploy answers, then land on home (deep links can 404 during the swap window).
  const waitForBackend = useCallback(() => {
    // Give compose a moment to tear the old container down before polling for the new one.
    window.setTimeout(() => {
      pollRef.current = window.setInterval(async () => {
        try {
          await trpc.getRelaykitVersion.query()
          const dokploy = await trpc.checkDokploy.query()
          if (dokploy.reachable) window.location.assign('/')
        } catch {
          // still down (or old container mid-shutdown) — keep waiting
        }
      }, 2000)
    }, 5000)
  }, [])

  const startUpdate = useCallback(async () => {
    if (updating) return
    // Optimistic: the overlay must appear instantly so a slow response never invites a second click.
    setUpdating(true)
    setModalOpen(false)
    setUpdateError(null)
    try {
      await trpc.updateRelaykit.mutate()
      waitForBackend()
    } catch (e) {
      setUpdating(false)
      setUpdateError(e instanceof Error ? e.message : 'update failed to start')
    }
  }, [updating, waitForBackend])

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
            <Stack gap={4} align="flex-end">
              <Text size="sm" fw={600}>v{check.current.version}</Text>
              {check.current.notes ? (
                <Button variant="subtle" size="compact-xs" p={0} h="auto" onClick={() => setNotesOpen((o) => !o)}>
                  {notesOpen ? 'hide release notes' : 'release notes'}
                </Button>
              ) : null}
            </Stack>
          </Group>
          <Collapse in={notesOpen}>
            <Paper withBorder p="sm">
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{check.current.notes}</Text>
            </Paper>
          </Collapse>
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
                <Group justify="flex-end">
                  <Badge size="sm" variant="light" color="orange" leftSection={<IconAlertCircle size={12} />}>
                    couldn't check for updates
                  </Badge>
                </Group>
              ) : (
                <Group justify="flex-end">
                  <Badge size="sm" variant="light" color="teal" leftSection={<IconCircleCheck size={12} />}>
                    up to date
                  </Badge>
                </Group>
              )}
            </>
          ) : (
            <Group justify="flex-end">
              <Badge size="sm" variant="light" color="gray" leftSection={<IconInfoCircle size={12} />}>
                updates unavailable on this instance
              </Badge>
            </Group>
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
