import path from 'path'

export { SERVICE_TYPE, type ServiceType } from '../../shared/serviceType'

export const DOKPLOY_URL = 'http://dokploy:3000'
export const PRESETS_DIR = path.join('/app', 'presets')
export const DEFAULT_PROJECT_NAME = 'relaykit.ungrouped'
export const VERSION_FILE_PATH = '/app/version.json'
/** Update channels: moving image tags. master builds move beta; vX.Y.Z releases move stable. */
export const RELAYKIT_UPDATE_CHANNELS = ['stable', 'beta'] as const
export type RelaykitUpdateChannel = (typeof RELAYKIT_UPDATE_CHANNELS)[number]
export const RELAYKIT_UPDATE_CHANNEL_DEFAULT: RelaykitUpdateChannel = 'stable'

/** One-shot container that performs `docker compose up` during self-update; must ship the compose plugin. */
export const RELAYKIT_UPDATE_HELPER_IMAGE = 'docker:28-cli'

/** Rolling charts: keep samples from the last N minutes (by timestamp), not a fixed count. */
export const INSIGHTS_HISTORY_WINDOW_MS = 21 * 60 * 1000

export const SERVER_INSIGHTS = {
  diskPath: '/',
  sampleIntervalMs: 5000,
  historyWindowMs: INSIGHTS_HISTORY_WINDOW_MS,
  thresholds: {
    cpu: { warn: 70, critical: 85 },
    memory: { warn: 70, critical: 85 },
    disk: { warn: 70, critical: 85 },
  },
} as const

export const SERVICE_INSIGHTS = {
  historyWindowMs: INSIGHTS_HISTORY_WINDOW_MS,
  thresholds: {
    cpu: { warn: 70, critical: 85 },
    memory: { warn: 70, critical: 85 },
  },
} as const
