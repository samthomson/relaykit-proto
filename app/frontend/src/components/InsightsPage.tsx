import { LineChart } from '@mantine/charts';
import { Badge, Group, Paper, Progress, SimpleGrid, Stack, Text, rem } from '@mantine/core';
import { IconAlertOctagon, IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react';
import { RubixLoader, RubixLoaderColor } from '@samthomson/rubix-loader';
import { useInsights } from '../contexts/InsightsContext';
import {
  formatBytes,
  formatPercent,
  formatUptime,
  formatWindow,
  getInsightSeverity,
  getOverallSeverity,
  getPressure,
  getSeverityColor,
} from '../../../shared/insights';

export const InsightsPage = () => {
  const { insights, error } = useInsights();

  if (!insights && !error) {
    return (
      <Stack align="center" justify="center" gap="sm" p="xl" style={{ minHeight: rem(480) }}>
        <RubixLoader size={144} colors={[RubixLoaderColor.RelayKit]} speed={1.35} />
        <Text size="sm" c="dimmed">loading server insights…</Text>
      </Stack>
    );
  }

  if (error && !insights) {
    return (
      <Stack gap="xl" p="xl">
        <Paper withBorder p="md">
          <Text fw={500} c="red">could not load insights</Text>
          <Text size="sm" c="dimmed" mt={6}>{error}</Text>
        </Paper>
      </Stack>
    );
  }

  if (!insights) return null;

  const { current, thresholds } = insights;
  const cpuSeverity = getInsightSeverity(current.cpuPct, thresholds.cpu.warn, thresholds.cpu.critical);
  const memSeverity = getInsightSeverity(current.memoryUsedPct, thresholds.memory.warn, thresholds.memory.critical);
  const diskSeverity = getInsightSeverity(current.diskUsedPct, thresholds.disk.warn, thresholds.disk.critical);
  const processRssPct = current.memoryTotalBytes > 0 ? (current.processRssBytes / current.memoryTotalBytes) * 100 : 0;
  const processHeapPct = current.memoryTotalBytes > 0 ? (current.processHeapUsedBytes / current.memoryTotalBytes) * 100 : 0;
  const recommendations: string[] = [];
  if (cpuSeverity !== 'normal') recommendations.push('cpu is elevated. if this persists, upgrade to more vcpu.');
  if (memSeverity !== 'normal') recommendations.push('memory is near capacity. increase ram to avoid oom pressure.');
  if (diskSeverity !== 'normal') recommendations.push('disk is filling up. expand storage before services degrade.');

  const chartData = insights.history.map((p) => ({
    time: new Date(p.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    cpu: Number(p.cpuPct.toFixed(1)),
    memory: Number(p.memoryUsedPct.toFixed(1)),
    disk: Number(p.diskUsedPct.toFixed(1)),
  }));
  const historyWindowSec = Math.max(0, Math.round((chartData.length * insights.sampleIntervalMs) / 1000));
  const historyWindowLabel = formatWindow(historyWindowSec);
  const rssPressure = getPressure(processRssPct);
  const heapPressure = getPressure(processHeapPct);
  const overallSeverity = getOverallSeverity([cpuSeverity, memSeverity, diskSeverity]);
  const overallHealth = overallSeverity === 'critical'
    ? { label: 'critical', color: 'red', icon: <IconAlertOctagon size={14} /> }
    : overallSeverity === 'warn'
      ? { label: 'watch', color: 'yellow', icon: <IconAlertTriangle size={14} /> }
      : { label: 'healthy', color: 'green', icon: <IconCircleCheck size={14} /> };

  return (
    <Stack gap="xl" p="xl">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="sm" c="dimmed">
            server capacity and utilization trends (sampled every {Math.round(insights.sampleIntervalMs / 1000)} seconds)
          </Text>
          <Text size="sm" c="dimmed">
            charts show the last {formatWindow(historyWindowSec)} of data.
          </Text>
        </div>
        <Group gap="xs">
          <Badge variant="filled" color={overallHealth.color} leftSection={overallHealth.icon}>
            health: {overallHealth.label}
          </Badge>
          <Badge variant="filled" color="relaykit">uptime: {formatUptime(current.uptimeSec)}</Badge>
        </Group>
      </Group>

      {error && (
        <Paper withBorder p="sm">
          <Text size="xs" c="dimmed">last refresh error: {error}</Text>
        </Paper>
      )}

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
        <Paper withBorder p="md">
          <Group justify="space-between" mb={6}>
            <Text fw={600}>cpu utilization</Text>
            <Badge variant="filled" color={getSeverityColor(cpuSeverity)}>{cpuSeverity}</Badge>
          </Group>
          <Text size="xl" fw={700}>{formatPercent(current.cpuPct)}</Text>
          <Text size="xs" c="dimmed" mt={4}>load: {current.load1} / {current.load5} / {current.load15}</Text>
        </Paper>

        <Paper withBorder p="md">
          <Group justify="space-between" mb={6}>
            <Text fw={600}>memory used</Text>
            <Badge variant="filled" color={getSeverityColor(memSeverity)}>{memSeverity}</Badge>
          </Group>
          <Text size="xl" fw={700}>{formatPercent(current.memoryUsedPct)}</Text>
          <Text size="xs" c="dimmed" mt={4}>
            {formatBytes(current.memoryUsedBytes)} / {formatBytes(current.memoryTotalBytes)}
          </Text>
        </Paper>

        <Paper withBorder p="md">
          <Group justify="space-between" mb={6}>
            <Text fw={600}>storage used</Text>
            <Badge variant="filled" color={getSeverityColor(diskSeverity)}>{diskSeverity}</Badge>
          </Group>
          <Text size="xl" fw={700}>{formatPercent(current.diskUsedPct)}</Text>
          <Text size="xs" c="dimmed" mt={4}>
            {formatBytes(current.diskUsedBytes)} / {formatBytes(current.diskTotalBytes)}
          </Text>
        </Paper>
      </SimpleGrid>

      {recommendations.length > 0 && (
        <Paper withBorder p="md">
          <Text fw={600} mb="xs">capacity recommendations</Text>
          <Stack gap={4}>
            {recommendations.map((r) => (
              <Text key={r} size="sm">{r}</Text>
            ))}
          </Stack>
        </Paper>
      )}

      <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
        <Paper withBorder p="md">
          <Text fw={600} mb="sm">cpu trend</Text>
          <LineChart
            h={220}
            data={chartData}
            dataKey="time"
            series={[{ name: 'cpu', color: 'relaykit' }]}
            withDots={false}
            withLegend={false}
            yAxisProps={{ domain: [0, 100] }}
            tooltipProps={{ cursor: false }}
            valueFormatter={(value) => formatPercent(value)}
          />
          <Text size="xs" c="dimmed" mt={8}>window: last {historyWindowLabel}</Text>
        </Paper>
        <Paper withBorder p="md">
          <Text fw={600} mb="sm">memory trend</Text>
          <LineChart
            h={220}
            data={chartData}
            dataKey="time"
            series={[{ name: 'memory', color: 'blue' }]}
            withDots={false}
            withLegend={false}
            yAxisProps={{ domain: [0, 100] }}
            tooltipProps={{ cursor: false }}
            valueFormatter={(value) => formatPercent(value)}
          />
          <Text size="xs" c="dimmed" mt={8}>window: last {historyWindowLabel}</Text>
        </Paper>
        <Paper withBorder p="md">
          <Text fw={600} mb="sm">storage trend</Text>
          <LineChart
            h={220}
            data={chartData}
            dataKey="time"
            series={[{ name: 'disk', color: 'grape' }]}
            withDots={false}
            withLegend={false}
            yAxisProps={{ domain: [0, 100] }}
            tooltipProps={{ cursor: false }}
            valueFormatter={(value) => formatPercent(value)}
          />
          <Text size="xs" c="dimmed" mt={8}>window: last {historyWindowLabel}</Text>
        </Paper>
      </SimpleGrid>

      <Paper withBorder p="md">
        <Text fw={600} mb="xs">process footprint</Text>
        <Stack gap="sm">
          <div>
            <Group justify="space-between" mb={6}>
              <Text size="sm" fw={500}>app memory (rss): {formatBytes(current.processRssBytes)}</Text>
              <Badge variant="light" color={rssPressure.color}>{rssPressure.label}</Badge>
            </Group>
            <Progress value={Math.min(100, processRssPct)} color={rssPressure.color} radius="xl" />
            <Text size="xs" c="dimmed" mt={4}>total memory used by this backend process.</Text>
          </div>
          <div>
            <Group justify="space-between" mb={6}>
              <Text size="sm" fw={500}>javascript memory (heap): {formatBytes(current.processHeapUsedBytes)}</Text>
              <Badge variant="light" color={heapPressure.color}>{heapPressure.label}</Badge>
            </Group>
            <Progress value={Math.min(100, processHeapPct)} color={heapPressure.color} radius="xl" />
            <Text size="xs" c="dimmed" mt={4}>js objects only (subset of app memory).</Text>
          </div>
        </Stack>
        <Text size="xs" c="dimmed" mt={8}>
          you can ignore this unless memory is in warn/critical. then use rss as the main “is this app heavy?” signal.
        </Text>
      </Paper>
    </Stack>
  );
};
