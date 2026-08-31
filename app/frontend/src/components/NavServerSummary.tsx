import { type ReactNode } from 'react'
import { Badge, Box, Group, Paper, Text, Tooltip } from '@mantine/core'
import { IconAlertOctagon, IconAlertTriangle, IconCpu, IconDatabase, IconServer } from '@tabler/icons-react'
import { useInsights } from '../contexts/InsightsContext'
import { getInsightSeverity, getOverallSeverity, type InsightSeverity } from '../../../shared/insights'
import { demoServerSeverity } from './SystemStatusBanner'

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
)

export const NavServerSummary = () => {
  const { insights } = useInsights()

  if (!insights) return null
  const { current, thresholds } = insights
  const severity: InsightSeverity = demoServerSeverity() ?? getOverallSeverity([
    getInsightSeverity(current.cpuPct, thresholds.cpu.warn, thresholds.cpu.critical),
    getInsightSeverity(current.memoryUsedPct, thresholds.memory.warn, thresholds.memory.critical),
    getInsightSeverity(current.diskUsedPct, thresholds.disk.warn, thresholds.disk.critical),
  ])

  return (
    <Paper withBorder p="xs" mt="sm">
      <Group gap={6} mb={4} wrap="nowrap">
        <Text size="xs" fw={600}>server</Text>
        {severity !== 'normal' && (
          <Badge
            variant="filled"
            size="xs"
            color={severity === 'critical' ? 'red' : 'yellow'}
            leftSection={severity === 'critical' ? <IconAlertOctagon size={12} /> : <IconAlertTriangle size={12} />}
          >
            {severity === 'critical' ? 'critical' : 'warning'}
          </Badge>
        )}
      </Group>
      <Group gap={8} wrap="nowrap">
        <InlineMetric
          label={`CPU usage: ${formatPercentRounded(current.cpuPct)} (load ${Math.round(current.load1)}/${Math.round(current.load5)}/${Math.round(current.load15)})`}
          value={formatPercentRounded(current.cpuPct)}
          icon={<IconCpu size={12} />}
        />
        <Text size="xs" c="gray.5">•</Text>
        <InlineMetric
          label={`Memory usage: ${formatBytesRounded(current.memoryUsedBytes)} / ${formatBytesRounded(current.memoryTotalBytes)} (${formatPercentRounded(current.memoryUsedPct)})`}
          value={formatBytesRounded(current.memoryUsedBytes)}
          icon={<IconServer size={12} />}
        />
        <Text size="xs" c="gray.5">•</Text>
        <InlineMetric
          label={`Disk usage: ${formatPercentRounded(current.diskUsedPct)} (${formatBytesRounded(current.diskUsedBytes)} / ${formatBytesRounded(current.diskTotalBytes)})`}
          value={formatBytesRounded(current.diskUsedBytes)}
          icon={<IconDatabase size={12} />}
        />
      </Group>
    </Paper>
  )
}
