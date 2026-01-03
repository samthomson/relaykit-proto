import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'

const t = initTRPC.create()

export const router = t.router
export const publicProcedure = t.procedure

const DOKPLOY_URL = 'http://dokploy:3000'
const CONFIG_PATH = path.join('/app', '.dokploy-key')
const DEFAULT_PROJECT_NAME = 'relaykit.ungrouped'

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
  // List available service presets
  listPresets: publicProcedure.query(async () => {
    const presetsDir = path.join('/app', 'presets')
    const presets = []
    
    try {
      const dirs = await fs.readdir(presetsDir)
      
      for (const dir of dirs) {
        const metadataPath = path.join(presetsDir, dir, 'metadata.json')
        try {
          const metadata = await fs.readFile(metadataPath, 'utf-8')
          presets.push(JSON.parse(metadata))
        } catch (e) {
          // Skip directories without metadata.json
        }
      }
    } catch (error) {
      console.error('Error reading presets:', error)
    }
    
    return presets
  }),

  // List deployed services
  listServices: publicProcedure.query(async () => {
    const projects = await dokployFetch('/api/project.all')
    const services = []
    
    for (const project of projects) {
      for (const environment of project.environments || []) {
        for (const compose of environment.compose || []) {
          services.push({
            composeId: compose.composeId,
            name: compose.name,
            description: compose.description,
            status: compose.composeStatus,
            createdAt: compose.createdAt,
            env: compose.env,
            projectName: project.name,
            environmentName: environment.name,
          })
        }
      }
    }
    
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

  // Check Dokploy connection
  checkDokploy: publicProcedure.query(async () => {
    try {
      await fetch(`${DOKPLOY_URL}/`)
      const apiKey = await getApiKey()
      return {
        reachable: true,
        url: DOKPLOY_URL,
        hasApiKey: !!apiKey,
        apiKeyLength: apiKey.length,
      }
    } catch (error: any) {
      return {
        reachable: false,
        error: error.message,
        url: DOKPLOY_URL,
        hasApiKey: false,
      }
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

  // Deploy a service
  deployService: publicProcedure
    .input(z.object({
      presetId: z.string(),
      config: z.record(z.string(), z.string())
    }))
    .mutation(async ({ input }) => {
      try {
        // 1. Read the preset compose file
        const presetDir = path.join('/app', 'presets', input.presetId)
        const composeContent = await fs.readFile(
          path.join(presetDir, 'docker-compose.yml'),
          'utf-8'
        )

        // 2. Build environment variables string (KEY=VALUE\nKEY=VALUE)
        const envString = Object.entries(input.config)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n')

        // 3. Get or create default project
        const projectsResponse = await dokployFetch('/api/project.all')
        const projects = projectsResponse || []
        let project = projects.find?.((p: any) => p.name === DEFAULT_PROJECT_NAME)
        
        if (!project) {
          const createResult = await dokployFetch('/api/project.create', {
            method: 'POST',
            body: JSON.stringify({
              name: DEFAULT_PROJECT_NAME,
              description: 'Ungrouped services deployed via RelayKit'
            })
          })
          
          // Fetch the project again to get full data with environments
          const allProjects = await dokployFetch('/api/project.all')
          project = allProjects.find?.((p: any) => p.projectId === createResult.projectId)
        }

        // 4. Create compose service
        const composeName = `${input.presetId}-${Date.now()}`
        
        // Get the environmentId from the project's environments array
        const environmentId = project.environments?.[0]?.environmentId
        
        if (!environmentId) {
          throw new Error(`No environment found in project. Project has: ${JSON.stringify(project)}`)
        }

        const createComposeResponse = await dokployFetch('/api/compose.create', {
          method: 'POST',
          body: JSON.stringify({
            name: composeName,
            description: `${input.presetId} relay deployed by RelayKit`,
            appName: input.presetId,
            composeType: 'docker-compose',
            sourceType: 'raw',
            composeFile: composeContent,
            env: envString,
            environmentId: environmentId,
            serverId: null // Use default server
          })
        })
        const createCompose = createComposeResponse

        // 4.5. Update compose with env vars and sourceType (compose.create ignores these)
        await dokployFetch('/api/compose.update', {
          method: 'POST',
          body: JSON.stringify({
            composeId: createCompose.composeId,
            env: envString,
            sourceType: 'raw'
          })
        })

        // 5. Deploy it
        await dokployFetch('/api/compose.deploy', {
          method: 'POST',
          body: JSON.stringify({
            composeId: createCompose.composeId
          })
        })

        return {
          success: true,
          composeId: createCompose.composeId,
          message: 'Service deployed successfully!'
        }
      } catch (error: any) {
        throw new Error(`Failed to deploy service: ${error.message}`)
      }
    }),
})

export type AppRouter = typeof appRouter

