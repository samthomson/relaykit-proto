import { initTRPC } from '@trpc/server'
import fs from 'fs/promises'
import path from 'path'

const t = initTRPC.create()

export const router = t.router
export const publicProcedure = t.procedure

const DOKPLOY_URL = 'http://dokploy:3000'
const CONFIG_PATH = path.join('/app', '.dokploy-key')

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
    throw new Error(`Dokploy API error (${response.status}): ${text.substring(0, 200)}`)
  }

  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(`Invalid JSON response from Dokploy: ${text.substring(0, 200)}`)
  }
}

export const appRouter = router({
  // List all projects in Dokploy
  listProjects: publicProcedure.query(async () => {
    return await dokployFetch('/api/project.all')
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
    .input((val: unknown) => {
      if (
        typeof val === 'object' &&
        val !== null &&
        'apiKey' in val &&
        typeof (val as any).apiKey === 'string'
      ) {
        return val as { apiKey: string }
      }
      throw new Error('Invalid input')
    })
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
})

export type AppRouter = typeof appRouter

