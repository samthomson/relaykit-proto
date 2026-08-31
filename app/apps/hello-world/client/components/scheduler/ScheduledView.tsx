import { useState } from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Flex,
  Group,
  Image,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import {
  cancelPost,
  deletePost,
  listPosts,
  type ScheduledPost,
} from '@/lib/schedulerApi'
import { formatISO } from '@/lib/datetime'
import { extractImages, stripImageUrls } from '@/lib/images'

const relativeTime = (iso: string): string => {
  const diff = new Date(iso).getTime() - Date.now()
  const abs = Math.abs(diff)
  const past = diff < 0
  const fmt = (n: number, unit: string) => `${Math.round(n)} ${unit}${Math.round(n) !== 1 ? 's' : ''}`
  let label: string
  if (abs < 60_000) label = 'less than a minute'
  else if (abs < 3_600_000) label = fmt(abs / 60_000, 'minute')
  else if (abs < 86_400_000) label = fmt(abs / 3_600_000, 'hour')
  else label = fmt(abs / 86_400_000, 'day')
  return past ? `${label} ago` : `in ${label}`
}

interface ScheduledViewProps {
  onEdit: (post: ScheduledPost) => void
}

const PostCard = ({
  post,
  onEdit,
  isHistory,
}: {
  post: ScheduledPost
  onEdit: (post: ScheduledPost) => void
  isHistory: boolean
}) => {
  const queryClient = useQueryClient()

  const cancel = useMutation({
    mutationFn: () => cancelPost(post.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-posts'] }),
  })

  const remove = useMutation({
    mutationFn: () => deletePost(post.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-posts'] }),
  })

  const rawContent = typeof post.signedEvent?.content === 'string' ? post.signedEvent.content : ''
  const images = extractImages(rawContent)
  const textContent = stripImageUrls(rawContent)
  const preview = textContent.length > 100 ? `${textContent.slice(0, 100)}...` : textContent

  const successCount = post.relayResults?.filter((r) => r.success).length ?? 0
  const totalRelays = post.relayResults?.length ?? post.relays.length

  const statusColor = post.status === 'published' ? 'relaykit' : post.status === 'failed' ? 'red' : post.status === 'cancelled' ? 'gray' : 'yellow'

  const relayList = post.relayResults ?? post.relays.map((url) => ({ url, success: true, message: undefined }))

  return (
    <Paper withBorder radius={0} px="xs" py={6}>
      <Flex justify="space-between" align="center">
        <Group gap={6}>
          <Badge variant="light" color={statusColor} size="xs" radius={0}>{post.status}</Badge>
          <Text fz={10} ff="monospace" c="dimmed">{formatISO(post.publishAt)}</Text>
          {!isHistory && post.status === 'pending' && (
            <Text fz={10} ff="monospace" c="relaykit" fw={600}>{relativeTime(post.publishAt)}</Text>
          )}
          {post.relayResults && (
            <Text fz={10} ff="monospace" c="dimmed">{successCount}/{totalRelays}</Text>
          )}
        </Group>
        <Group gap={4}>
          {!isHistory && post.status === 'pending' && (
            <>
              <Button variant="subtle" size="compact-xs" ff="monospace" onClick={() => onEdit(post)}>edit</Button>
              <Button variant="subtle" color="red" size="compact-xs" ff="monospace" onClick={() => cancel.mutate()} loading={cancel.isPending}>cancel</Button>
            </>
          )}
          {!isHistory && post.status === 'failed' && (
            <Button variant="subtle" size="compact-xs" ff="monospace" onClick={() => onEdit(post)}>reschedule</Button>
          )}
          {isHistory && (
            <ActionIcon variant="subtle" color="dimmed" size="xs" onClick={() => remove.mutate()} loading={remove.isPending}>
              <Trash2 size={12} />
            </ActionIcon>
          )}
        </Group>
      </Flex>

      {(preview || images.length > 0) && (
        <Flex gap={6} align="center" mt={4}>
          {images.slice(0, 2).map((url, i) => (
            <Image key={i} src={url} alt="" h={28} w={40} fit="cover" radius={0} />
          ))}
          {preview && <Text size="xs" ff="monospace" lineClamp={1} style={{ flex: 1 }}>{preview}</Text>}
        </Flex>
      )}

      <Group gap={4} mt={4}>
        {relayList.map((r) => (
          <Tooltip key={r.url} label={r.message || r.url} position="top">
            <Badge
              size="xs"
              radius={0}
              variant="light"
              color={post.relayResults ? (r.success ? 'relaykit' : 'red') : 'relaykit'}
              ff="monospace"
            >
              {post.relayResults && (r.success ? '✓ ' : '✗ ')}{r.url.replace(/^wss?:\/\//, '')}
            </Badge>
          </Tooltip>
        ))}
      </Group>
    </Paper>
  )
}

export const ScheduledView = ({ onEdit }: ScheduledViewProps) => {
  const [tab, setTab] = useState('upcoming')

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['scheduled-posts'],
    queryFn: ({ signal }) => listPosts(signal),
    refetchInterval: 15_000,
  })

  const upcoming = data?.filter((p) => p.status === 'pending') ?? []
  const history = data?.filter((p) => p.status !== 'pending') ?? []
  const activeList = tab === 'upcoming' ? upcoming : history

  const queryClient = useQueryClient()
  const bulkRemove = useMutation({
    mutationFn: async () => {
      for (const post of history) {
        await deletePost(post.id)
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-posts'] }),
  })

  return (
    <Box maw={700}>
      <Flex align="center" justify="space-between" mb="xs">
        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v)}
          data={[
            { label: `upcoming${upcoming.length > 0 ? ` (${upcoming.length})` : ''}`, value: 'upcoming' },
            { label: `history${history.length > 0 ? ` (${history.length})` : ''}`, value: 'history' },
          ]}
          size="xs"
          radius={0}
          styles={{ root: { border: '1px solid var(--mantine-color-default-border)' } }}
        />
        <Group gap="xs">
          {tab === 'history' && history.length > 0 && (
            <Button variant="subtle" color="red" size="compact-xs" ff="monospace" onClick={() => bulkRemove.mutate()} loading={bulkRemove.isPending}>
              clear logs
            </Button>
          )}
          <Button variant="subtle" size="compact-xs" ff="monospace" onClick={() => refetch()} loading={isFetching}>refresh</Button>
        </Group>
      </Flex>

      {isLoading && <Text size="xs" ff="monospace" c="dimmed">loading...</Text>}
      {isError && <Text size="xs" ff="monospace" c="red">{error instanceof Error ? error.message : 'failed to load'}</Text>}

      {!isLoading && !isError && activeList.length === 0 && (
        <Text size="xs" ff="monospace" c="dimmed" mt="md">
          {tab === 'upcoming' ? 'no upcoming posts' : 'no published posts yet'}
        </Text>
      )}

      {activeList.length > 0 && (
        <Stack gap={6}>
          {activeList.map((post) => (
            <PostCard key={post.id} post={post} onEdit={onEdit} isHistory={tab === 'history'} />
          ))}
        </Stack>
      )}
    </Box>
  )
}
