export const normalizeHttpsUrl = (url: string): string | null => {
  const trimmed = url.trim()
  if (!trimmed) return null
  let candidate = trimmed
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export const dedupeHttpsUrls = (urls: string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls) {
    const norm = normalizeHttpsUrl(raw)
    if (norm && !seen.has(norm)) {
      seen.add(norm)
      out.push(norm)
    }
  }
  return out
}
