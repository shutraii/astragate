'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Activity,
  CircleAlert,
  Cloud,
  ExternalLink,
  Link2,
  RefreshCw,
  Search,
} from 'lucide-react'
import { discoverTopic, getConnectionConfig } from './api'
import type { PulseEvent } from './types'

type Connection = {
  baseUrl: string
  topicName: string
  apiKey: string
}

function timeLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(date)
}

function inferText(event: PulseEvent, keys: string[]) {
  const record = event as unknown as Record<string, unknown>
  for (const key of keys) {
    if (typeof record[key] === 'string' && record[key]) return record[key] as string
  }
  return 'Untitled event'
}

function flattenRecord(value: unknown, prefix = '', result: Record<string, unknown> = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix) result[prefix] = value
    return result
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    const flatKey = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenRecord(child, flatKey, result)
    } else if (Array.isArray(child)) {
      result[flatKey] = child.length ? JSON.stringify(child) : '[]'
    } else {
      result[flatKey] = child
    }
  })
  return result
}

export default function Dashboard() {
  const initial = getConnectionConfig()
  const [connection, setConnection] = useState<Connection>({
    baseUrl: initial.baseUrl,
    topicName: '',
    apiKey: initial.apiKey,
  })
  const [events, setEvents] = useState<PulseEvent[]>([])
  const [connected, setConnected] = useState(Boolean(initial.baseUrl && initial.apiKey))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<PulseEvent | null>(null)

  async function connect(nextConnection = connection) {
    if (!nextConnection.baseUrl || !nextConnection.apiKey) {
      setError('Enter a base URL and API key.')
      return
    }

    setLoading(true)
    setError('')
    try {
      const discovered = await discoverTopic({
        baseUrl: nextConnection.baseUrl,
        apiKey: nextConnection.apiKey,
      })
      setConnection({ ...nextConnection, topicName: discovered.topicId })
      setEvents(discovered.events)
      setSelected(discovered.events[0] || null)
      setConnected(true)
    } catch (err) {
      setConnected(false)
      setError(err instanceof Error ? err.message : 'Unable to connect to the topic.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (initial.baseUrl && initial.apiKey) connect(connection)
    // eslint-disable-next-line react-hooks/exhaustive-hooks
  }, [])

  const normalizedEvents = useMemo(
    () => events.map((event) => flattenRecord(event) as unknown as PulseEvent),
    [events],
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return normalizedEvents
    return normalizedEvents.filter((event) =>
      JSON.stringify(event).toLowerCase().includes(term),
    )
  }, [normalizedEvents, search])

  const discoveredFields = useMemo(() => {
    const fields = new Map<string, Set<string>>()
    normalizedEvents.forEach((event) => {
      Object.entries(event as unknown as Record<string, unknown>).forEach(([key, value]) => {
        if (value === null || value === undefined) return
        if (!fields.has(key)) fields.set(key, new Set())
        fields.get(key)?.add(typeof value === 'object' ? 'object' : typeof value)
      })
    })
    return [...fields.entries()].map(([key, types]) => {
      const values = normalizedEvents
        .map((event) => (event as unknown as Record<string, unknown>)[key])
        .filter((value) => value !== null && value !== undefined)
      const numericString = types.has('string') &&
        values.length > 0 &&
        values.every((value) => typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
      return {
        key,
        type: numericString ? 'number' : [...types][0],
      }
    })
  }, [normalizedEvents])

  const numericFields = discoveredFields.filter((field) => field.type === 'number')
  const primaryNumericField = numericFields[0]?.key
  const categoricalFields = discoveredFields.filter((field) => field.type === 'string')
  const primaryCategoryField =
    categoricalFields.find((field) => ['category', 'status', 'change_type', 'approval_status', 'delivery_status'].includes(field.key))?.key ||
    categoricalFields.find((field) => !['title', 'summary', 'timestamp', 'event_id', 'topic_id'].includes(field.key))?.key

  const chartData = useMemo(() => {
    if (!normalizedEvents.length) return []
    return normalizedEvents.slice(-12).map((event, index) => {
      const record = event as unknown as Record<string, unknown>
      const time = typeof event.timestamp === 'string'
        ? timeLabel(event.timestamp)
        : `Item ${index + 1}`
      const value = primaryNumericField
        ? Number(record[primaryNumericField])
        : 1
      return { time, value: Number.isFinite(value) ? value : 0 }
    })
  }, [normalizedEvents, primaryNumericField])

  const categoryData = useMemo(() => {
    if (!normalizedEvents.length || !primaryCategoryField) return []
    const counts = new Map<string, number>()
    normalizedEvents.forEach((event) => {
      const record = event as unknown as Record<string, unknown>
      const value = String(record[primaryCategoryField] ?? 'Unknown')
      counts.set(value, (counts.get(value) || 0) + 1)
    })
    return [...counts.entries()].map(([name, count]) => ({ name, count }))
  }, [normalizedEvents, primaryCategoryField])

  const dynamicMetrics = useMemo(() => {
    const recordCount = {
      label: 'Records',
      value: normalizedEvents.length,
      field: 'total',
    }
    if (!numericFields.length) return [recordCount]
    return numericFields.slice(0, 3).map((field) => {
      const values = normalizedEvents
        .map((event) => Number((event as unknown as Record<string, unknown>)[field.key]))
        .filter((value) => Number.isFinite(value))
      const value = values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : 0
      return {
        label: field.key.replace(/_/g, ' '),
        value: Math.round(value * 100) / 100,
        field: field.key,
      }
    }).concat(recordCount)
  }, [normalizedEvents, numericFields])

  const characteristicCards = useMemo(() => {
    return discoveredFields.map((field) => {
      const values = normalizedEvents
        .map((event) => (event as unknown as Record<string, unknown>)[field.key])
        .filter((value) => value !== null && value !== undefined)

      if (field.type === 'number') {
        const numbers = values.map(Number).filter(Number.isFinite)
        const average = numbers.length
          ? Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 100) / 100
          : 0
        return { field, value: average, detail: `Average of ${numbers.length} values`, format: 'number' }
      }

      if (field.type === 'boolean') {
        const trueCount = values.filter((value) => value === true).length
        const percentage = values.length ? Math.round((trueCount / values.length) * 100) : 0
        return { field, value: `${percentage}%`, detail: `${trueCount} of ${values.length} true`, format: 'boolean' }
      }

      const counts = new Map<string, number>()
      values.forEach((value) => {
        const text = String(value)
        counts.set(text, (counts.get(text) || 0) + 1)
      })
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
      return {
        field,
        value: top?.[0] || 'No value',
        detail: top ? `${top[1]} record${top[1] === 1 ? '' : 's'}` : '0 records',
        format: 'text',
      }
    })
  }, [normalizedEvents, discoveredFields])

  const verifiedCount = events.filter((event) => event.verified).length
  const deliveredCount = events.filter((event) => event.delivery_status === 'delivered').length
  const pendingCount = events.filter((event) => event.approval_status === 'pending').length

  return (
    <main className="min-h-screen bg-[#07111f] text-[#eaf7ff]">
      <header className="sticky top-0 z-20 h-16 border-b border-[#17324d] bg-[#091521]/95 backdrop-blur">
        <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between px-5 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#1687ff] text-white shadow-[0_6px_18px_rgba(22,135,255,.35)]">
              <Cloud size={20} fill="currentColor" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#73ddf8]">PULSE GATE</p>
              <p className="text-sm font-semibold text-[#edfaff]">Event Intelligence</p>
            </div>
          </div>

          {connected && (
            <span className="flex h-9 items-center gap-2 rounded-md border border-[#1c3f5c] bg-[#0b1b2b] px-3 text-xs font-semibold text-[#b9d7e9] shadow-sm">
              <span className="h-2 w-2 rounded-full bg-[#22d3ee] shadow-[0_0_0_3px_rgba(34,211,238,.16)]" />
              Connected
            </span>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-5 py-6 lg:px-8">
        {error && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-[#7a3f56] bg-[#2a1721] px-4 py-3 text-xs text-[#ffb4c8]">
            <span className="flex items-center gap-2"><CircleAlert size={15} />{error}</span>
          </div>
        )}

        {!connected ? (
          <section className="grid min-h-[calc(100vh-112px)] place-items-center">
            <div className="w-full max-w-[520px] rounded-xl border border-[#17324d] bg-[#0b1828] px-8 py-9 shadow-[0_18px_50px_rgba(0,0,0,.28)]">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-[#10243b] text-[#22d3ee]">
                <Link2 size={23} />
              </div>
              <h1 className="mt-5 text-2xl font-semibold tracking-tight">Configure connection</h1>
              <p className="mt-2 text-sm leading-6 text-[#8da5b8]">
                Enter the Cloudflare tunnel base URL and API key. PULSE GATE will detect the associated topic and visualize the returned fields automatically.
              </p>

              <div className="mt-7 space-y-5">
                <label className="block text-xs font-semibold text-[#b9d7e9]">
                  Base URL
                  <input
                    value={connection.baseUrl}
                    onChange={(event) => setConnection({ ...connection, baseUrl: event.target.value })}
                    placeholder="https://your-tunnel.trycloudflare.com"
                    name="base-url"
                    autoComplete="url"
                    className="mt-2 h-11 w-full rounded-md border border-[#234866] bg-[#07111f] px-3 text-sm font-normal text-[#eaf7ff] outline-none placeholder:text-[#5d7a90] focus:border-[#22d3ee] focus:ring-4 focus:ring-[#22d3ee]/10"
                  />
                </label>
                <label className="block text-xs font-semibold text-[#b9d7e9]">
                  API key
                  <input
                    type="password"
                    value={connection.apiKey}
                    onChange={(event) => setConnection({ ...connection, apiKey: event.target.value })}
                    placeholder="sk_live_..."
                    name="api-key"
                    autoComplete="off"
                    className="mt-2 h-11 w-full rounded-md border border-[#234866] bg-[#07111f] px-3 text-sm font-normal text-[#eaf7ff] outline-none placeholder:text-[#5d7a90] focus:border-[#22d3ee] focus:ring-4 focus:ring-[#22d3ee]/10"
                  />
                </label>
              </div>

              <button
                onClick={() => connect()}
                disabled={loading}
                className="mt-7 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#1687ff] to-[#22d3ee] text-sm font-semibold text-[#04111f] shadow-[0_8px_22px_rgba(22,135,255,.24)] hover:brightness-110 disabled:opacity-60"
              >
                {loading ? <RefreshCw size={14} className="animate-spin" /> : <Link2 size={14} />}
                Visualize data
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#73ddf8]">Live topic</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">{connection.topicName}</h1>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => connect()}
                  disabled={loading}
                  className="flex h-9 items-center gap-2 rounded-md border border-[#234866] bg-[#0b1828] px-3 text-xs font-semibold text-[#b9d7e9] shadow-sm hover:border-[#22d3ee]"
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                  Refresh data
                </button>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {dynamicMetrics.slice(0, 4).map((metric, index) => (
                <article key={metric.field} className="flex min-h-24 items-center gap-3 rounded-lg border border-[#17324d] bg-[#0b1828] px-4 shadow-[0_5px_18px_rgba(0,0,0,.16)]">
                  <div className={`grid h-10 w-10 place-items-center rounded-lg ${index % 2 === 0 ? 'bg-[#10243b] text-[#22d3ee]' : 'bg-[#10243b] text-[#1687ff]'}`}><Activity size={18} /></div>
                  <div>
                    <p className="text-xs capitalize text-[#8da5b8]">{metric.label}</p>
                    <p className="mt-1 text-2xl font-semibold">{metric.value}</p>
                  </div>
                </article>
              ))}
            </section>

            {characteristicCards.length > 0 && (
              <section className="mt-4">
                <div className="mb-3 flex items-end justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#73ddf8]">JSON characteristics</p>
                    <p className="mt-1 text-xs text-[#7894a8]">Automatically detected fields and feature summaries</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {characteristicCards.slice(0, 12).map((card) => (
                    <article key={card.field.key} className="min-h-[112px] rounded-lg border border-[#17324d] bg-[#0b1828] p-4 shadow-[0_5px_18px_rgba(0,0,0,.12)]">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs font-semibold capitalize text-[#b9d7e9]" title={card.field.key}>
                          <span className="block text-[9px] uppercase tracking-[.12em] text-[#73ddf8]">Trend / feature</span>
                          <span className="mt-1 block truncate">{card.field.key.replace(/[._]/g, ' ')}</span>
                        </p>
                        <span className="rounded-full border border-[#234866] px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-[#73ddf8]">
                          {card.format}
                        </span>
                      </div>
                      <p className="mt-4 truncate text-xl font-semibold text-[#edfaff]" title={String(card.value)}>
                        {card.value}
                      </p>
                      <p className="mt-1 text-[10px] text-[#7894a8]">{card.detail}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_320px]">
              <article className="min-h-[330px] rounded-lg border border-[#17324d] bg-[#0b1828]">
                <div className="flex h-16 items-center justify-between border-b border-[#17324d] px-5">
                  <div><h2 className="text-sm font-semibold text-[#eaf7ff]">{primaryNumericField ? `${primaryNumericField.replace(/_/g, ' ')} trend` : 'Event count trend'}</h2><p className="mt-1 text-[10px] text-[#7894a8]">Discovered automatically from the API response</p></div>
                  <span className="rounded-full border border-[#1687ff]/30 bg-[#1687ff]/10 px-2.5 py-1 text-[10px] font-bold text-[#73ddf8]">Live</span>
                </div>
                <div className="h-[260px] px-2 pb-4 pt-5">
                  {chartData.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 5, right: 12, left: -18, bottom: 0 }}>
                        <defs>
                          <linearGradient id="cloudflareFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#1687ff" stopOpacity={0.34} />
                            <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#17324d" vertical={false} />
                        <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: '#7894a8', fontSize: 10 }} />
                        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#7894a8', fontSize: 10 }} />
                        <Tooltip contentStyle={{ border: '1px solid #234866', borderRadius: 8, fontSize: 11, background: '#091521', color: '#eaf7ff' }} />
                        <Area type="monotone" dataKey="value" stroke="#22d3ee" strokeWidth={2.5} fill="url(#cloudflareFill)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-[#7894a8]">No event activity available</div>
                  )}
                </div>
              </article>

              <article className="rounded-lg border border-[#17324d] bg-[#0b1828]">
                <div className="flex h-16 items-center border-b border-[#17324d] px-5"><div><h2 className="text-sm font-semibold text-[#eaf7ff] capitalize">{primaryCategoryField?.replace(/_/g, ' ') || 'Field'} distribution</h2><p className="mt-1 text-[10px] text-[#7894a8]">Categorical visualization</p></div></div>
                <div className="h-[264px] px-3 pb-3 pt-4">
                  {categoryData.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={categoryData} layout="vertical" margin={{ top: 5, right: 12, left: 2, bottom: 5 }}>
                        <CartesianGrid stroke="#17324d" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#7894a8', fontSize: 9 }} />
                        <YAxis type="category" dataKey="name" width={72} tickLine={false} axisLine={false} tick={{ fill: '#a8bfd0', fontSize: 9 }} />
                        <Tooltip contentStyle={{ border: '1px solid #234866', borderRadius: 8, fontSize: 11, background: '#091521', color: '#eaf7ff' }} />
                        <Bar dataKey="count" fill="#1687ff" radius={[0, 4, 4, 0]} barSize={12} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-[#7894a8]">No categorical field discovered</div>
                  )}
                </div>
              </article>
            </section>

            <section className="mt-4 overflow-hidden rounded-lg border border-[#17324d] bg-[#0b1828]">
              <div className="flex h-16 items-center justify-between border-b border-[#17324d] px-5">
                <div><h2 className="text-sm font-semibold text-[#eaf7ff]">Latest events</h2><p className="mt-1 text-[10px] text-[#7894a8]">{filtered.length} events shown</p></div>
                <div className="flex h-9 w-[220px] items-center gap-2 rounded-md border border-[#234866] bg-[#07111f] px-3 text-[#7894a8]">
                  <Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search event data" className="w-full border-0 bg-transparent text-xs text-[#eaf7ff] outline-none placeholder:text-[#5d7a90]" />
                </div>
              </div>
              <div className="overflow-x-auto">
                {filtered.length ? (
                  <table className="w-full text-left">
                    <thead className="bg-[#091521] text-[9px] font-bold uppercase tracking-[.08em] text-[#7894a8]">
                      <tr>
                        {discoveredFields.slice(0, 5).map((field) => (
                          <th key={field.key} className="px-5 py-3">{field.key.replace(/_/g, ' ')}</th>
                        ))}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((event) => {
                        const record = event as unknown as Record<string, unknown>
                        return (
                          <tr key={event.event_id || JSON.stringify(event)} onClick={() => setSelected(event)} className="cursor-pointer border-t border-[#17324d] hover:bg-[#10243b]">
                            {discoveredFields.slice(0, 5).map((field) => {
                              const value = record[field.key]
                              const display = typeof value === 'object'
                                ? JSON.stringify(value)
                                : field.key.includes('timestamp') && typeof value === 'string'
                                  ? timeLabel(value)
                                  : String(value ?? '—')
                              return (
                                <td key={field.key} className="max-w-[240px] px-5 py-4">
                                  <p className="truncate text-xs font-medium text-[#b9d7e9]">{display}</p>
                                </td>
                              )
                            })}
                            <td className="px-5 py-4 text-[#22d3ee]"><ExternalLink size={14} /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="grid h-32 place-items-center text-xs text-[#7894a8]">No events match this view</div>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {selected && (
        <button aria-label="Close event details" onClick={() => setSelected(null)} className="sr-only" />
      )}
    </main>
  )
}
