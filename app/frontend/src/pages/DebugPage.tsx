import { Fragment, useEffect, useMemo, useState } from 'react'
import { Stack, Paper, Group, Text, Button, Badge, Table, ActionIcon, Tooltip } from '@mantine/core'
import { IconRefresh, IconSkull, IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import { useAuth } from '../contexts/AuthContext'
import { getIdentityKeys } from '../lib/identityKeys'
import { trpc } from '../trpc'

type RoutingHealthHost = {
  host: string
  services: string[]
  dotless: boolean
  resolvable: boolean
  cloudflareProxied: boolean
  ips: string[]
}
type RoutingHealth = { checkedAt: number; hosts: RoutingHealthHost[]; unhealthy: RoutingHealthHost[] }


export const DebugPage = () => {
  const { npub, token } = useAuth()
  const { hex, npub: encodedNpub } = getIdentityKeys(npub)
  const [runtime, setRuntime] = useState<Awaited<ReturnType<typeof trpc.getRuntimeContainers.query>> | null>(null)
  const [services, setServices] = useState<Awaited<ReturnType<typeof trpc.listServices.query>>>([])
  const [runtimeLoading, setRuntimeLoading] = useState(true)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [expandedServiceIds, setExpandedServiceIds] = useState<string[]>([])
  const [routingHealth, setRoutingHealth] = useState<RoutingHealth | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)

  const loadRuntime = async () => {
    try {
      const [next, nextServices] = await Promise.all([
        trpc.getRuntimeContainers.query(),
        trpc.listServices.query(),
      ])
      setRuntime(next)
      setServices(nextServices)
      setRuntimeError(null)
    } catch (error: any) {
      setRuntimeError(error?.message || 'could not load runtime containers')
    } finally {
      setRuntimeLoading(false)
    }
  }

  useEffect(() => {
    void loadRuntime()
  }, [])

  const serviceRows = useMemo(() => {
    if (!runtime) return []
    const containersByComposeId = new Map<string, any[]>()
    for (const container of runtime.containers) {
      if (!container.composeId) continue
      const existing = containersByComposeId.get(container.composeId)
      if (existing) {
        existing.push(container)
      } else {
        containersByComposeId.set(container.composeId, [container])
      }
    }

    return services
      .map((service: any) => {
        const containers = containersByComposeId.get(service.composeId) || []
        const volumeMap = new Map<string, string>()
        for (const container of containers) {
          for (const mount of container.mounts || []) {
            if (mount.type !== 'volume') continue
            const id = mount.name || mount.source
            if (!id) continue
            volumeMap.set(id, mount.destination || '—')
          }
        }
        return {
          composeId: service.composeId as string,
          serviceName: service.name || '—',
          serviceType: service.serviceType || service.type || '—',
          serviceStatus: String(service.status || 'unknown').toLowerCase(),
          hostname: service.hostname || '—',
          projectName: service.projectName || '—',
          environmentName: service.environmentName || '—',
          containers,
          volumes: Array.from(volumeMap.entries()).map(([id, destination]) => ({ id, destination })),
        }
      })
      .sort((a, b) => a.hostname.localeCompare(b.hostname))
  }, [runtime, services])

  const unlinkedContainers = useMemo(() => {
    if (!runtime) return []
    return runtime.containers.filter((container: any) => !container.composeId)
  }, [runtime])

  const orphanedVolumes = useMemo(() => {
    if (!runtime) return []
    return (runtime.volumes || []).filter((volume: any) => volume.attachedServices === 0)
  }, [runtime])

  const toggleExpandedService = (composeId: string) => {
    setExpandedServiceIds((prev) =>
      prev.includes(composeId) ? prev.filter((id) => id !== composeId) : [...prev, composeId]
    )
  }

  const handleKillContainer = async (containerId: string, containerName: string) => {
    if (!window.confirm(`kill container ${containerName}?`)) return
    setBusyKey(`kill:${containerId}`)
    try {
      await trpc.killRuntimeContainer.mutate({ containerId })
      await loadRuntime()
    } finally {
      setBusyKey(null)
    }
  }
  const ghostRouters = useMemo(() => {
    if (!runtime) return []
    return runtime.containers
      .filter((container: any) => (container.staleRoutingHosts || []).length > 0)
      .flatMap((container: any) =>
        container.staleRoutingHosts.map((host: string) => ({
          host,
          containerName: container.name as string,
          composeId: container.composeId as string | null,
          composeName: container.composeName as string | null,
        }))
      )
  }, [runtime])

  const handleHardReset = async (composeId: string, composeName: string) => {
    if (!window.confirm(`hard reset service ${composeName}? this will remove runtime containers and redeploy.`)) return
    setBusyKey(`reset:${composeId}`)
    try {
      await trpc.hardResetServiceRuntime.mutate({ composeId })
      await loadRuntime()
    } finally {
      setBusyKey(null)
    }
  }

  const handleCheckRouting = async () => {
    setHealthLoading(true)
    try {
      setRoutingHealth(await trpc.checkRoutingHealth.query())
    } finally {
      setHealthLoading(false)
    }
  }

  return (
    <Stack gap="xl" p="xl">
      <Paper withBorder p="md">
        <Text fw={500} mb="sm">identity</Text>
        <Stack gap="sm">
          {hex && (
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="sm" c="dimmed">hex</Text>
                <Button size="xs" variant="subtle" onClick={() => navigator.clipboard.writeText(hex)}>copy</Button>
              </Group>
              <Text size="sm" ff="monospace" style={{ wordBreak: 'break-all' }}>
                {hex}
              </Text>
            </Stack>
          )}
          {encodedNpub && (
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="sm" c="dimmed">npub</Text>
                <Button size="xs" variant="subtle" onClick={() => navigator.clipboard.writeText(encodedNpub)}>copy</Button>
              </Group>
              <Text size="sm" ff="monospace" style={{ wordBreak: 'break-all' }}>
                {encodedNpub}
              </Text>
            </Stack>
          )}
        </Stack>
      </Paper>
      <Paper withBorder p="md">
        <Stack gap="xs">
          <Group justify="space-between">
            <Text fw={500}>dokploy key</Text>
            <Button size="xs" variant="subtle" onClick={() => navigator.clipboard.writeText(token || '')}>copy</Button>
          </Group>
          <Text size="sm" ff="monospace" style={{ wordBreak: 'break-all' }}>
            {token || '—'}
          </Text>
        </Stack>
      </Paper>

      <Paper withBorder p="md">
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Text fw={500}>runtime containers</Text>
            <ActionIcon
              variant="subtle"
              color="relaykit"
              aria-label="refresh runtime containers"
              onClick={() => void loadRuntime()}
              loading={runtimeLoading}
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Group>

          {runtime ? (
            <Group gap="xs">
              <Badge variant="light" color="gray">total {runtime.summary.total}</Badge>
              <Badge variant="light" color="green">managed {runtime.summary.managed}</Badge>
              <Badge variant="light" color="red">orphaned {runtime.summary.orphaned}</Badge>
              {runtime.summary.ghostRouters > 0 ? (
                <Badge variant="light" color="orange">ghost routers {runtime.summary.ghostRouters}</Badge>
              ) : null}
              <Badge variant="light" color="blue">running {runtime.summary.running}</Badge>
            </Group>
          ) : null}

          {runtimeError ? <Text c="red" size="sm">{runtimeError}</Text> : null}
          <Text size="xs" c="dimmed">
            hard reset removes that service runtime and redeploys to rebuild from saved config. kill removes one container only.
          </Text>

          {serviceRows.length > 0 ? (
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th></Table.Th>
                  <Table.Th>host</Table.Th>
                  <Table.Th>service</Table.Th>
                  <Table.Th>type</Table.Th>
                  <Table.Th>status</Table.Th>
                  <Table.Th>containers</Table.Th>
                  <Table.Th>volumes</Table.Th>
                  <Table.Th>actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {serviceRows.map((row) => (
                  <Fragment key={row.composeId}>
                    <Table.Tr>
                      <Table.Td>
                        <ActionIcon variant="subtle" color="gray" onClick={() => toggleExpandedService(row.composeId)} aria-label="toggle service details">
                          {expandedServiceIds.includes(row.composeId) ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                        </ActionIcon>
                      </Table.Td>
                      <Table.Td><Text size="sm" ff="monospace">{row.hostname}</Text></Table.Td>
                      <Table.Td>
                        <Stack gap={0}>
                          <Text size="sm">{row.serviceName}</Text>
                          <Text size="xs" c="dimmed">{row.projectName} / {row.environmentName}</Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td>{String(row.serviceType).toLowerCase()}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" color={row.serviceStatus === 'running' ? 'green' : row.serviceStatus === 'error' ? 'red' : 'gray'}>
                          {row.serviceStatus}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{row.containers.length}</Table.Td>
                      <Table.Td>{row.volumes.length}</Table.Td>
                      <Table.Td>
                        <Tooltip label="remove service containers then redeploy this service">
                          <Button
                            size="xs"
                            color="red"
                            variant="light"
                            leftSection={<IconSkull size={12} />}
                            loading={busyKey === `reset:${row.composeId}`}
                            onClick={() => void handleHardReset(row.composeId, row.serviceName)}
                          >
                            hard reset
                          </Button>
                        </Tooltip>
                      </Table.Td>
                    </Table.Tr>
                    {expandedServiceIds.includes(row.composeId) ? (
                      <Table.Tr>
                        <Table.Td colSpan={8}>
                          <Stack gap="xs">
                            <Text size="xs" c="dimmed">containers</Text>
                            {row.containers.length > 0 ? (
                              row.containers.map((container: any) => (
                                <Group key={container.containerId} justify="space-between" wrap="nowrap">
                                  <Stack gap={0}>
                                    <Text size="sm">{container.name}</Text>
                                    <Text size="xs" c="dimmed" ff="monospace">{container.image}</Text>
                                  </Stack>
                                  <Group gap="xs" wrap="nowrap">
                                    <Badge variant="light" color={container.state === 'running' ? 'green' : 'gray'}>
                                      {container.state || 'unknown'}
                                    </Badge>
                                    <Button
                                      size="xs"
                                      color="red"
                                      variant="light"
                                      loading={busyKey === `kill:${container.containerId}`}
                                      onClick={() => void handleKillContainer(container.containerId, container.name)}
                                    >
                                      kill
                                    </Button>
                                  </Group>
                                </Group>
                              ))
                            ) : (
                              <Text size="sm" c="dimmed">none</Text>
                            )}

                            <Text size="xs" c="dimmed" mt="xs">volumes</Text>
                            {row.volumes.length > 0 ? (
                              row.volumes.map((volume: any) => (
                                <Group key={`${row.composeId}:${volume.id}`} justify="space-between" wrap="nowrap">
                                  <Text size="sm" ff="monospace">{volume.id}</Text>
                                  <Text size="xs" c="dimmed">{volume.destination}</Text>
                                </Group>
                              ))
                            ) : (
                              <Text size="sm" c="dimmed">none</Text>
                            )}
                          </Stack>
                        </Table.Td>
                      </Table.Tr>
                    ) : null}
                  </Fragment>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Text size="sm" c="dimmed">no mapped service containers.</Text>
          )}

          <Text fw={500}>unlinked containers</Text>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>container</Table.Th>
                <Table.Th>state</Table.Th>
                <Table.Th>project label</Table.Th>
                <Table.Th>volumes</Table.Th>
                <Table.Th>action</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {unlinkedContainers.map((container) => (
                <Table.Tr key={container.containerId}>
                  <Table.Td>
                    <Stack gap={2}>
                      <Text size="sm">{container.name}</Text>
                      <Text size="xs" c="dimmed" ff="monospace">{container.image}</Text>
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      variant="light"
                      color={container.state === 'running' ? 'green' : container.isOrphan ? 'red' : 'gray'}
                    >
                      {container.state || 'unknown'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{container.composeProject || '—'}</Table.Td>
                  <Table.Td>
                    <Stack gap={2}>
                      {(container.mounts || [])
                        .filter((mount: any) => mount.type === 'volume')
                        .slice(0, 3)
                        .map((mount: any) => (
                          <Text key={`${container.containerId}:${mount.name || mount.source}`} size="xs" ff="monospace">
                            {mount.name || mount.source}
                          </Text>
                        ))}
                      {(container.mounts || []).filter((mount: any) => mount.type === 'volume').length > 3 ? (
                        <Text size="xs" c="dimmed">…</Text>
                      ) : null}
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Tooltip label="remove only this container (service may auto-recreate it)">
                      <Button
                        size="xs"
                        color="red"
                        variant="light"
                        loading={busyKey === `kill:${container.containerId}`}
                        onClick={() => void handleKillContainer(container.containerId, container.name)}
                      >
                        kill
                      </Button>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          <Text fw={500}>orphaned volumes</Text>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>volume</Table.Th>
                <Table.Th>type</Table.Th>
                <Table.Th>containers</Table.Th>
                <Table.Th>source</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {orphanedVolumes.map((volume: any) => (
                <Table.Tr key={volume.id}>
                  <Table.Td><Text size="sm" ff="monospace">{volume.id}</Text></Table.Td>
                  <Table.Td>{volume.type}</Table.Td>
                  <Table.Td>{volume.containerNames.join(', ')}</Table.Td>
                  <Table.Td><Text size="xs" c="dimmed" ff="monospace">{volume.source || '—'}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      </Paper>

      <Paper withBorder p="md">
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Text fw={500}>routing health</Text>
            <Button size="xs" variant="light" loading={healthLoading} onClick={() => void handleCheckRouting()}>
              check dns
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            ghost routers are hosts still advertised by a running container's traefik labels but no longer in its domain config — they retry certificate issuance forever. fix by redeploying (or hard reset) the service. unresolvable or dotless hosts can never route or issue a cert.
          </Text>

          {ghostRouters.length > 0 ? (
            <Stack gap="xs">
              <Text size="sm" fw={500} c="orange">ghost routers</Text>
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>host</Table.Th>
                    <Table.Th>service</Table.Th>
                    <Table.Th>container</Table.Th>
                    <Table.Th></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {ghostRouters.map((ghost) => (
                    <Table.Tr key={`${ghost.containerName}:${ghost.host}`}>
                      <Table.Td><Text size="sm" ff="monospace">{ghost.host}</Text></Table.Td>
                      <Table.Td>{ghost.composeName || '—'}</Table.Td>
                      <Table.Td><Text size="xs" ff="monospace" c="dimmed">{ghost.containerName}</Text></Table.Td>
                      <Table.Td>
                        {ghost.composeId ? (
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="orange"
                            loading={busyKey === `reset:${ghost.composeId}`}
                            onClick={() => ghost.composeName && void handleHardReset(ghost.composeId, ghost.composeName)}
                          >
                            hard reset
                          </Button>
                        ) : null}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          ) : null}

          {routingHealth ? (
            <Stack gap="xs">
              <Text size="sm" fw={500}>
                dns check — {routingHealth.hosts.length} hosts, {routingHealth.unhealthy.length} flagged
              </Text>
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>host</Table.Th>
                    <Table.Th>services</Table.Th>
                    <Table.Th>status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {routingHealth.hosts.map((h) => (
                    <Table.Tr key={h.host} bg={routingHealth.unhealthy.some((u) => u.host === h.host) ? 'var(--mantine-color-warning-light)' : undefined}>
                      <Table.Td><Text size="sm" ff="monospace">{h.host}</Text></Table.Td>
                      <Table.Td><Text size="xs">{h.services.join(', ')}</Text></Table.Td>
                      <Table.Td>
                        {h.dotless ? (
                          <Badge variant="light" color="red">dotless</Badge>
                        ) : !h.resolvable ? (
                          <Badge variant="light" color="red">no dns record</Badge>
                        ) : h.cloudflareProxied ? (
                          <Badge variant="light" color="orange">cf proxied</Badge>
                        ) : (
                          <Badge variant="light" color="green">ok</Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          ) : null}
        </Stack>
      </Paper>
    </Stack>
  )
}
