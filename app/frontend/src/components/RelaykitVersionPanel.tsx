import { useCallback, useEffect, useRef, useState } from 'react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../../backend/src/trpc'
import { RubixLoader, RubixLoaderColor } from '@samthomson/rubix-loader'
import { Badge, Button, Collapse, Group, Modal, Paper, ScrollArea, SegmentedControl, Stack, Text } from '@mantine/core'
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

  // After the update starts the old backend dies mid-recreate; poll until the whole stack is
  // actually serving again — the new backend reports the target version, dokploy answers, and
  // the frontend itself loads (traefik + frontend container are also recreated; navigating
  // before that would show a 502) — then land on home (deep links can 404 during the swap).
  const waitForBackend = useCallback((targetVersion: string) => {
    let goodPolls = 0
    const isOurPage = (html: string) => html.includes('id="root"')
    // Give compose a moment to tear the old containers down before polling for the new ones.
    window.setTimeout(() => {
      pollRef.current = window.setInterval(async () => {
        try {
          const page = await fetch(window.location.origin + '/', { cache: 'no-store' })
          if (!page.ok || !isOurPage(await page.text())) {
            goodPolls = 0
            return
          }
          // Require consecutive successes: traefik is also being recreated and can 404 between polls.
          if (++goodPolls < 3) return
          const version = await trpc.getRelaykitVersion.query()
          if (version.version !== targetVersion) return
          const dokploy = await trpc.checkDokploy.query()
          if (dokploy.reachable) window.location.assign('/')
        } catch {
          goodPolls = 0
        }
      }, 2000)
    }, 5000)
  }, [])

  const startUpdate = useCallback(async () => {
    if (updating || !check?.latest) return
    // Optimistic: the updating state must appear instantly so a slow response never invites a second click.
    setUpdating(true)
    setUpdateError(null)
    try {
      await trpc.updateRelaykit.mutate()
      waitForBackend(check.latest.version)
    } catch (e) {
      setUpdating(false)
      setUpdateError(e instanceof Error ? e.message : 'update failed to start')
    }
  }, [updating, check, waitForBackend])

  if (!check) return null

  return (
    <>
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

      <Modal
        opened={modalOpen}
        onClose={() => { if (!updating) setModalOpen(false) }}
        closeOnClickOutside={!updating}
        closeOnEscape={!updating}
        withCloseButton={!updating}
        title="relaykit"
        size="md"
        centered
      >
        <Stack gap="md">
          {updating ? (
            <Stack align="center" gap="xs" py="lg">
              <RubixLoader size={48} speed={0.9} colors={[RubixLoaderColor.RelayKit]} />
              <Text size="sm" fw={500}>updating relaykit…</Text>
              <Text size="xs" c="dimmed" ta="center">
                updating the whole stack (relaykit + dokploy + traefik).<br />
                this page will reconnect automatically — don't close it.
              </Text>
            </Stack>
          ) : (
          <>
          <Stack gap="xs">
            <Text size="xs" fw={600} c="dimmed" tt="uppercase">current</Text>
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm">v{check.current.version}</Text>
              {check.updateCheckSupported ? (
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
              ) : null}
            </Group>
            {check.changelog ? (
              <>
                <Button variant="subtle" size="compact-xs" p={0} h="auto" style={{ width: 'fit-content' }} onClick={() => setNotesOpen((o) => !o)}>
                  {notesOpen ? 'hide changelog' : 'changelog'}
                </Button>
                <Collapse in={notesOpen}>
                  <ScrollArea.Autosize mah={220} type="hover" offsetScrollbars>
                    <Text size="xs" ff="monospace" c="dimmed" style={{ whiteSpace: 'pre-wrap' }} py={4}>{check.changelog}</Text>
                  </ScrollArea.Autosize>
                </Collapse>
              </>
            ) : null}
          </Stack>

          {/* next release, or status */}
          {check.updateAvailable && check.latest ? (
            <Paper withBorder p="sm">
              <Stack gap="xs">
                <Group justify="space-between" wrap="nowrap">
                  <Group gap={6} wrap="nowrap">
                    <IconArrowUp size={14} />
                    <Text size="sm" fw={600}>v{check.latest.version}</Text>
                  </Group>
                  <Button size="xs" onClick={startUpdate}>update</Button>
                </Group>
                {check.latest.notes ? (
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{check.latest.notes}</Text>
                ) : null}
                <Text size="xs" c="dimmed">
                  updates the whole stack: relaykit + dokploy + traefik. your services stay online;
                  the dashboard restarts (~a minute).
                </Text>
              </Stack>
            </Paper>
          ) : (
            <Group justify="flex-end">
              {!check.updateCheckSupported ? (
                <Badge size="sm" variant="light" color="gray" leftSection={<IconInfoCircle size={12} />}>
                  updates unavailable on this instance
                </Badge>
              ) : check.error ? (
                <Badge size="sm" variant="light" color="orange" leftSection={<IconAlertCircle size={12} />}>
                  couldn't check for updates
                </Badge>
              ) : (
                <Badge size="sm" variant="light" color="teal" leftSection={<IconCircleCheck size={12} />}>
                  up to date
                </Badge>
              )}
            </Group>
          )}
          {updateError ? (
            <Text size="sm" c="red">{updateError}</Text>
          ) : null}
          </>
          )}
        </Stack>
      </Modal>
    </>
  )
}
