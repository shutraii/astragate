import type { PulseEvent } from './types'

export interface ConnectionConfig {
  baseUrl: string
  topicId: string
  apiKey: string
}

export function getConnectionConfig(): ConnectionConfig {
  return {
    baseUrl: (process.env.NEXT_PUBLIC_PUBLIC_BASE_URL as string | undefined)?.replace(/\/$/, '') || '',
    topicId: (process.env.NEXT_PUBLIC_TOPIC_ID as string | undefined) || '',
    apiKey: (process.env.NEXT_PUBLIC_API_KEY as string | undefined) || '',
  }
}

export function isConfigured(config: ConnectionConfig) {
  return Boolean(config.baseUrl && config.topicId && config.apiKey)
}

function topicFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''

  const record = payload as Record<string, unknown>
  const directKeys = ['topic_id', 'topicId', 'topic', 'name', 'topic_name']
  for (const key of directKeys) {
    const value = record[key]
    if (typeof value === 'string' && value) return value
  }

  for (const key of ['topics', 'data']) {
    const value = record[key]
    if (Array.isArray(value) && value.length) {
      const first = value[0]
      if (first && typeof first === 'object') {
        const nested = first as Record<string, unknown>
        for (const nestedKey of directKeys) {
          if (typeof nested[nestedKey] === 'string' && nested[nestedKey]) {
            return nested[nestedKey] as string
          }
        }
      }
    }
  }
  return ''
}

function extractEventRecords(payload: unknown): PulseEvent[] {
  if (Array.isArray(payload)) return payload as PulseEvent[]
  if (!payload || typeof payload !== 'object') return []

  const record = payload as Record<string, unknown>
  for (const key of ['events', 'data', 'items', 'results', 'records', 'content', 'list']) {
    if (Array.isArray(record[key])) return record[key] as PulseEvent[]
  }

  for (const value of Object.values(record)) {
    if (Array.isArray(value) && value.length) return value as PulseEvent[]
  }

  return [payload as PulseEvent]
}

export async function discoverTopic(
  config: Omit<ConnectionConfig, 'topicId'> & { topicId?: string },
): Promise<{ topicId: string; events: PulseEvent[] }> {
  if (!config.baseUrl) {
    throw new Error('Enter a base URL')
  }

  const headers = {
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    Accept: 'application/json',
  }
  const baseUrl = config.baseUrl.replace(/\/$/, '')

  try {
    const exactResponse = await fetch(baseUrl, { headers })
    if (exactResponse.ok) {
      const exactPayload = await exactResponse.json()
      const exactEvents = extractEventRecords(exactPayload)
      if (exactEvents.length) {
        const exactTopic = topicFromPayload(exactPayload) || config.topicId || 'data-source'
        return { topicId: exactTopic, events: exactEvents }
      }
    }
  } catch {
    // Continue with known broker endpoint shapes.
  }

  if (config.topicId) {
    try {
      const directResponse = await fetch(
        `${baseUrl}/v1/topics/${encodeURIComponent(config.topicId)}/events`,
        { headers },
      )
      if (directResponse.ok) {
        const directPayload = await directResponse.json()
        const events = extractEventRecords(directPayload)
        if (events.length) return { topicId: config.topicId, events }
      }
    } catch {
      // Fall through to topic discovery.
    }
  }

  const probeUrls = [
    `${baseUrl}/v1/topics`,
    `${baseUrl}/v1/topics/me`,
    `${baseUrl}/v1/topic`,
    `${baseUrl}/v1/me`,
    `${baseUrl}/v1/events`,
    `${baseUrl}/posts`,
    `${baseUrl}/users`,
    `${baseUrl}/todos`,
    baseUrl,
  ]

  for (const url of probeUrls) {
    try {
      const response = await fetch(url, { headers })
      if (!response.ok) continue

      const payload = await response.json()
      if (Array.isArray(payload)) {
        const topicId = topicFromPayload(payload[0])
          || (typeof payload[0] === 'object' && payload[0] ? String((payload[0] as Record<string, unknown>).topic_id || '') : '')
        if (topicId) {
          const eventsResponse = await fetch(`${baseUrl}/v1/topics/${encodeURIComponent(topicId)}/events`, { headers })
          if (eventsResponse.ok) {
            const eventsPayload = await eventsResponse.json()
            if (Array.isArray(eventsPayload)) return { topicId, events: eventsPayload as PulseEvent[] }
            if (Array.isArray((eventsPayload as Record<string, unknown>).events)) {
              return { topicId, events: (eventsPayload as Record<string, unknown>).events as PulseEvent[] }
            }
          }
          return { topicId, events: payload as PulseEvent[] }
        }
        if (payload.length) return { topicId: 'associated-topic', events: payload as PulseEvent[] }
      }

      if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>
        const events = extractEventRecords(payload)
        const topicId = topicFromPayload(payload) ||
          (events[0] ? topicFromPayload(events[0]) : '')

        if (topicId) return { topicId, events }
        if (events.length) return { topicId: 'associated-topic', events }
      }
    } catch {
      // Try the next discovery endpoint.
    }
  }

  throw new Error('Could not reach or read JSON from this Base URL')
}

export async function fetchEvents(config: ConnectionConfig): Promise<PulseEvent[]> {
  if (!isConfigured(config)) {
    throw new Error('Enter the public base URL and API key')
  }

  const response = await fetch(`${config.baseUrl}/v1/topics/${encodeURIComponent(config.topicId)}/events`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`API returned ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload.events)) return payload.events
  throw new Error('API response did not contain an events array')
}
