"""Unit tests of the measured rules: parser, Matcher formula, disagreement, harness checks, decision rule."""
from __future__ import annotations

import pytest

from ai_service import harness, scoring
from ai_service.listings import load_snapshot

from ai_testkit import SPEC_REQUEST

CITIES = ["Mountain View", "San Jose", "Sunnyvale"]


def test_parser_reads_the_spec_request():
    req = scoring.parse_request(SPEC_REQUEST, CITIES)
    assert req["location"] == "San Jose"
    assert req["guest_count"] == 2
    assert req["max_nightly_price"] == 250
    assert req["min_rating"] == 4.5
    assert req["amenities"] == ["parking", "kitchen"]
    assert req["property_types"] == []
    assert req["dates_assumed"] is True
    assert scoring.nights_between(req["check_in"], req["check_out"]) == 2


def test_parser_explicit_dates_unknown_city_and_word_numbers():
    req = scoring.parse_request("three nights in Fresno for two, 2027-01-10 to 2027-01-13, a house with a pool", CITIES)
    assert req["location"] == "Fresno"  # not one of our cities: the pool will be empty (travel-coach suggestions)
    assert (req["check_in"], req["check_out"], req["dates_assumed"]) == ("2027-01-10", "2027-01-13", False)
    assert req["guest_count"] == 2
    assert req["property_types"] == ["house"]
    assert req["amenities"] == ["pool"]


def test_weighted_score_formula_and_round2_like_javascript():
    parts = {"amenity_fit": 1, "price": 0.5, "rating": 0.8, "risk_penalty": 1, "review_count": 0.5}
    w = {"amenity_fit": 0.6, "price": 0.35, "rating": 0.1, "risk_penalty": 0.4, "review_count": 0.1}
    expected = (0.6 * 1 + 0.35 * 0.5 + 0.1 * 0.8 + 0.1 * 0.5 - 0.4 * 1) / 1.55
    assert scoring.weighted_score(parts, w) == pytest.approx(expected)
    assert scoring.weighted_score(parts, {k: 0 for k in w}) == 0
    assert scoring.round2(0.125) == 0.13  # Python's round() would give 0.12


def test_matcher_and_risk_disagree_on_the_seed_data(database):
    snap = load_snapshot()
    req = scoring.parse_request(SPEC_REQUEST, snap.cities())
    pool = scoring.candidate_pool(snap, req)
    matcher = scoring.rank_matcher(snap, pool, req, {"amenity_fit": 0.6, "price": 0.35, "rating": 0.1, "risk_penalty": 0, "review_count": 0.1})
    risk = scoring.rank_by([scoring.risk_score(snap, p, req) for p in pool])
    assert matcher[0]["p"]["title"] == "Budget Studio near SJSU"
    assert risk[0]["p"]["title"] == "Willow Glen Craftsman Cottage"
    assert scoring.risk_flags(snap, matcher[0]["p"])[0].startswith("host cancelled 2 stay(s)")
    # The contract's demo search (no dates): exactly these meet guests, budget, rating and both amenities.
    undated = {**req, "check_in": None, "check_out": None}
    meets = sorted(p["property_id"] for p in pool if not scoring.fit_of(snap, p, undated)["failed"])
    assert meets == ["p_001", "p_002", "p_003", "p_005", "p_008", "p_011"]


def test_risk_penalty_weight_moves_the_matchers_first_choice(database):
    snap = load_snapshot()
    req = scoring.parse_request(SPEC_REQUEST, snap.cities())
    pool = scoring.candidate_pool(snap, req)
    rerun = scoring.rank_matcher(snap, pool, req, {"amenity_fit": 0.6, "price": 0.35, "rating": 0.1, "risk_penalty": 0.4, "review_count": 0.1})
    assert rerun[0]["p"]["title"] == "Willow Glen Craftsman Cottage"


def opinion(**overrides):
    base = {"round": 0, "ranked": [{"property_id": "p_001", "title": "Willow", "score": 0.7, "reasons": ["x"]}], "confidence": 0.6, "reasoning": "because"}
    return {**base, **overrides}


@pytest.mark.parametrize(
    "payload, field",
    [
        (opinion(ranked=[{"property_id": "p_999", "title": "x", "score": 0.5, "reasons": []}]), "ranked[0].property_id"),
        (opinion(ranked=[{"property_id": "p_001", "title": "x", "score": 1.7, "reasons": []}]), "ranked[0].score"),
        (opinion(ranked=[{"property_id": "p_001", "title": "x", "score": -0.1, "reasons": []}]), "ranked[0].score"),
        (opinion(confidence=2), "confidence"),
        (opinion(ranked=[]), "ranked"),
        ({k: v for k, v in opinion().items() if k != "reasoning"}, "reasoning"),
        (opinion(ranked=[{"property_id": "p_001", "title": "x", "score": "high", "reasons": []}]), "ranked[0].score"),
        (opinion(round=1), "round"),
    ],
)
def test_harness_rejects_each_invalid_field(payload, field):
    clean, reason, fields = harness.check_opinion(payload, {"p_001", "p_002"})
    assert clean is None and reason
    assert field in fields


def test_harness_accepts_a_valid_opinion_and_rejects_a_wrong_trace():
    clean, reason, _ = harness.check_opinion(opinion(), {"p_001"})
    assert reason is None and clean["ranked"][0]["property_id"] == "p_001"
    assert harness.check_trace({"trace_id": "other"}, {"trace_id": "mine"})
    assert harness.check_trace({"trace_id": "mine"}, {"trace_id": "mine"}) is None


def test_vote_needs_a_reason_and_a_known_listing():
    assert harness.check_vote({"round": 2, "vote": "keep", "property_id": "p_001", "reason": ""}, {"p_001"})[0] is None
    assert harness.check_vote({"round": 2, "vote": "keep", "property_id": "p_404", "reason": "ok"}, {"p_001"})[0] is None
    assert harness.check_vote({"round": 2, "vote": "abstain", "property_id": None, "reason": "unsure"}, {"p_001"})[0] is not None


def test_explanation_must_name_the_recommended_listing():
    good = {"result": {"rationale": "Willow Glen Craftsman Cottage is the best fit for your stay.", "dissent_note": None}}
    bad = {"result": {"rationale": "The Grand Palace Hotel is lovely and has a spa for you.", "dissent_note": None}}
    assert harness.check_explanation(good, "Willow Glen Craftsman Cottage")[0] is not None
    assert harness.check_explanation(bad, "Willow Glen Craftsman Cottage")[0] is None


def test_disagreement_formula():
    def score(picks):
        from collections import Counter

        return scoring.round2(1 - max(Counter(picks).values()) / len(picks))

    assert score(["p_1", "p_1", "p_1"]) == 0
    assert score(["p_1", "p_2", "p_1"]) == 0.33
    assert score(["p_1", "p_2", "p_3"]) == 0.67
