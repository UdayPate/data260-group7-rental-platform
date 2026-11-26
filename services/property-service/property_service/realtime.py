"""Live availability: the list of open sockets per property, and how a Kafka message reaches them.

Path (contract, spec 13.4):  Kafka topic availability.blocked / availability.released
                             -> a consumer thread in this service -> every socket open for that property_id.
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

log = logging.getLogger("xenia.property.realtime")


class SocketHub:
    def __init__(self) -> None:
        self._sockets: dict[str, dict[WebSocket, asyncio.AbstractEventLoop]] = defaultdict(dict)
        self._lock = threading.Lock()
        self.sent = 0

    def add(self, property_id: str, socket: WebSocket) -> None:
        with self._lock:  # remember the event loop each socket lives on (uvicorn has one; test clients have one per socket)
            self._sockets[property_id][socket] = asyncio.get_running_loop()

    def remove(self, property_id: str, socket: WebSocket) -> None:
        with self._lock:
            self._sockets.get(property_id, {}).pop(socket, None)
            if property_id in self._sockets and not self._sockets[property_id]:
                del self._sockets[property_id]

    def count(self, property_id: str) -> int:
        with self._lock:
            return len(self._sockets.get(property_id, ()))

    def broadcast(self, property_id: str, envelope: dict[str, Any]) -> int:
        """Called from a consumer thread. Sends the envelope to every socket open for the property."""
        with self._lock:
            targets = list(self._sockets.get(property_id, {}).items())
        text = json.dumps(envelope, separators=(",", ":"))

        async def send(socket: WebSocket) -> None:
            await socket.send_text(text)

        delivered = 0
        for socket, loop in targets:
            try:
                asyncio.run_coroutine_threadsafe(send(socket), loop).result(timeout=5)
                delivered += 1
                self.sent += 1
            except Exception as problem:  # noqa: BLE001  (a closed socket must not stop the others)
                log.info("dropping a dead socket for %s: %s", property_id, problem)
                self.remove(property_id, socket)
        return delivered


hub = SocketHub()
