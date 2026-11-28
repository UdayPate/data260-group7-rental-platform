"""Calendar "today" is America/Los_Angeles (contract section 1); timestamps stay UTC."""
from datetime import date, datetime, timezone

from xenia_shared import timeutil


def test_today_local_is_the_pacific_date_in_the_evening(monkeypatch):
    # 6 pm Pacific (PST, UTC-8) on Nov 30 = 02:00 UTC on Dec 1
    monkeypatch.setattr(timeutil, "utc_now", lambda: datetime(2026, 12, 1, 2, 0, tzinfo=timezone.utc))
    assert timeutil.today_local() == date(2026, 11, 30)
    assert timeutil.seconds_until_local_midnight() == 6 * 3600   # until Dec 1 00:00 Pacific


def test_today_local_in_summer_time(monkeypatch):
    # 11 pm Pacific (PDT, UTC-7) on Jul 4 = 06:00 UTC on Jul 5
    monkeypatch.setattr(timeutil, "utc_now", lambda: datetime(2026, 7, 5, 6, 0, tzinfo=timezone.utc))
    assert timeutil.today_local() == date(2026, 7, 4)


def test_timestamps_stay_utc():
    assert timeutil.iso_seconds(datetime(2026, 12, 1, 2, 0, 5, tzinfo=timezone.utc)) == "2026-12-01T02:00:05Z"
