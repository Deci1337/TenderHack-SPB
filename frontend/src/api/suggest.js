export async function fetchSuggestions(query, limit = 5) {
  if (!query || query.length < 2) return []

  try {
    const res = await fetch(`/api/suggest?q=${encodeURIComponent(query)}&limit=${limit}`, {
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : data.suggestions ?? []
  } catch {
    return []
  }
}
