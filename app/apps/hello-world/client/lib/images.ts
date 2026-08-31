export const IMAGE_URL_RE = /https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|svg)(?:\?\S*)?/gi

export const extractImages = (content: string): string[] =>
  content.match(IMAGE_URL_RE) ?? []

export const stripImageUrls = (content: string): string =>
  content.replace(IMAGE_URL_RE, '').replace(/\n{3,}/g, '\n\n').trim()
