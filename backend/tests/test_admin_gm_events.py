import asyncio

import pytest
from fastapi import HTTPException

import admin_gm
import event_effects


class FakeConn:
    def __init__(self, configs):
        self.configs = configs

    async def fetch(self, _query):
        return [{"config": config} for config in self.configs]


def test_event_config_accepts_only_supported_numeric_multiplier():
    assert admin_gm._validated_event_config("double_xp", {"xp_multiplier": 2}) == {
        "xp_multiplier": 2.0,
    }

    for config in (
        {"xp_multiplier": "double"},
        {"xp_multiplier": 2, "coin_multiplier": 2},
        {"xp_multiplier": 100},
    ):
        with pytest.raises(HTTPException):
            admin_gm._validated_event_config("double_xp", config)

    with pytest.raises(HTTPException):
        admin_gm._validated_event_config("energy_boost", {"energy_regen_multiplier": 2})


def test_event_effects_ignore_invalid_legacy_multiplier_values():
    conn = FakeConn([{"xp_multiplier": "double"}, {"coin_multiplier": 2}])

    assert asyncio.run(event_effects.multiplier(conn, "xp_multiplier")) == 1.0
    assert asyncio.run(event_effects.multiplier(conn, "coin_multiplier")) == 2.0


def test_event_effects_do_not_stack_duplicate_multipliers():
    conn = FakeConn([{"xp_multiplier": 2}, {"xp_multiplier": 1.5}])

    assert asyncio.run(event_effects.multiplier(conn, "xp_multiplier")) == 2.0


def test_level_set_and_adjust_are_distinct_and_clamped():
    assert admin_gm._target_level(40, 2, "adjust") == 42
    assert admin_gm._target_level(40, -5, "adjust") == 35
    assert admin_gm._target_level(40, 2, "set") == 2
    assert admin_gm._target_level(99, 10, "adjust") == 100
    assert admin_gm._target_level(2, -10, "adjust") == 1


def test_admin_mutations_require_audit_reason():
    assert admin_gm._require_reason(" balance correction ") == "balance correction"
    with pytest.raises(HTTPException):
        admin_gm._require_reason("")


def test_audit_entry_decodes_json_fields():
    entry = admin_gm._audit_entry({
        "action": "patch_player",
        "before_data": '{"level": 4}',
        "after_data": '{"level": 5}',
        "metadata": '{"auth_method": "admin_key"}',
    })

    assert entry["before_data"]["level"] == 4
    assert entry["after_data"]["level"] == 5
    assert entry["metadata"]["auth_method"] == "admin_key"
