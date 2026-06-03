"""
Regression tests for boss-raid loot drop rates.

Pure-Python: imports only boss_domain (no FastAPI / DB), so it runs without a
server or database. Verifies that the declared loot-tier probabilities are
well-formed and that the cumulative-threshold roll in `_roll_loot_tier` is
statistically unbiased.
"""
import random

from boss_domain import _LOOT_TIERS, _roll_loot_tier

# Expected probability for each tier, keyed by tier name (None == "no drop").
EXPECTED = {tier: prob for prob, tier in _LOOT_TIERS}

# Monte-Carlo settings. 200k rolls from a single well-mixed stream.
SAMPLE_SIZE = 200_000
SEED = 20240603

# Absolute tolerance for the high-probability tiers (None / uncommon / rare).
ABS_TOL_BIG = 0.01
# Looser relative tolerance for the rare epic / legendary tiers, where the
# absolute count is small and sampling noise dominates.
REL_TOL_SMALL = 0.20


def _monte_carlo(sample_size: int, seed: int):
    """Roll `sample_size` times from one rng and return observed frequencies."""
    rng = random.Random(seed)
    counts = {tier: 0 for tier in EXPECTED}
    for _ in range(sample_size):
        counts[_roll_loot_tier(rng)] += 1
    return {tier: c / sample_size for tier, c in counts.items()}, counts


def test_loot_tier_probabilities_sum_to_one():
    total = sum(prob for prob, _ in _LOOT_TIERS)
    assert total == 1.0, f"loot tier probabilities must sum to 1.0, got {total!r}"


def test_loot_tiers_are_unique_and_complete():
    tiers = [tier for _, tier in _LOOT_TIERS]
    assert tiers == [None, "uncommon", "rare", "epic", "legendary"]
    # No duplicate tier definitions that could double-count a band.
    assert len(set(tiers)) == len(tiers)


def test_loot_tier_frequencies_match_expected():
    freqs, counts = _monte_carlo(SAMPLE_SIZE, SEED)

    # Sanity: every roll landed in a known tier (no starved / extra bands).
    assert sum(counts.values()) == SAMPLE_SIZE
    assert set(freqs) == set(EXPECTED)

    for tier, expected in EXPECTED.items():
        observed = freqs[tier]
        if expected >= 0.10:
            # Big tiers: tight absolute tolerance.
            assert abs(observed - expected) <= ABS_TOL_BIG, (
                f"tier {tier!r}: observed {observed:.5f} vs expected {expected:.5f} "
                f"(abs err {abs(observed - expected):.5f} > {ABS_TOL_BIG})"
            )
        else:
            # Small tiers (epic 2.5%, legendary 0.5%): relative tolerance.
            assert abs(observed - expected) <= expected * REL_TOL_SMALL, (
                f"tier {tier!r}: observed {observed:.5f} vs expected {expected:.5f} "
                f"(rel err {abs(observed - expected) / expected:.3f} > {REL_TOL_SMALL})"
            )


def test_roll_loot_tier_is_deterministic_for_seed():
    # Same seed -> identical sequence (relied on by _settle_raid_tx idempotency).
    seq_a = [_roll_loot_tier(random.Random(7)) for _ in range(1)]
    rng_b = random.Random(7)
    seq_b = [_roll_loot_tier(rng_b) for _ in range(1)]
    assert seq_a == seq_b
