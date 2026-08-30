import http from 'http'

export const DOCKER_SOCKET_PATH = '/var/run/docker.sock'

export const dockerSocketGetJson = async (pathWithQuery: string): Promise<any> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: DOCKER_SOCKET_PATH,
        path: pathWithQuery,
        method: 'GET',
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`Docker API ${res.statusCode}: ${body.slice(0, 200)}`))
            return
          }
          try {
            resolve(JSON.parse(body))
          } catch {
            reject(new Error(`Invalid JSON from Docker API: ${body.slice(0, 200)}`))
          }
        })
      }
    )
    req.on('error', reject)
    req.end()
  })

export const dockerSocketGetBuffer = async (pathWithQuery: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: DOCKER_SOCKET_PATH,
        path: pathWithQuery,
        method: 'GET',
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        res.on('end', () => {
          const body = Buffer.concat(chunks)
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`Docker API ${res.statusCode}: ${body.toString('utf8').slice(0, 200)}`))
            return
          }
          resolve(body)
        })
      }
    )
    req.on('error', reject)
    req.end()
  })

export const dockerSocketMutate = async (pathWithQuery: string, method: 'POST' | 'DELETE', jsonBody?: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: DOCKER_SOCKET_PATH,
        path: pathWithQuery,
        method,
        headers: jsonBody ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(jsonBody) } : undefined,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        res.on('end', () => {
          const body = Buffer.concat(chunks)
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`Docker API ${method} ${res.statusCode}: ${body.toString('utf8').slice(0, 200)}`))
            return
          }
          resolve(body)
        })
      }
    )
    req.on('error', reject)
    req.end(jsonBody)
  })
