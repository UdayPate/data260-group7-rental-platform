"""Token helper for these tests."""
from xenia_shared.auth import sign_token

NAMES = {"g_001": "Alex Chen", "g_002": "Sam Rivera", "g_012": "Ravi Iyer", "h_001": "Maya Ortiz", "h_003": "Rob Feeney"}


def auth(user_id: str) -> dict[str, str]:
    role = "host" if user_id.startswith("h_") else "guest"
    return {"Authorization": f"Bearer {sign_token(user_id, role, NAMES.get(user_id, user_id))}"}
