"""Top-level pytest settings for the whole repo: environment for tests, and the shared fixtures."""
import os

# Set BEFORE any service module is imported (they read these settings when they start).
os.environ.setdefault("JWT_SECRET", "test-secret-for-automated-tests-only-0123456789")
os.environ.setdefault("KAFKA_TRANSPORT", "memory")      # an in-memory Kafka: no Docker needed for unit tests
os.environ.setdefault("RETRY_BACKOFF_SCALE", "0")       # retries do not wait during tests
os.environ.setdefault("SEARCH_CACHE", "off")
os.environ.setdefault("RUN_CONSUMERS", "off")       # tests drive the consumers by hand

pytest_plugins = ["xenia_shared.pytest_plugin"]
