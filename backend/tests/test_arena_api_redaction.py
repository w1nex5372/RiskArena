import pytest

from arena_view import redact_match_for_user


def test_current_open_round_hides_enemy_action():
    match = {
        "id": "m1",
        "status": "active",
        "round_number": 2,
        "player_one_id": "p1",
        "player_two_id": "p2",
        "player_one_class_name": "warrior",
        "player_two_class_name": "rogue",
        "rounds": [
            {"round_number": 1, "status": "resolved"},
            {"round_number": 2, "status": "open"},
        ],
        "actions": [
            {"round_number": 1, "user_id": "p1", "action": "attack"},
            {"round_number": 1, "user_id": "p2", "action": "defend"},
            {"round_number": 2, "user_id": "p1", "action": "risk"},
            {"round_number": 2, "user_id": "p2", "action": "ability"},
        ],
    }

    redacted = redact_match_for_user(match, "p1")

    assert redacted["actions"] == [
        {"round_number": 1, "user_id": "p1", "action": "attack"},
        {"round_number": 1, "user_id": "p2", "action": "defend"},
        {"round_number": 2, "user_id": "p1", "action": "risk"},
    ]
    assert redacted["player_one_class_name"] == "warrior"
    assert redacted["player_two_class_name"] == "rogue"


def test_non_participant_cannot_read_match_view():
    with pytest.raises(PermissionError):
        redact_match_for_user(
            {
                "player_one_id": "p1",
                "player_two_id": "p2",
                "rounds": [],
                "actions": [],
            },
            "p3",
        )
