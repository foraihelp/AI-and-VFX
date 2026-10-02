import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import type { Sources } from '../../shared/types'

type Raw = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export function parseSources(text: string): Sources {
  const data = (yaml.load(text) ?? {}) as Raw
  const software = ((data.software ?? []) as Raw[]).map((s) => {
    if (!s.id || !s.name) throw new Error("Every software entry needs 'id' and 'name'")
    return {
      id: String(s.id),
      name: String(s.name),
      strong: (s.strong ?? []).map(String),
      weak: (s.weak ?? []).map(String),
      context: (s.context ?? []).map(String),
      exclude: (s.exclude ?? []).map(String),
      enabled: s.enabled !== false
    }
  })
  const ids = new Set(software.map((s) => s.id))
  const on = (list: Raw[] | undefined): Raw[] => (list ?? []).filter((x) => x.enabled !== false)
  const channels = on(data.channels)
  const searches = on(data.searches)
  const feeds = on(data.feeds)
  for (const e of [...channels, ...searches, ...feeds]) {
    for (const id of (e.software ?? []) as string[]) {
      if (!ids.has(id)) throw new Error(`Source '${e.name ?? e.query}' refers to unknown software id '${id}'`)
    }
  }
  return {
    software: software.filter((s) => s.enabled),
    channels,
    searches,
    feeds,
    excludeTitleTerms: (data.exclude_title_terms ?? []).map(String),
    typeRules: Object.fromEntries(
      Object.entries((data.type_rules ?? {}) as Raw).map(([k, v]) => [k, (v as unknown[]).map(String)])
    )
  }
}

export function loadSources(path: string): Sources {
  return parseSources(readFileSync(path, 'utf-8'))
}
