import { useMemo, useState } from 'react'
import { Button, CloseButton, Combobox, Group, Pill, PillsInput, Stack, Text, rem, useCombobox } from '@mantine/core'
import { dedupeRelays } from './relays'
import { dedupeHttpsUrls } from './urls'

/** A labelled set of urls offered as one-click adds below the input (e.g. the user's own nip-65 list). */
export type RelaySuggestionGroup = { label: string; relays: string[] }

type EndpointScheme = 'relay' | 'https'

const SCHEME = {
  relay: {
    dedupe: dedupeRelays,
    stripPrefix: /^wss?:\/\//,
    emptyPlaceholder: 'wss://relay.example.com',
    addPlaceholder: 'add relay...',
    emptyMessage: 'no relay matches — press enter to add',
    ariaLabel: 'relay url',
    forgetLabel: 'forget relay',
  },
  https: {
    dedupe: dedupeHttpsUrls,
    stripPrefix: /^https?:\/\//,
    emptyPlaceholder: 'https://blossom.example.com',
    addPlaceholder: 'add url...',
    emptyMessage: 'no url matches — press enter to add',
    ariaLabel: 'url',
    forgetLabel: 'forget url',
  },
} as const satisfies Record<EndpointScheme, {
  dedupe: (urls: string[]) => string[]
  stripPrefix: RegExp
  emptyPlaceholder: string
  addPlaceholder: string
  emptyMessage: string
  ariaLabel: string
  forgetLabel: string
}>

const MAX_PREVIOUS = 20

const loadPrevious = (storageKey: string): string[] => {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) return parsed.filter((r) => typeof r === 'string')
    }
  } catch {}
  return []
}

/**
 * Multi-select endpoint picker (wss relays or https blossom bases): removable pills, typeahead
 * from known services plus previously used entries (persisted per app).
 */
export const RelayPillsInput = ({
  value,
  onChange,
  knownUrls,
  storageKey,
  suggestions,
  scheme = 'relay',
  placeholder,
}: {
  value: string[]
  onChange: (urls: string[]) => void
  /** urls known to relaykit (deployed services), shown first in the dropdown */
  knownUrls: string[]
  /** app-namespaced localStorage key for remembering manually added urls */
  storageKey: string
  /** optional one-click adds rendered below the input; nothing is ever added implicitly */
  suggestions?: RelaySuggestionGroup[]
  scheme?: EndpointScheme
  placeholder?: string
}) => {
  const cfg = SCHEME[scheme]
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() })
  const [draft, setDraft] = useState('')
  const [previousUrls, setPreviousUrls] = useState<string[]>(() => loadPrevious(storageKey))

  const persistPrevious = (next: string[]) => {
    setPreviousUrls(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {}
  }

  const addUrl = (url: string, { remember = false }: { remember?: boolean } = {}) => {
    const [normalized] = cfg.dedupe([url])
    if (!normalized) return
    if (remember && !knownUrls.includes(normalized)) {
      persistPrevious([normalized, ...previousUrls.filter((r) => r !== normalized)].slice(0, MAX_PREVIOUS))
    }
    if (!value.includes(normalized)) onChange([...value, normalized])
    setDraft('')
  }

  const removeUrl = (url: string) => {
    onChange(value.filter((r) => r !== url))
  }

  const forgetPrevious = (url: string) => {
    persistPrevious(previousUrls.filter((r) => r !== url))
  }

  const options = useMemo(() => {
    const query = draft.trim().toLowerCase()
    const known = knownUrls
      .filter((url) => !value.includes(url))
      .filter((url) => !query || url.toLowerCase().includes(query))
      .map((url) => ({ value: url, source: 'service' as const }))
    const previous = previousUrls
      .filter((url) => !knownUrls.includes(url) && !value.includes(url))
      .filter((url) => !query || url.toLowerCase().includes(query))
      .map((url) => ({ value: url, source: 'previous' as const }))
    return [...known, ...previous]
  }, [knownUrls, previousUrls, value, draft])

  const suggestionGroups = useMemo(
    () =>
      (suggestions ?? [])
        .map((group) => ({ label: group.label, urls: cfg.dedupe(group.relays).filter((r) => !value.includes(r)) }))
        .filter((group) => group.urls.length > 0),
    [suggestions, value, cfg],
  )

  const emptyPlaceholder = placeholder ?? cfg.emptyPlaceholder

  const input = (
    <Combobox
      store={combobox}
      withinPortal={false}
      onOptionSubmit={(url) => {
        addUrl(url)
        combobox.closeDropdown()
      }}
    >
      <Combobox.Target>
        <PillsInput
          size="xs"
          onClick={() => {
            combobox.openDropdown()
            combobox.resetSelectedOption()
          }}
        >
          <Pill.Group>
            {value.map((url) => (
              <Pill
                key={url}
                size="xs"
                color="relaykit"
                variant="light"
                withRemoveButton
                onRemove={() => removeUrl(url)}
                title={url}
              >
                {url.replace(cfg.stripPrefix, '')}
              </Pill>
            ))}
            <PillsInput.Field
              aria-label={cfg.ariaLabel}
              value={draft}
              onChange={(e) => {
                setDraft(e.currentTarget.value)
                combobox.openDropdown()
                combobox.resetSelectedOption()
              }}
              onFocus={() => {
                combobox.openDropdown()
                combobox.resetSelectedOption()
              }}
              onBlur={() => {
                if (draft.trim()) addUrl(draft, { remember: true })
                combobox.closeDropdown()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (!combobox.dropdownOpened || options.length === 0)) {
                  e.preventDefault()
                  addUrl(draft, { remember: true })
                }
                if ((e.key === 'Backspace' || e.key === 'Delete') && draft.length === 0 && value.length > 0) {
                  e.preventDefault()
                  removeUrl(value[value.length - 1])
                }
              }}
              placeholder={value.length === 0 ? emptyPlaceholder : cfg.addPlaceholder}
              style={{ flex: 1, minWidth: rem(140), fontFamily: 'monospace' }}
            />
          </Pill.Group>
        </PillsInput>
      </Combobox.Target>

      <Combobox.Dropdown>
        <Combobox.Options mah={280} style={{ overflowY: 'auto' }}>
          {options.length > 0 ? (
            options.map((option) => (
              <Combobox.Option key={`${option.source}-${option.value}`} value={option.value}>
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="xs" ff="monospace" c={option.source === 'service' ? 'relaykit' : 'dimmed'} truncate>
                    {option.value}
                  </Text>
                  {option.source === 'previous' && (
                    <CloseButton
                      size="xs"
                      aria-label={cfg.forgetLabel}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        forgetPrevious(option.value)
                      }}
                    />
                  )}
                </Group>
              </Combobox.Option>
            ))
          ) : (
            <Combobox.Empty>{cfg.emptyMessage}</Combobox.Empty>
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  )

  if (suggestionGroups.length === 0) return input

  return (
    <Stack gap={6}>
      {input}
      {suggestionGroups.map((group) => (
        <Group key={group.label} gap={6} align="center">
          <Text size="xs" c="dimmed">{group.label}</Text>
          {group.urls.map((url) => (
            <Button
              key={url}
              size="compact-xs"
              variant="default"
              onClick={() => addUrl(url)}
              styles={{ label: { fontFamily: 'monospace', fontSize: rem(10) } }}
            >
              + {url.replace(cfg.stripPrefix, '')}
            </Button>
          ))}
        </Group>
      ))}
    </Stack>
  )
}
