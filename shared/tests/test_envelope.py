"""Spec 12: automated tests for envelope validation."""
import copy

import pytest

from xenia_shared.envelope import EnvelopeError, make_envelope, validate
from xenia_shared.kafka import publish


def good():
    return make_envelope("booking.requested", "t-1", "g_001", "reservation", "r_065", {"x": 1}, "k-1")


def test_a_valid_envelope_passes():
    assert validate(good())["event_type"] == "booking.requested"


@pytest.mark.parametrize("field", ["event_type", "trace_id", "timestamp", "actor_id", "entity", "payload", "idempotency_key"])
def test_each_missing_field_is_rejected(field):
    bad = good()
    del bad[field]
    with pytest.raises(EnvelopeError) as error:
        validate(bad)
    assert field in error.value.invalid_fields


def test_unknown_event_type_is_rejected():
    bad = good()
    bad["event_type"] = "booking.teleported"
    with pytest.raises(EnvelopeError):
        validate(bad)


@pytest.mark.parametrize("stamp", ["yesterday", "2026-11-23T18:05:09", "2026-11-23T18:05:09+02:00", 12345])
def test_timestamp_must_be_iso_utc(stamp):
    bad = good()
    bad["timestamp"] = stamp
    with pytest.raises(EnvelopeError):
        validate(bad)


def test_payload_must_be_an_object_and_entity_complete():
    bad = good()
    bad["payload"] = ["not", "an", "object"]
    with pytest.raises(EnvelopeError):
        validate(bad)
    bad = good()
    bad["entity"] = {"entity_type": "reservation"}
    with pytest.raises(EnvelopeError):
        validate(bad)


def test_blank_idempotency_key_is_rejected():
    bad = good()
    bad["idempotency_key"] = "  "
    with pytest.raises(EnvelopeError):
        validate(bad)


def test_extra_fields_such_as_seq_are_allowed():
    ok = good()
    ok["seq"] = 3
    validate(ok)


def test_not_an_object_is_rejected():
    with pytest.raises(EnvelopeError):
        validate("hello")


def test_publish_validates_before_sending(kafka):
    bad = copy.deepcopy(good())
    del bad["trace_id"]
    with pytest.raises(EnvelopeError):
        publish("booking.requested", bad)
    assert kafka.messages("booking.requested") == []  # nothing was sent
    publish("booking.requested", good())
    assert len(kafka.messages("booking.requested")) == 1
