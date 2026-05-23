import { getSuggestions } from '../data/suggestions'

let backendAvailable = null // null = не проверяли, true/false = результат проверки

export async function fetchSuggestions(query, limit = 7) {
  if (!query || query.length < 2) return []

  // Если бэкенд уже проверен и недоступен — сразу локально
  if (backendAvailable === false) {
    return getSuggestions(query, limit)
  }

  try {
    const res = await fetch(`/api/suggest?q=${encodeURIComponent(query)}&limit=${limit}`, {
      signal: AbortSignal.timeout(800), // не ждём больше 800ms
    })
    if (!res.ok) throw new Error('not ok')
    const data = await res.json()
    backendAvailable = true
    return Array.isArray(data) ? data : data.suggestions ?? []
  } catch {
    backendAvailable = false
    return getSuggestions(query, limit)
  }
}
