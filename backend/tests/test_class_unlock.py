"""Class slot progression: 1 class from start, 2nd at level 10, 3rd at level 15."""
from progression import class_slots_for_level


def test_one_slot_before_level_10():
    assert class_slots_for_level(1) == 1
    assert class_slots_for_level(9) == 1


def test_second_slot_unlocks_at_level_10():
    assert class_slots_for_level(10) == 2
    assert class_slots_for_level(14) == 2


def test_third_slot_unlocks_at_level_15():
    assert class_slots_for_level(15) == 3
    assert class_slots_for_level(99) == 3
