// MongoDB setup (spec 3.2): collections and indexes for the flexible documents.
// Runs once, the first time the Mongo container starts on an empty volume (mongosh runs *.js files in
// /docker-entrypoint-initdb.d). Re-run by hand:
//   docker compose exec -T mongo mongosh xenia < infra/mongo/init.js
//
// WHY MongoDB for these: a review, a chat message, an AI debate event or a trace step is a
// self-contained document whose shape varies (a debate event's payload is different for every
// event type). They are written once and read as a group by thread, property, task or trace_id,
// and they never need a multi-table transaction. The transactional tables stay in MySQL.
//
// Owners: Himja (reviews, messages, ai_*), Rohini and Shashank (events, trace_steps, dead_letters).
// The indexes below are a starting point: add to them from your own service.
const database = db.getSiblingDB('xenia')

function ensure(name, indexes) {
  if (!database.getCollectionNames().includes(name)) database.createCollection(name)
  indexes.forEach(([keys, options]) => database[name].createIndex(keys, options || {}))
}

// Review Service
ensure('reviews', [
  [{ review_id: 1 }, { unique: true }],
  [{ reservation_id: 1 }, { unique: true }],            // one review per reservation
  [{ property_id: 1, created_datetime: -1 }],            // newest first on a property page
  [{ guest_id: 1, created_datetime: -1 }],
])

// Messaging Service
ensure('threads', [
  [{ thread_id: 1 }, { unique: true }],
  [{ guest_id: 1, host_id: 1, property_id: 1 }, { unique: true }],   // one thread per guest + host + listing
])
ensure('messages', [
  [{ message_id: 1 }, { unique: true }],
  [{ thread_id: 1, timestamp: 1 }],
  [{ idempotency_key: 1 }, { unique: true, sparse: true }],
])

// AI Agent Service: tasks, every debate event (in seq order), human feedback, matcher versions
ensure('ai_tasks', [
  [{ task_id: 1 }, { unique: true }],
  [{ trace_id: 1 }],
  [{ guest_id: 1, created_datetime: -1 }],
])
ensure('ai_events', [
  [{ task_id: 1, seq: 1 }, { unique: true }],
  [{ trace_id: 1, timestamp: 1 }],
  [{ idempotency_key: 1 }, { unique: true }],
])
ensure('ai_feedback', [[{ feedback_id: 1 }, { unique: true }], [{ trace_id: 1 }]])
ensure('ai_versions', [[{ version_id: 1 }, { unique: true }]])

// Analytics and logging: ingested events, journey steps, dead letters
ensure('events', [
  [{ idempotency_key: 1 }, { unique: true }],            // the same event twice is stored once
  [{ trace_id: 1, timestamp: 1 }],
  [{ event_type: 1, timestamp: -1 }],
])
ensure('trace_steps', [
  [{ trace_id: 1, timestamp: 1 }],
  [{ service: 1, timestamp: -1 }],
  [{ status: 1 }],
])
ensure('dead_letters', [
  [{ trace_id: 1 }],
  [{ timestamp: -1 }],
])

print('xenia MongoDB collections ready: ' + database.getCollectionNames().join(', '))
