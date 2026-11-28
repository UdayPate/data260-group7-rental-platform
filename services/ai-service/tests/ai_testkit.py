"""Helpers for the AI service tests (imported by conftest.py and the test files)."""
from __future__ import annotations

import time
from typing import Any

from fastapi.testclient import TestClient

from xenia_shared.auth import sign_token

SPEC_REQUEST = "2 nights in San Jose for 2, under $250, parking, kitchen, rating ≥ 4.5"
NAMES = {"g_001": "Alex Chen", "g_002": "Sam Rivera", "g_003": "Emily Novak", "adm_001": "Platform Admin"}


def token(user_id: str, role: str = "guest") -> dict[str, str]:
    return {"Authorization": f"Bearer {sign_token(user_id, role, NAMES.get(user_id, user_id))}"}


class AiHarness:
    def __init__(self, client: TestClient):
        self.client = client

    def ask(self, guest: str = "g_001", text: str = SPEC_REQUEST, **extra: Any) -> dict[str, Any]:
        r = self.client.post("/ai/requests", json={"guest_id": guest, "request_text": text, **extra}, headers=token(guest))
        assert r.status_code == 202, r.text
        return r.json()

    def wait(self, task_id: str, guest: str = "g_001", until=("waiting_for_approval", "completed", "failed", "timed_out"), seconds: float = 40) -> dict[str, Any]:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            body = self.client.get(f"/ai/tasks/{task_id}", headers=token(guest)).json()
            if body["task"]["status"] in until:
                return body
            time.sleep(0.1)
        raise AssertionError(f"{task_id} did not finish: {body['task']['status']}")

    def result(self, task_id: str, guest: str = "g_001") -> dict[str, Any]:
        r = self.client.get(f"/ai/results/{task_id}", headers=token(guest))
        assert r.status_code == 200, r.text
        return r.json()
