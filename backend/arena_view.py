from typing import Dict


def redact_match_for_user(match: Dict, user_id: str) -> Dict:
    if user_id not in (match.get("player_one_id"), match.get("player_two_id")):
        raise PermissionError("User is not a participant in this arena match")

    current_round = match.get("round_number")
    rounds_by_number = {r.get("round_number"): r for r in match.get("rounds", [])}
    current_round_row = rounds_by_number.get(current_round) or {}
    current_round_open = match.get("status") == "active" and current_round_row.get("status") == "open"

    redacted = dict(match)
    redacted_actions = []
    for action in match.get("actions", []):
        action_round = action.get("round_number")
        is_current_unresolved = current_round_open and action_round == current_round
        if is_current_unresolved and action.get("user_id") != user_id:
            continue
        redacted_actions.append(action)
    redacted["actions"] = redacted_actions
    redacted["viewer_user_id"] = user_id
    return redacted
