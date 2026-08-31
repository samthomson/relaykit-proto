import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  ActionIcon,
  Box,
  Button,
  Checkbox,
  Code,
  Flex,
  Group,
  Image,
  Paper,
  SegmentedControl,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Tooltip,
  rem,
} from '@mantine/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { ImagePlus, Trash2 } from 'lucide-react'
import type { NostrEvent } from '@nostrify/nostrify'
import type { NUser } from '@nostrify/react/login'
import { useUploadFile } from '@/hooks/useUploadFile'
import { useAppContext } from '@/hooks/useAppContext'
import { getEffectiveBlossomServers } from '@/lib/appBlossom'
import {
  schedulePost,
  type ScheduledPost,
} from '@/lib/schedulerApi'
import {
  datetimeLocalToISO,
  defaultScheduleValue,
  toDatetimeLocalValue,
} from '@/lib/datetime'
import { dedupeRelays, parseParams } from '@/lib/queryParams'
import { compressImage } from '@/lib/compressImage'

interface Attachment {
  id: string
  file: File
  originalSize: number
  compressedSize?: number
  previewUrl: string
  uploadedUrl?: string
  uploading?: boolean
  error?: string
}

interface ComposeViewProps {
  user: NUser
  relays: string[]
  onAddRelay: (url: string) => void
  editingPost: ScheduledPost | null
  onClearEdit: () => void
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const isEmbedded = parseParams().standalone
const CLIENT_TAG: string[][] = [
  ['client', isEmbedded ? 'relaykit — hello world' : 'hello world'],
]

const DRAFT_KEY = 'hw:draft-content'
const RELAY_SELECTION_KEY = 'hw:selected-relays'
const BLOSSOM_SELECTION_KEY = 'hw:selected-blossoms'

const loadStoredList = (key: string): string[] | null => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

const storeList = (key: string, list: string[]) => {
  localStorage.setItem(key, JSON.stringify(list))
}

let attachId = 0

export const ComposeView = ({
  user,
  relays,
  onAddRelay,
  editingPost,
  onClearEdit,
}: ComposeViewProps) => {
  const queryClient = useQueryClient()
  const uploadFile = useUploadFile()
  const { config } = useAppContext()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [content, setContentRaw] = useState(() => localStorage.getItem(DRAFT_KEY) ?? '')
  const setContent = useCallback((v: string) => {
    setContentRaw(v)
    if (v) localStorage.setItem(DRAFT_KEY, v)
    else localStorage.removeItem(DRAFT_KEY)
  }, [])
  const [tab, setTab] = useState<string | null>('edit')
  const [publishMode, setPublishMode] = useState('later')
  const [publishAt, setPublishAt] = useState(() => defaultScheduleValue())
  const [selected, setSelected] = useState<string[]>(() =>
    loadStoredList(RELAY_SELECTION_KEY) ?? relays,
  )
  const [customRelay, setCustomRelay] = useState('')
  const [customBlossom, setCustomBlossom] = useState('')
  const [extraBlossoms, setExtraBlossoms] = useState<string[]>([])
  const [compress, setCompress] = useState(true)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const nip65Blossoms = useMemo(
    () => getEffectiveBlossomServers(config.blossomServerMetadata, config.useAppBlossomServers),
    [config.blossomServerMetadata, config.useAppBlossomServers],
  )

  const allBlossomServers = useMemo(
    () => [...new Set([...nip65Blossoms, ...extraBlossoms])],
    [nip65Blossoms, extraBlossoms],
  )

  const [selectedBlossoms, setSelectedBlossoms] = useState<string[]>(() =>
    loadStoredList(BLOSSOM_SELECTION_KEY) ?? [],
  )

  const prevBlossomRef = useRef<string[]>([])
  useEffect(() => {
    const prev = prevBlossomRef.current
    prevBlossomRef.current = nip65Blossoms
    if (prev.length === 0 && nip65Blossoms.length > 0) {
      const stored = loadStoredList(BLOSSOM_SELECTION_KEY)
      if (!stored) {
        setSelectedBlossoms(nip65Blossoms)
        storeList(BLOSSOM_SELECTION_KEY, nip65Blossoms)
      }
    }
  }, [nip65Blossoms])

  useEffect(() => {
    if (editingPost) {
      setContent(
        typeof editingPost.signedEvent?.content === 'string'
          ? editingPost.signedEvent.content
          : '',
      )
      setSelected(editingPost.relays)
      setPublishMode('later')
      setPublishAt(defaultScheduleValue())
      setAttachments([])
      setTab('edit')
    }
  }, [editingPost])

  const addFiles = useCallback(
    async (files: File[]) => {
      const imageFiles = files.filter((f) => f.type.startsWith('image/'))
      if (imageFiles.length === 0) return

      const newAttachments: Attachment[] = imageFiles.map((f) => ({
        id: String(++attachId),
        file: f,
        originalSize: f.size,
        previewUrl: URL.createObjectURL(f),
        uploading: true,
      }))
      setAttachments((prev) => [...prev, ...newAttachments])

      for (const att of newAttachments) {
        try {
          const processed = compress ? await compressImage(att.file) : att.file
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === att.id ? { ...a, compressedSize: processed.size } : a,
            ),
          )
          const tags = await uploadFile.mutateAsync({
            file: processed,
            servers: selectedBlossoms.length > 0 ? selectedBlossoms : undefined,
          })
          const url = tags.find((t) => t[0] === 'url')?.[1]
          if (!url) throw new Error('no url in upload response')
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === att.id ? { ...a, uploadedUrl: url, uploading: false } : a,
            ),
          )
        } catch (e) {
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === att.id
                ? { ...a, uploading: false, error: e instanceof Error ? e.message : 'upload failed' }
                : a,
            ),
          )
        }
      }
    },
    [compress, uploadFile, selectedBlossoms],
  )

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id)
      if (att) URL.revokeObjectURL(att.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files)
      if (files.length > 0) {
        e.preventDefault()
        addFiles(files)
      }
    },
    [addFiles],
  )

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) addFiles(files)
    e.target.value = ''
  }

  const buildFinalContent = (): string => {
    const uploaded = attachments
      .filter((a) => a.uploadedUrl)
      .map((a) => a.uploadedUrl!)
    if (uploaded.length === 0) return content.trim()
    const text = content.trim()
    return text ? text + '\n\n' + uploaded.join('\n') : uploaded.join('\n')
  }

  const buildTags = (): string[][] => {
    const tags: string[][] = [...CLIENT_TAG]
    attachments
      .filter((a) => a.uploadedUrl)
      .forEach((a) => {
        const imeta = ['imeta', `url ${a.uploadedUrl}`]
        if (a.file.type) imeta.push(`m ${a.file.type}`)
        tags.push(imeta)
      })
    return tags
  }

  const buildEventPreview = (): Record<string, unknown> => {
    const isNow = publishMode === 'now'
    const targetTime = isNow ? new Date().toISOString() : datetimeLocalToISO(publishAt)
    return {
      kind: 1,
      content: buildFinalContent(),
      tags: buildTags(),
      created_at: Math.floor(new Date(targetTime).getTime() / 1000),
    }
  }

  const handleSubmit = async () => {
    setError(null)
    if (!content.trim() && attachments.length === 0) {
      setError('write something or add an image')
      return
    }
    if (attachments.some((a) => a.uploading)) {
      setError('wait for uploads to finish')
      return
    }
    if (publishMode === 'later' && !publishAt) {
      setError('pick a date and time')
      return
    }
    if (selected.length === 0) {
      setError('select at least one relay')
      return
    }

    setSubmitting(true)
    try {
      const isNow = publishMode === 'now'
      const targetTime = isNow
        ? new Date().toISOString()
        : datetimeLocalToISO(publishAt)

      const signedEvent: NostrEvent = await user.signer.signEvent({
        kind: 1,
        content: buildFinalContent(),
        tags: buildTags(),
        created_at: Math.floor(new Date(targetTime).getTime() / 1000),
      })

      await schedulePost({
        signedEvent,
        relays: selected,
        publishAt: targetTime,
      })

      setContent('')
      setPublishAt(defaultScheduleValue())
      attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl))
      setAttachments([])
      setTab('edit')
      if (editingPost) onClearEdit()
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts'] })

      try {
        notifications.show({
          message: isNow ? 'post published' : 'post scheduled',
          color: 'green',
          autoClose: 3000,
        })
      } catch {
        // notifications may not be mounted
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to schedule')
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggle = (url: string) => {
    setSelected((prev) => {
      const next = prev.includes(url) ? prev.filter((r) => r !== url) : [...prev, url]
      storeList(RELAY_SELECTION_KEY, next)
      return next
    })
  }

  const handleBlossomToggle = (url: string) => {
    setSelectedBlossoms((prev) => {
      const next = prev.includes(url) ? prev.filter((s) => s !== url) : [...prev, url]
      storeList(BLOSSOM_SELECTION_KEY, next)
      return next
    })
  }

  const handleAddCustom = () => {
    const [normalized] = dedupeRelays([customRelay])
    if (!normalized) return
    onAddRelay(normalized)
    if (!selected.includes(normalized)) {
      setSelected((prev) => {
        const next = [...prev, normalized]
        storeList(RELAY_SELECTION_KEY, next)
        return next
      })
    }
    setCustomRelay('')
  }

  const handleAddCustomBlossom = () => {
    let url = customBlossom.trim()
    if (!url) return
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = `https://${url}`
    url = url.replace(/\/+$/, '')
    if (!allBlossomServers.includes(url)) {
      setExtraBlossoms((prev) => [...prev, url])
    }
    if (!selectedBlossoms.includes(url)) {
      setSelectedBlossoms((prev) => {
        const next = [...prev, url]
        storeList(BLOSSOM_SELECTION_KEY, next)
        return next
      })
    }
    setCustomBlossom('')
  }

  const PRESETS: Record<string, number> = { '+5m': 5, '+1h': 60, '+6h': 360 }

  const setPresetTime = (label: string) => {
    if (label === 'tomorrow') {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      d.setHours(9, 0, 0, 0)
      setPublishAt(toDatetimeLocalValue(d))
    } else {
      const d = new Date(Date.now() + (PRESETS[label] ?? 5) * 60_000)
      d.setSeconds(0, 0)
      setPublishAt(toDatetimeLocalValue(d))
    }
  }

  const uploading = attachments.some((a) => a.uploading)
  const hasImages = attachments.length > 0

  const activePreset = useMemo(() => {
    if (publishMode !== 'later' || !publishAt) return null
    const target = new Date(publishAt).getTime()
    const now = Date.now()
    const diffMin = Math.round((target - now) / 60_000)
    for (const [label, mins] of Object.entries(PRESETS)) {
      if (Math.abs(diffMin - mins) <= 1) return label
    }
    return null
  }, [publishAt, publishMode])

  return (
    <Stack maw={700} gap={0}>
      {editingPost && (
        <Paper withBorder p="xs" mb="sm" radius={0}>
          <Flex align="center" justify="space-between">
            <Text size="xs" ff="monospace" c="dimmed">re-scheduling post</Text>
            <Button variant="subtle" size="compact-xs" onClick={() => { onClearEdit(); setContent(''); setAttachments([]) }}>
              cancel
            </Button>
          </Flex>
        </Paper>
      )}

      {/* ── compose ── */}
      <Tabs value={tab} onChange={setTab} radius={0}>
        <Tabs.List>
          <Tabs.Tab value="edit" fz="xs" ff="monospace">edit</Tabs.Tab>
          <Tabs.Tab value="preview" fz="xs" ff="monospace">preview</Tabs.Tab>
          <Tabs.Tab value="advanced" fz="xs" ff="monospace">advanced</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="edit" pt="xs">
          <Textarea
            placeholder="what do you want to post?"
            value={content}
            onChange={(e) => setContent(e.currentTarget.value)}
            onPaste={handlePaste}
            autosize
            minRows={4}
            maxRows={12}
            radius={0}
            styles={{ input: { fontFamily: '"SFMono-Regular", Menlo, Monaco, Consolas, monospace', fontSize: rem(13) } }}
          />

          <Flex justify="space-between" align="center" mt={4}>
            <Group gap="xs">
              <Tooltip label="add images">
                <ActionIcon variant="subtle" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <ImagePlus size={16} />
                </ActionIcon>
              </Tooltip>
              <input type="file" accept="image/*" multiple style={{ display: 'none' }} ref={fileInputRef} onChange={handleFileInput} />
              {hasImages && (
                <Switch
                  label={<Text size="xs" ff="monospace" c="dimmed">compress</Text>}
                  checked={compress}
                  onChange={(e) => setCompress(e.currentTarget.checked)}
                  size="xs"
                />
              )}
            </Group>
            <Text size="xs" ff="monospace" c="dimmed">{content.length} chars</Text>
          </Flex>

          {hasImages && (
            <Group gap="xs" mt="xs">
              {attachments.map((att) => (
                <Box key={att.id} pos="relative" style={{ width: 'fit-content' }}>
                  <Image
                    src={att.previewUrl}
                    alt=""
                    radius={0}
                    h={100}
                    w="auto"
                    fit="contain"
                    style={{ opacity: att.uploading ? 0.5 : 1, border: '1px solid var(--mantine-color-default-border)' }}
                  />
                  <Text fz={10} ff="monospace" ta="center" mt={1}
                    c={att.error ? 'red' : att.uploadedUrl ? 'green' : 'dimmed'}
                  >
                    {att.uploading ? 'uploading...' : att.error ? 'failed' : att.uploadedUrl ? `✓ ${formatBytes(att.compressedSize ?? att.originalSize)}` : ''}
                  </Text>
                  <ActionIcon variant="subtle" color="red" size="xs" pos="absolute" top={2} right={2} onClick={() => removeAttachment(att.id)}>
                    <Trash2 size={12} />
                  </ActionIcon>
                </Box>
              ))}
            </Group>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="preview" pt="xs">
          <Paper withBorder radius={0} p="sm" mih={100}>
            {content.trim() && (
              <Text size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {content.trim()}
              </Text>
            )}
            {attachments.filter((a) => a.uploadedUrl).length > 0 && (
              <Group gap="xs" mt={content.trim() ? 'sm' : 0}>
                {attachments.filter((a) => a.uploadedUrl).map((att) => (
                  <Image key={att.id} src={att.uploadedUrl} alt="" radius={0} mah={180} w="auto" fit="contain" />
                ))}
              </Group>
            )}
            {!content.trim() && attachments.filter((a) => a.uploadedUrl).length === 0 && (
              <Text size="xs" ff="monospace" c="dimmed">nothing to preview</Text>
            )}
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="advanced" pt="xs">
          <Code block style={{ fontSize: rem(11), whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflow: 'auto' }}>
            {JSON.stringify(buildEventPreview(), null, 2)}
          </Code>
        </Tabs.Panel>
      </Tabs>

      {/* ── divider ── */}
      <Box my="lg" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }} />

      {/* ── targets ── */}
      <Flex gap="xl">
        <Box style={{ flex: 1 }}>
          <Text size="xs" ff="monospace" fw={600} tt="uppercase" c="dimmed" mb={8}>publish to relays</Text>
          <Stack gap={6}>
            {relays.map((url) => (
              <Checkbox
                key={url}
                label={<Text size="xs" ff="monospace">{url.replace(/^wss?:\/\//, '')}</Text>}
                checked={selected.includes(url)}
                onChange={() => handleToggle(url)}
                size="xs"
              />
            ))}
          </Stack>
          <Flex gap="xs" mt={8}>
            <TextInput
              placeholder="wss://relay.example.com"
              value={customRelay}
              onChange={(e) => setCustomRelay(e.currentTarget.value)}
              size="xs"
              radius={0}
              style={{ flex: 1 }}
              styles={{ input: { fontFamily: '"SFMono-Regular", Menlo, Monaco, Consolas, monospace' } }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCustom() } }}
            />
            <Button variant="default" size="xs" radius={0} onClick={handleAddCustom} disabled={!customRelay.trim()}>add</Button>
          </Flex>
        </Box>

        <Box style={{ flex: 1 }}>
          <Text size="xs" ff="monospace" fw={600} tt="uppercase" c="dimmed" mb={8}>upload to blossoms</Text>
          <Stack gap={6}>
            {allBlossomServers.length === 0 ? (
              <Text size="xs" ff="monospace" c="dimmed">none configured</Text>
            ) : (
              allBlossomServers.map((url) => (
                <Checkbox
                  key={url}
                  label={<Text size="xs" ff="monospace">{url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</Text>}
                  checked={selectedBlossoms.includes(url)}
                  onChange={() => handleBlossomToggle(url)}
                  size="xs"
                />
              ))
            )}
          </Stack>
          <Flex gap="xs" mt={8}>
            <TextInput
              placeholder="https://blossom.example.com"
              value={customBlossom}
              onChange={(e) => setCustomBlossom(e.currentTarget.value)}
              size="xs"
              radius={0}
              style={{ flex: 1 }}
              styles={{ input: { fontFamily: '"SFMono-Regular", Menlo, Monaco, Consolas, monospace' } }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCustomBlossom() } }}
            />
            <Button variant="default" size="xs" radius={0} onClick={handleAddCustomBlossom} disabled={!customBlossom.trim()}>add</Button>
          </Flex>
        </Box>
      </Flex>

      {/* ── divider ── */}
      <Box my="lg" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }} />

      {/* ── when & submit ── */}
      <Flex align="flex-end" justify="space-between" gap="md">
        <Box>
          <Text size="xs" ff="monospace" fw={600} tt="uppercase" c="dimmed" mb={8}>when</Text>
          <SegmentedControl
            value={publishMode}
            onChange={(v) => setPublishMode(v)}
            data={[
              { label: 'now', value: 'now' },
              { label: 'later', value: 'later' },
            ]}
            size="xs"
            radius={0}
            styles={{ root: { border: '1px solid var(--mantine-color-default-border)' } }}
          />
          {publishMode === 'later' && (
            <Group mt={8} gap={6}>
              <input
                type="datetime-local"
                value={publishAt}
                onChange={(e) => setPublishAt(e.target.value)}
                style={{
                  fontFamily: '"SFMono-Regular", Menlo, Monaco, Consolas, monospace',
                  fontSize: rem(12),
                  padding: '4px 8px',
                  height: 28,
                  border: '1px solid var(--mantine-color-default-border)',
                  background: 'var(--mantine-color-body)',
                  color: 'var(--mantine-color-text)',
                }}
              />
              {['+5m', '+1h', '+6h', 'tomorrow'].map((label) => (
                <Button
                  key={label}
                  variant={activePreset === label ? 'light' : 'default'}
                  color={activePreset === label ? 'relaykit' : undefined}
                  size="compact-xs"
                  radius={0}
                  ff="monospace"
                  h={28}
                  onClick={() => setPresetTime(label)}
                >
                  {label}
                </Button>
              ))}
            </Group>
          )}
        </Box>

        <Box ta="right">
          {error && <Text size="xs" ff="monospace" c="red" mb={4}>{error}</Text>}
          <Button size="sm" radius={0} onClick={handleSubmit} loading={submitting} disabled={uploading}>
            {publishMode === 'now' ? 'publish' : 'schedule'}
          </Button>
        </Box>
      </Flex>
    </Stack>
  )
}
