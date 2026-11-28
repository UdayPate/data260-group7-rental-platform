"""A trailing comment on a .env line must not become part of the value (it once switched the search cache off)."""
import os

from xenia_shared.config import env_flag, load_env


def test_trailing_comment_is_dropped(tmp_path, monkeypatch):
    for name in ("XT_FLAG", "XT_QUOTED", "XT_URL"):
        monkeypatch.delenv(name, raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text('XT_FLAG=on     # on | off : the cache\nXT_QUOTED="a #b"\nXT_URL=http://h/#frag\n')
    load_env(env_file)
    assert os.environ["XT_FLAG"] == "on" and env_flag("XT_FLAG") is True
    assert os.environ["XT_QUOTED"] == "a #b"
    assert os.environ["XT_URL"] == "http://h/#frag"
