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

export async function discoverTopic(config: Omit<ConnectionConfig, 'topicId'>): Promise<{ topicId: string; events: PulseEvent[] }> {
  if (!config.baseUrl || !config.apiKey) {
    throw new Error('Enter a base URL and API key')
  }

  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    Accept: 'application/json',
  }
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  const probeUrls = [
    `${baseUrl}/v1/topics`,
    `${baseUrl}/v1/topics/me`,
    `${baseUrl}/v1/topic`,
    `${baseUrl}/v1/me`,
    `${baseUrl}/v1/events`,
    baseUrl,
    `${baseUrl}/posts`,
    `${baseUrl}/users`,
    `${baseUrl}/todos`,
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
        const events = Array.isArray(record.events)
          ? record.events as PulseEvent[]
          : Array.isArray(record.data)
            ? record.data as PulseEvent[]
            : []
        const topicId = topicFromPayload(payload) ||
          (events[0] ? topicFromPayload(events[0]) : '')

        if (topicId) return { topicId, events }
        if (events.length) return { topicId: 'associated-topic', events }
      }
    } catch {
      // Try the next discovery endpoint.
    }
  }

  throw new Error('No topic could be detected for this API key')
}

export async function fetchEvents(config: ConnectionConfig): Promise<PulseEvent[]> {
  if (!isConfigured(config)) {
    throw new Error('Add VITE_PUBLIC_BASE_URL, VITE_TOPIC_ID and VITE_API_KEY to .env')
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
