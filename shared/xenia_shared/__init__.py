"""Code shared by every Xenia backend service (written once, imported everywhere).

    envelope  the Kafka message format (spec 6.2) and its validation
    kafka     publish() / run_consumer(): validation, idempotency, retries, dead letter, offsets
    auth      the JWT check: 401 vs 403, roles, "own id" rules
    errors    the { "error": { code, message, details } } response format
    app       create_app(): FastAPI with CORS, the error handlers and /health
    db        MySQL connection pool, transactions, id generation
    trace     emit_step(): journey steps for the dashboard (spec 8)
    config    reading settings from environment variables
"""
