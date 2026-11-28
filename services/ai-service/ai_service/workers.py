"""Start the agent processes. One process per agent, each its own Kafka consumer group:

    python -m ai_service.workers chair
    python -m ai_service.workers parser
    python -m ai_service.workers matcher
    python -m ai_service.workers risk
    python -m ai_service.workers fairness
    python -m ai_service.workers explanation

    python -m ai_service.workers all     (development only: all six as threads in ONE process; with
                                          KAFKA_TRANSPORT=memory this is the only way they can talk)

Run more copies of the same agent to scale: Kafka shares the partitions between them (spec 13.11).
"""
from __future__ import annotations

import logging
import sys
import threading
from typing import Any, Callable

from xenia_shared.config import load_env
from xenia_shared.kafka import run_consumer, start_consumer_thread

from . import explanation_agent, fairness_agent, matcher_agent, parser_agent, protocol, risk_agent, store, versions
from .chair import chair

HANDLERS: dict[str, Callable[[dict[str, Any], Any], Any]] = {
    "chair": chair.handle,
    "parser": parser_agent.handle,
    "matcher": matcher_agent.handle,
    "risk": risk_agent.handle,
    "fairness": fairness_agent.handle,
    "explanation": explanation_agent.handle,
}


def start_in_threads(names: list[str] | None = None) -> list[tuple[threading.Thread, threading.Event]]:
    """Every agent as a background consumer thread (dev and tests). Returns (thread, stop) pairs."""
    started = []
    for name in names or list(HANDLERS):
        started.append(start_consumer_thread(protocol.SUBSCRIPTIONS[name], protocol.GROUPS[name], HANDLERS[name], f"agent-{name}", poll_seconds=0.1))
        if name == "chair":
            stop = threading.Event()
            thread = threading.Thread(target=chair.run_sweeper, args=(stop,), name="chair-sweeper", daemon=True)
            thread.start()
            started.append((thread, stop))
    return started


def main(argv: list[str]) -> None:
    load_env()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    name = argv[1] if len(argv) > 1 else ""
    if name not in HANDLERS and name != "all":
        sys.exit(f"usage: python -m ai_service.workers {{{'|'.join(HANDLERS)}|all}}")
    store.ensure_indexes()
    versions.ensure_seeded()
    if name == "all":
        for thread, _stop in start_in_threads():
            pass
        threading.Event().wait()  # run until Ctrl+C
    if name == "chair":
        threading.Thread(target=chair.run_sweeper, args=(threading.Event(),), name="chair-sweeper", daemon=True).start()
    run_consumer(protocol.SUBSCRIPTIONS[name], protocol.GROUPS[name], HANDLERS[name], f"agent-{name}", poll_seconds=0.2)


if __name__ == "__main__":
    main(sys.argv)
