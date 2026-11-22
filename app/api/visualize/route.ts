import { NextRequest, NextResponse } from 'next/server'

type JsonRecord = Record<string, unknown>

function extractRecords(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload as JsonRecord[]
  if (!payload || typeof payload !== 'object') return []

  const record = payload as JsonRecord
  for (const key of ['events', 'data', 'items', 'results', 'records', 'content', 'list']) {
    if (Array.isArray(record[key])) return record[key] as JsonRecord[]
  }

  for (const value of Object.values(record)) {
    if (Array.isArray(value) && value.length) return value as JsonRecord[]
  }

  return [record]
}

async function readJson(url: string, apiKey: string) {
  const response = await fetch(url, {
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    return null
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('json')) {
    const text = await response.text()
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  return response.json()
}

export async function POST(request: NextRequest) {
  let body: { baseUrl?: string; apiKey?: string; topicId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid connection configuration.' }, { status: 400 })
  }

  if (!body.baseUrl) {
    return NextResponse.json({ error: 'Enter a base URL.' }, { status: 400 })
  }

  const baseUrl = body.baseUrl.trim().replace(/\/$/, '')
  const apiKey = body.apiKey?.trim() || ''
  let payload: unknown = null

  if (body.topicId) {
    payload = await readJson(
      `${baseUrl}/v1/topics/${encodeURIComponent(body.topicId)}/events`,
      apiKey,
    )
  }

  if (!payload) payload = await readJson(baseUrl, apiKey)

  if (!payload) {
    const probes = [
      `${baseUrl}/v1/topics`,
      `${baseUrl}/v1/topics/me`,
      `${baseUrl}/v1/topic`,
      `${baseUrl}/v1/me`,
      `${baseUrl}/v1/events`,
      `${baseUrl}/posts`,
      `${baseUrl}/users`,
      `${baseUrl}/todos`,
    ]
    for (const url of probes) {
      payload = await readJson(url, apiKey)
      if (payload) break
    }
  }

  if (!payload) {
    return NextResponse.json(
      { error: 'Could not reach or read JSON from this Base URL. Verify the URL, API key, and server CORS/network access.' },
      { status: 502 },
    )
  }

  const events = extractRecords(payload)
  if (!events.length) {
    return NextResponse.json({ error: 'The Base URL returned JSON but no readable records.' }, { status: 422 })
  }

  const record = payload as JsonRecord
  const topicId = body.topicId
    || (typeof record.topic_id === 'string' ? record.topic_id : '')
    || (typeof record.topicId === 'string' ? record.topicId : '')
    || 'data-source'

  return NextResponse.json({ topicId, events })
}
