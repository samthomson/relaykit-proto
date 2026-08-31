import { useEffect } from 'react';
import { Anchor, Box, Group, Text, rem } from '@mantine/core';
import { IconAlertOctagon, IconAlertTriangle } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useInsights } from '../contexts/InsightsContext';
import { getInsightSeverity, getOverallSeverity } from '../../../shared/insights';

export const SYSTEM_BANNER_HEIGHT = 36;

/**
 * AppShell style overrides that shift the whole shell down by the banner height.
 * `--rk-banner-h` is set on :root by <SystemStatusBanner /> while it is visible.
 */
export const APPSHELL_BANNER_STYLES = {
  header: { top: 'var(--rk-banner-h, 0px)' },
  navbar: {
    top: 'calc(var(--app-shell-header-offset, 0rem) + var(--rk-banner-h, 0px))',
    height:
      'calc(100dvh - var(--app-shell-header-offset, 0rem) - var(--rk-banner-h, 0px) - var(--app-shell-footer-offset, 0rem))',
  },
  main: {
    paddingTop:
      'calc(var(--app-shell-header-offset, 0rem) + var(--rk-banner-h, 0px) + var(--app-shell-padding))',
  },
} as const;

// TEMP(issue #30): dev flag to preview warn/critical UI — visit with ?demo-banner=warn or ?demo-banner=critical. remove once verified.
export const demoServerSeverity = (): 'warn' | 'critical' | null => {
  const value = new URLSearchParams(window.location.search).get('demo-banner');
  return value === 'warn' || value === 'critical' ? value : null;
};

export const SystemStatusBanner = () => {
  const { insights } = useInsights();

  let polled: 'warn' | 'critical' | null = null;
  if (insights) {
    const { current, thresholds } = insights;
    const overall = getOverallSeverity([
      getInsightSeverity(current.cpuPct, thresholds.cpu.warn, thresholds.cpu.critical),
      getInsightSeverity(current.memoryUsedPct, thresholds.memory.warn, thresholds.memory.critical),
      getInsightSeverity(current.diskUsedPct, thresholds.disk.warn, thresholds.disk.critical),
    ]);
    polled = overall === 'normal' ? null : overall;
  }
  const severity = demoServerSeverity() ?? polled;
  const visible = severity !== null;

  useEffect(() => {
    if (!visible) return;
    document.documentElement.style.setProperty('--rk-banner-h', `${SYSTEM_BANNER_HEIGHT}px`);
    return () => {
      document.documentElement.style.setProperty('--rk-banner-h', '0px');
    };
  }, [visible]);

  if (!severity) return null;

  const critical = severity === 'critical';

  return (
    <Box
      className={`rk-banner rk-banner-${severity}`}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 210,
        height: rem(SYSTEM_BANNER_HEIGHT),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Group gap={8} wrap="nowrap">
        <Box style={{ display: 'inline-flex', alignItems: 'center' }}>{critical ? <IconAlertOctagon size={16} /> : <IconAlertTriangle size={16} />}</Box>
        <Text size="sm" fw={600}>{critical ? 'server critical' : 'server warning'}</Text>
        <Anchor component={Link} to="/insights" size="sm" c="inherit" underline="always">insights</Anchor>
      </Group>
    </Box>
  );
};
