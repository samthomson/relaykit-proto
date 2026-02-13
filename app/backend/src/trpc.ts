import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'

const t = initTRPC.create()

export const router = t.router
export const publicProcedure = t.procedure

const DOKPLOY_URL = 'http://dokploy:3000'
const CONFIG_PATH = path.join('/app', '.dokploy-key')
const PRESETS_DIR = path.join('/app', 'presets')
const DEFAULT_PROJECT_NAME = 'relaykit.ungrouped'

// Dokploy domain.create expects these; dev = no Traefik cert (Caddy/mkcert), prod = Let's Encrypt
enum CertificateType {
  None = 'none',
  LetsEncrypt = 'letsencrypt'
}
const getCertificateType = (): CertificateType =>
  process.env.NODE_ENV === 'development' ? CertificateType.None : CertificateType.LetsEncrypt

function parseEnvString(env: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!env) return out
  env.split('\n').forEach((line: string) => {
    const [key, ...values] = line.split('=')
    if (key && values.length > 0) {
      out[key.trim()] = values.join('=').trim()
    }
  })
  return out
}

async function getPresetMetadata(presetId: string) {
  const metadata = await fs.readFile(path.join(PRESETS_DIR, presetId, 'metadata.json'), 'utf-8')
  return JSON.parse(metadata)
}

async function ensureDefaultProject(): Promise<{ projectId: string; environmentId: string }> {
  const projects = await dokployFetch('/api/project.all')
  let project = projects.find?.((p: { name: string }) => p.name === DEFAULT_PROJECT_NAME)
  if (project) {
    const envId = project.environments?.[0]?.environmentId
    if (!envId) throw new Error(`No environment in project ${project.projectId}`)
    return { projectId: project.projectId, environmentId: envId }
  }
  const created = await dokployFetch('/api/project.create', {
    method: 'POST',
    body: JSON.stringify({ name: DEFAULT_PROJECT_NAME, description: 'Ungrouped services deployed via RelayKit' }),
  })
  const all = await dokployFetch('/api/project.all')
  project = all.find((p: { projectId: string }) => p.projectId === created.projectId)
  const environmentId = project?.environments?.[0]?.environmentId
  if (!environmentId) throw new Error('No environment after project create')
  return { projectId: created.projectId, environmentId }
}

async function registerDomain(composeId: string, host: string, presetData: { internalPort: number; serviceName: string }) {
  const certificateType = getCertificateType()
  await dokployFetch('/api/domain.create', {
    method: 'POST',
    body: JSON.stringify({
      composeId,
      host,
      https: certificateType !== CertificateType.None,
      path: '/',
      port: presetData.internalPort,
      certificateType,
      serviceName: presetData.serviceName,
    }),
  })
}

const getApiKey = async (): Promise<string> => {
  try {
    const key = await fs.readFile(CONFIG_PATH, 'utf-8')
    return key.trim()
  } catch (error) {
    return ''
  }
}

const dokployFetch = async (endpoint: string, options: RequestInit = {}) => {
  const url = `${DOKPLOY_URL}${endpoint}`
  const apiKey = await getApiKey()
  
  if (!apiKey) {
    throw new Error('DOKPLOY_API_KEY not set. Please complete setup first.')
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const text = await response.text()
  
  if (!response.ok) {
    throw new Error(`Dokploy API error (${response.status}): ${text.substring(0, 500)}`)
  }

  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(`Invalid JSON response from Dokploy: ${text.substring(0, 200)}`)
  }
}

export const appRouter = router({
  listPresets: publicProcedure.query(async () => {
    const presets = []
    try {
      for (const dir of await fs.readdir(PRESETS_DIR)) {
        try {
          presets.push(await getPresetMetadata(dir))
        } catch {
          // Skip dirs without valid metadata.json
        }
      }
    } catch (error) {
      console.error('Error reading presets:', error)
    }
    return presets
  }),

  listServices: publicProcedure.query(async () => {
    const projects = await dokployFetch('/api/project.all')
    const services = []
    for (const project of projects) {
      for (const environment of project.environments || []) {
        for (const compose of environment.compose || []) {
          const presetId = compose.description
          if (!presetId) throw new Error(`Service ${compose.name} has no preset ID`)
          const presetData = await getPresetMetadata(presetId)
          if (!presetData.label) throw new Error(`Preset ${presetId} has no label`)
          const envVars = parseEnvString(compose.env)
          services.push({
            composeId: compose.composeId,
            name: compose.name,
            serviceType: presetData.label,
            status: compose.composeStatus,
            createdAt: compose.createdAt,
            hostname: envVars.RELAY_HOST || 'No hostname configured',
            domains: compose.domains || [],
            projectName: project.name,
            environmentName: environment.name,
          })
        }
      }
    }
    services.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    return services
  }),

  // Delete a service
  deleteService: publicProcedure
    .input(z.object({
      composeId: z.string()
    }))
    .mutation(async ({ input }) => {
      await dokployFetch('/api/compose.delete', {
        method: 'POST',
        body: JSON.stringify({
          composeId: input.composeId
        })
      })
      
      return {
        success: true,
        message: 'Service deleted successfully'
      }
    }),

  // Stop a service
  stopService: publicProcedure
    .input(z.object({
      composeId: z.string()
    }))
    .mutation(async ({ input }) => {
      await dokployFetch('/api/compose.stop', {
        method: 'POST',
        body: JSON.stringify({
          composeId: input.composeId
        })
      })
      
      return {
        success: true,
        message: 'Service stopped'
      }
    }),

  // Start a service
  startService: publicProcedure
    .input(z.object({
      composeId: z.string()
    }))
    .mutation(async ({ input }) => {
      await dokployFetch('/api/compose.start', {
        method: 'POST',
        body: JSON.stringify({
          composeId: input.composeId
        })
      })
      
      return {
        success: true,
        message: 'Service started'
      }
    }),

  updateServiceDomain: publicProcedure
    .input(z.object({
      composeId: z.string(),
      domainId: z.string(),
      newHost: z.string()
    }))
    .mutation(async ({ input }) => {
      const compose = await dokployFetch(`/api/compose.one?composeId=${input.composeId}`)
      const presetData = await getPresetMetadata(compose.description)
      await dokployFetch('/api/domain.delete', {
        method: 'POST',
        body: JSON.stringify({ domainId: input.domainId })
      })
      await registerDomain(input.composeId, input.newHost, presetData)
      await dokployFetch('/api/compose.redeploy', {
        method: 'POST',
        body: JSON.stringify({ composeId: input.composeId })
      })
      return { success: true, message: 'Domain updated and service redeployed' }
    }),

  // Check Dokploy connection
  checkDokploy: publicProcedure.query(async () => {
    try {
      await fetch(`${DOKPLOY_URL}/`)
      const hasApiKey = !!(await getApiKey())
      return { reachable: true, url: DOKPLOY_URL, hasApiKey }
    } catch (error: any) {
      return { reachable: false, error: error.message, url: DOKPLOY_URL, hasApiKey: false }
    }
  }),

  // Save Dokploy API key
  saveApiKey: publicProcedure
    .input(z.object({
      apiKey: z.string()
    }))
    .mutation(async ({ input }) => {
      // Validate API key by calling Dokploy API
      try {
        const response = await fetch(`${DOKPLOY_URL}/api/project.all`, {
          headers: {
            'x-api-key': input.apiKey,
          },
        })

        if (!response.ok) {
          throw new Error('Invalid API key')
        }

        // Save to file
        await fs.writeFile(CONFIG_PATH, input.apiKey, 'utf-8')
        
        return {
          success: true,
          message: 'API key saved successfully!',
        }
      } catch (error: any) {
        throw new Error(`Failed to save API key: ${error.message}`)
      }
    }),

  deployService: publicProcedure
    .input(z.object({
      presetId: z.string(),
      config: z.record(z.string(), z.string())
    }))
    .mutation(async ({ input }) => {
      try {
        const presetDir = path.join(PRESETS_DIR, input.presetId)
        const composeContent = await fs.readFile(path.join(presetDir, 'docker-compose.yml'), 'utf-8')
        const envString = Object.entries(input.config).map(([k, v]) => `${k}=${v}`).join('\n')
        const { environmentId } = await ensureDefaultProject()

        const uniqueSuffix = Date.now()
        const composeName = `${input.presetId}-${uniqueSuffix}`
        const composeFile = composeContent.replace(/\{\{DEPLOY_SUFFIX\}\}/g, String(uniqueSuffix))

        const createCompose = await dokployFetch('/api/compose.create', {
          method: 'POST',
          body: JSON.stringify({
            name: composeName,
            description: input.presetId,
            appName: input.presetId,
            composeType: 'docker-compose',
            sourceType: 'raw',
            composeFile,
            env: envString,
            environmentId,
            serverId: null
          })
        })
        await dokployFetch('/api/compose.update', {
          method: 'POST',
          body: JSON.stringify({ composeId: createCompose.composeId, env: envString, sourceType: 'raw' })
        })

        const presetData = await getPresetMetadata(input.presetId)
        const hostname = input.config.RELAY_HOST
        if (hostname && presetData.serviceName) {
          await registerDomain(createCompose.composeId, hostname, presetData)
        }

        await dokployFetch('/api/compose.deploy', {
          method: 'POST',
          body: JSON.stringify({ composeId: createCompose.composeId })
        })
        await dokployFetch('/api/compose.start', {
          method: 'POST',
          body: JSON.stringify({ composeId: createCompose.composeId })
        })

        return {
          success: true,
          composeId: createCompose.composeId,
          message: 'Service deployment started (may take a moment to become fully running)'
        }
      } catch (error: any) {
        throw new Error(`Failed to deploy service: ${error.message}`)
      }
    }),
})

export type AppRouter = typeof appRouter

