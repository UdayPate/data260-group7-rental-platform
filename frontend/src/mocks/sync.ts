// Shares the mock data between browser windows of this site (team decisions S1a, S2a).
//
// Each window runs its own mock server with its own in-memory data. So that the admin's
// window sees what a guest did in another window, the windows talk over a BroadcastChannel:
//
//  1. After every mocked request, this window compares its data with what it last shared
//     and broadcasts only the records that were added, changed or deleted.
//  2. AI debates are shared whole (task, events, result) every time one changes.
//  3. A window that opens later says "hello"; an open window answers with a snapshot of
//     everything, and the new window waits up to SNAPSHOT_WAIT_MS before answering its
//     first request, so it starts from the current state.
//
// Nothing is stored: closing every window resets the demo to the seed data (S2a).
// The real backend doesn't need any of this: there, all users share one database.
import { localTaskEntries, setTaskChangeListener, storeOtherWindowEntry, type TaskEntry } from './ai/bus'
import { state as versionState } from './ai/versions'
import { db } from './db'

const SNAPSHOT_WAIT_MS = 500

type Row = Record<string, unknown>

// Every list in db, with what makes a record unique in it.
const LISTS: Record<string, (x: Row) => string> = {
  accounts: (x) => String(x.user_id),
  hosts: (x) => String(x.host_id),
  guests: (x) => String(x.guest_id),
  properties: (x) => String(x.property_id),
  reservations: (x) => String(x.reservation_id),
  availability: (x) => String(x.availability_id),
  saved: (x) => `${String(x.guest_id)}|${String(x.property_id)}`,
  reviews: (x) => String(x.review_id),
  threads: (x) => String(x.thread_id),
  messages: (x) => String(x.message_id),
  uiEvents: (x) => String(x.idempotency_key),
  rejectedEnvelopes: (x) => `${String(x.trace_id)}|${String(x.timestamp)}|${String(x.reason)}`,
}
// Key -> value lookups in db (Maps), and one Set.
const MAPS = ['idempotencyKeys', 'messageKeys', 'bookingBlockIds'] as const
// Typed views of db for this file: its lists, its Maps, and the ingestKeys Set.
const lists = db as unknown as Record<string, Row[]>
const maps = db as unknown as Record<string, Map<string, string>>
const ingestKeys = () => db.ingestKeys

// One change to one list: records to add or replace, and keys to remove.
type ListOps = { upserts: Row[]; deletes: string[] }
type Message =
  | { type: 'hello'; from: string }
  | { type: 'snapshot'; to: string; lists: Record<string, Row[]>; maps: Record<string, [string, string][]>; ingestKeys: string[]; versions: typeof versionState; tasks: TaskEntry[] }
  | { type: 'ops'; lists: Record<string, ListOps>; maps: Record<string, [string, string][]>; ingestKeys: string[]; versions: typeof versionState | null }
  | { type: 'task'; entry: TaskEntry }

const windowId = typeof crypto !== 'undefined' ? crypto.randomUUID() : 'node'
const channel = typeof window === 'undefined' ? null : new BroadcastChannel('cedar-rye-mock-sync')

// What this window last shared (or received), as JSON per record, to find what changed.
const lastSeen = new Map<string, Map<string, string>>()
let lastMaps = new Map<string, string>() // "<map>|<key>" -> value
let lastVersions = ''

function remember() {
  for (const [name, keyOf] of Object.entries(LISTS)) {
    lastSeen.set(name, new Map(lists[name].map((x) => [keyOf(x), JSON.stringify(x)])))
  }
  lastMaps = new Map(MAPS.flatMap((m) => [...maps[m].entries()].map(([k, v]) => [`${m}|${k}`, v] as [string, string])))
  for (const k of ingestKeys()) lastMaps.set(`ingestKeys|${k}`, '1')
  lastVersions = JSON.stringify(versionState)
}

// Called after every mocked request: broadcast what changed since last time.
export function shareChanges() {
  if (!channel) return
  const changed: Record<string, ListOps> = {}
  for (const [name, keyOf] of Object.entries(LISTS)) {
    const before = lastSeen.get(name) ?? new Map<string, string>()
    const now = new Map(lists[name].map((x) => [keyOf(x), JSON.stringify(x)]))
    const upserts = [...now].filter(([k, json]) => before.get(k) !== json).map(([, json]) => JSON.parse(json) as Row)
    const deletes = [...before.keys()].filter((k) => !now.has(k))
    if (upserts.length > 0 || deletes.length > 0) changed[name] = { upserts, deletes }
  }
  const changedMaps: Record<string, [string, string][]> = {}
  for (const m of MAPS) {
    const added = [...maps[m].entries()].filter(([k, v]) => lastMaps.get(`${m}|${k}`) !== v)
    if (added.length > 0) changedMaps[m] = added
  }
  const newIngestKeys = [...ingestKeys()].filter((k) => !lastMaps.has(`ingestKeys|${k}`))
  const versionsJson = JSON.stringify(versionState)
  const versions = versionsJson !== lastVersions ? versionState : null

  if (Object.keys(changed).length === 0 && Object.keys(changedMaps).length === 0 && newIngestKeys.length === 0 && !versions) return
  remember()
  channel.postMessage({ type: 'ops', lists: changed, maps: changedMaps, ingestKeys: newIngestKeys, versions } satisfies Message)
}

// Apply another window's changes in place (other code keeps references to these lists).
function applyOps(msg: Extract<Message, { type: 'ops' }>) {
  for (const [name, ops] of Object.entries(msg.lists)) {
    const list = lists[name]
    const keyOf = LISTS[name]
    for (const row of ops.upserts) {
      const i = list.findIndex((x) => keyOf(x) === keyOf(row))
      if (i === -1) list.push(row)
      else list[i] = row
    }
    for (const key of ops.deletes) {
      const i = list.findIndex((x) => keyOf(x) === key)
      if (i !== -1) list.splice(i, 1)
    }
  }
  for (const [m, entries] of Object.entries(msg.maps)) for (const [k, v] of entries) maps[m].set(k, v)
  for (const k of msg.ingestKeys) ingestKeys().add(k)
  if (msg.versions) Object.assign(versionState, structuredClone(msg.versions))
  remember()
}

// A newer window adopts the snapshot of an open one.
function applySnapshot(msg: Extract<Message, { type: 'snapshot' }>) {
  for (const [name, rows] of Object.entries(msg.lists)) lists[name].splice(0, lists[name].length, ...rows)
  for (const m of MAPS) {
    maps[m].clear()
    for (const [k, v] of msg.maps[m] ?? []) maps[m].set(k, v)
  }
  ingestKeys().clear()
  for (const k of msg.ingestKeys) ingestKeys().add(k)
  Object.assign(versionState, structuredClone(msg.versions))
  for (const entry of msg.tasks) storeOtherWindowEntry(entry)
  remember()
}

function snapshot(to: string): Message {
  return {
    type: 'snapshot',
    to,
    lists: Object.fromEntries(Object.keys(LISTS).map((name) => [name, lists[name]])),
    maps: Object.fromEntries(MAPS.map((m) => [m, [...maps[m].entries()]])),
    ingestKeys: [...ingestKeys()],
    versions: versionState,
    tasks: localTaskEntries(),
  }
}

// Resolves once this window has the current state (or nobody answered in time).
let markReady: () => void = () => {}
export const syncReady: Promise<void> = new Promise((resolve) => {
  markReady = resolve
  if (!channel) resolve()
  else setTimeout(resolve, SNAPSHOT_WAIT_MS)
})

if (channel) {
  remember()
  let gotSnapshot = false
  channel.onmessage = (event: MessageEvent<Message>) => {
    const msg = event.data
    if (msg.type === 'hello') channel.postMessage(snapshot(msg.from))
    if (msg.type === 'snapshot' && msg.to === windowId && !gotSnapshot) {
      gotSnapshot = true
      applySnapshot(msg)
      markReady()
    }
    if (msg.type === 'ops') applyOps(msg)
    if (msg.type === 'task') storeOtherWindowEntry(msg.entry)
  }
  // Every change to one of this window's debates goes to the other windows.
  setTaskChangeListener((entry) => channel.postMessage({ type: 'task', entry } satisfies Message))
  channel.postMessage({ type: 'hello', from: windowId } satisfies Message)
}
