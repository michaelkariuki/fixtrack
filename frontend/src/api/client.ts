import { z } from 'zod'

export async function apiRequest<S extends z.ZodType>(endpoint: string, schema: S, options: RequestInit = {}): Promise<z.output<S>> {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`/api${endpoint}`, { ...options, headers })
  const payload: unknown = await response.json().catch(() => null)
  if (response.status === 401) window.dispatchEvent(new Event('fixtrack:unauthorized'))
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(payload)
    throw new Error(error.success ? error.data.error : `Request failed (${response.status}). Check the API connection.`)
  }
  const result = schema.safeParse(payload)
  if (!result.success) throw new Error('The API returned an unexpected response. No data was saved to this view.')
  return result.data
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Something went wrong. Please try again.' }
export function formatKES(amount: number): string { return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(amount) }
export function dateLabel(timestamp: number): string { return new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(timestamp * 1000)) }
