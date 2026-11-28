"""How the agents talk: which Kafka topic carries what, who reads it, and the one publish() helper.

Every message is the shared envelope (spec 6.2), with
    key            = trace_id   on EVERY AI topic, so one debate stays in order on one partition (spec 13.11)
    trace_id       = the task's trace_id, copied from the message being answered
    entity         = { entity_type: "ai_task", entity_id: task_id }
    payload        = the contract's payload for that event type (section 6.3), plus, on the chair's
                     instructions, a "context" object with what the agent needs (requirements,
                     candidate ids, weights...). The chair strips "context" before saving the event.

    topic            event_type              from -> to
    ---------------  ----------------------  ------------------------------------------------------
    ai.requests      ai.requests             API -> chair                     a new request
                     plan.step_updated (s1)  chair -> parser                  "read the requirements"
                     requirements.parsed     parser -> chair
                     round.started (0)       chair -> matcher, risk, fairness  (also a retry after a rejected output)
    debate.round.0   opinion.published       matcher / risk / fairness -> chair ONLY
                                             (agents never read this topic: round 0 is independent, spec 7.2)
    debate.round.1   challenge.issued        chair -> the challenged agent
                     round.started (2)       chair -> agents: "answer your challenges and vote"
    debate.round.2   challenge.answered      agent -> chair
                     vote.cast               agent -> chair
    ai.results       plan.step_updated (s7)  chair -> explanation: "write the rationale" (with the measured draft)
                     result.published        explanation -> chair (rationale only), then chair -> everyone (final)
                     decision.recorded       API -> chair                     the guest's approve / edit / reject

Agents are stateless consumers in their own consumer groups (agent-parser, agent-matcher, ...).
Nobody calls anybody over HTTP (spec 7.2 "Direct agent-to-agent HTTP calls are not permitted").
"""
from __future__ import annotations

from typing import Any

from xenia_shared.envelope import make_envelope
from xenia_shared.kafka import publish as kafka_publish

SERVICE = "ai-service"

ANALYSIS_AGENTS = ("matcher", "risk", "fairness")
AGENTS = ("parser", "matcher", "risk", "fairness", "explanation", "chair")

# Consumer groups (one per agent kind; start more copies with the same group to scale).
GROUPS = {
    "chair": "ai-chair",
    "parser": "agent-parser",
    "matcher": "agent-matcher",
    "risk": "agent-risk",
    "fairness": "agent-fairness",
    "explanation": "agent-explanation",
}

# What each one subscribes to (see the table above).
SUBSCRIPTIONS = {
    "chair": ["ai.requests", "debate.round.0", "debate.round.2", "ai.results"],
    "parser": ["ai.requests"],
    "matcher": ["ai.requests", "debate.round.1"],
    "risk": ["ai.requests", "debate.round.1"],
    "fairness": ["ai.requests", "debate.round.1"],
    "explanation": ["ai.results"],
}


def send(topic: str, event_type: str, task_id: str, trace_id: str, actor: str, payload: dict[str, Any], key_suffix: str) -> dict[str, Any]:
    """Publish one AI message. key = trace_id (always). idempotency_key is stable for the same
    logical message (task + who + what), so a redelivery is recognised and skipped."""
    envelope = make_envelope(
        event_type, trace_id, actor, "ai_task", task_id, payload, idempotency_key=f"{task_id}:{actor}:{event_type}:{key_suffix}"
    )
    kafka_publish(topic, envelope, key=trace_id)
    return envelope


def task_of(envelope: dict[str, Any]) -> str:
    return envelope["entity"]["entity_id"]
