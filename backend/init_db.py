"""
init_db.py — Create all PostgreSQL tables
Run once: python init_db.py
"""
import asyncio
import asyncpg
import os
from dotenv import load_dotenv
from pathlib import Path
from itemization import seed_rows

load_dotenv(Path(__file__).parent / '.env')

CREATE_TABLES_SQL = """

CREATE TABLE IF NOT EXISTS users (
    id                      VARCHAR(36) PRIMARY KEY,
    telegram_id             BIGINT UNIQUE NOT NULL,
    first_name              VARCHAR(255) NOT NULL,
    last_name               VARCHAR(255),
    telegram_username       VARCHAR(255),
    photo_url               TEXT,
    wallet_address          VARCHAR(255),
    personal_solana_address VARCHAR(255),
    derived_solana_address  VARCHAR(255),
    derivation_path         TEXT,
    token_balance           INTEGER NOT NULL DEFAULT 0,
    total_purchases         INTEGER NOT NULL DEFAULT 0,
    basket_items            INTEGER NOT NULL DEFAULT 0,
    bot_status              VARCHAR(50) NOT NULL DEFAULT 'Regular',
    is_verified             BOOLEAN NOT NULL DEFAULT FALSE,
    is_admin                BOOLEAN NOT NULL DEFAULT FALSE,
    is_owner                BOOLEAN NOT NULL DEFAULT FALSE,
    role                    VARCHAR(50) NOT NULL DEFAULT 'user',
    last_daily_claim        TIMESTAMP WITH TIME ZONE,
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_login              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Add columns if not exists (safe to run multiple times)
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_purchases INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS basket_items    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_status      VARCHAR(50) NOT NULL DEFAULT 'Regular';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS xp                 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS level              INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS class_name         VARCHAR(20) DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS character_build_json JSONB DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_win_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_win_streak     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS settings           JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wins               INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS losses             INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS energy INTEGER NOT NULL DEFAULT 10;
ALTER TABLE users ADD COLUMN IF NOT EXISTS energy_last_regen TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS promo_codes (
    code         VARCHAR(50) PRIMARY KEY,
    token_amount INTEGER NOT NULL DEFAULT 0,
    max_uses     INTEGER NOT NULL DEFAULT 1,
    uses_count   INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at   TIMESTAMP WITH TIME ZONE,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    unlimited    BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS unlimited BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS promo_uses (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(50) NOT NULL,
    telegram_id BIGINT NOT NULL,
    used_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(code, telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id       ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_telegram_username ON users(telegram_username);
CREATE INDEX IF NOT EXISTS idx_users_token_balance     ON users(token_balance DESC);


CREATE TABLE IF NOT EXISTS completed_games (
    id           VARCHAR(36) PRIMARY KEY,
    room_type    VARCHAR(50) NOT NULL,
    players      JSONB NOT NULL DEFAULT '[]',
    status       VARCHAR(50) NOT NULL DEFAULT 'finished',
    prize_pool   INTEGER NOT NULL DEFAULT 0,
    winner       JSONB,
    prize_link   TEXT,
    match_id     VARCHAR(36),
    round_number INTEGER NOT NULL DEFAULT 1,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    started_at   TIMESTAMP WITH TIME ZONE,
    finished_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_completed_games_finished ON completed_games(finished_at DESC);


CREATE TABLE IF NOT EXISTS winner_prizes (
    id           SERIAL PRIMARY KEY,
    user_id      VARCHAR(36) NOT NULL,
    username     VARCHAR(255),
    room_type    VARCHAR(50) NOT NULL,
    prize_link   TEXT,
    bet_amount   INTEGER NOT NULL DEFAULT 0,
    total_pool   INTEGER NOT NULL DEFAULT 0,
    round_number INTEGER NOT NULL DEFAULT 1,
    won_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_winner_prizes_user_id ON winner_prizes(user_id);
CREATE INDEX IF NOT EXISTS idx_winner_prizes_won_at  ON winner_prizes(won_at DESC);


CREATE TABLE IF NOT EXISTS pending_results (
    id          SERIAL PRIMARY KEY,
    user_id     VARCHAR(36) UNIQUE NOT NULL,
    match_id    VARCHAR(36),
    winner      JSONB,
    all_players JSONB NOT NULL DEFAULT '[]',
    room_type   VARCHAR(50),
    prize_pool  INTEGER NOT NULL DEFAULT 0,
    prize_link  TEXT,
    finished_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS token_purchases (
    id            SERIAL PRIMARY KEY,
    user_id       VARCHAR(36) NOT NULL,
    sol_amount    DECIMAL(18, 8),
    token_amount  INTEGER NOT NULL,
    purchase_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_purchases_user_id ON token_purchases(user_id);


CREATE TABLE IF NOT EXISTS temporary_wallets (
    id                 SERIAL PRIMARY KEY,
    wallet_address     VARCHAR(255) UNIQUE NOT NULL,
    user_id            VARCHAR(36) NOT NULL,
    required_sol       DECIMAL(18, 8),
    private_key        TEXT,
    token_amount       INTEGER NOT NULL DEFAULT 0,
    payment_detected   BOOLEAN NOT NULL DEFAULT FALSE,
    tokens_credited    BOOLEAN NOT NULL DEFAULT FALSE,
    sol_forwarded      BOOLEAN NOT NULL DEFAULT FALSE,
    status             VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    detected_at        TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_tmp_wallets_address ON temporary_wallets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_tmp_wallets_user_id ON temporary_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_tmp_wallets_status  ON temporary_wallets(status);

CREATE TABLE IF NOT EXISTS inventory (
    id          VARCHAR(36) PRIMARY KEY,
    user_id     VARCHAR(36) NOT NULL REFERENCES users(id),
    item_type   VARCHAR(20) NOT NULL,
    item_name   VARCHAR(100) NOT NULL,
    item_rarity VARCHAR(20) NOT NULL DEFAULT 'Common',
    equipped    BOOLEAN NOT NULL DEFAULT FALSE,
    acquired_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CHECK (item_type IN ('weapon', 'armor', 'ability', 'consumable'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory(user_id);

-- Extend inventory with item reference and acquisition source
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS item_id INTEGER;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS source  TEXT DEFAULT 'drop';
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS enchant_level INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS item_scrolls (
    user_id     VARCHAR(36) NOT NULL REFERENCES users(id),
    scroll_type TEXT NOT NULL,
    quantity    INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, scroll_type),
    CHECK (scroll_type IN ('normal_scroll', 'blessed_scroll')),
    CHECK (quantity >= 0)
);

CREATE TABLE IF NOT EXISTS items (
    id               SERIAL PRIMARY KEY,
    name             TEXT NOT NULL,
    description      TEXT,
    class_name       TEXT NOT NULL,
    slot             TEXT NOT NULL,
    tier             TEXT NOT NULL,
    price            INTEGER DEFAULT 0,
    attack_bonus     INTEGER DEFAULT 0,
    ability_bonus    INTEGER DEFAULT 0,
    defend_reduction INTEGER DEFAULT 0,
    hp_bonus         INTEGER DEFAULT 0,
    risk_win_chance  REAL DEFAULT 0.0,
    passive_type     TEXT,
    passive_value    REAL DEFAULT 0.0,
    image_path       TEXT,
    lpc_visual       JSONB,
    ability_key      TEXT,
    ability_cooldown_ms INTEGER DEFAULT 0,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(name, class_name, tier)
);

CREATE TABLE IF NOT EXISTS equipped_items (
    user_id     TEXT NOT NULL,
    slot        TEXT NOT NULL,
    inventory_id VARCHAR(36) REFERENCES inventory(id),
    item_id     INTEGER NOT NULL REFERENCES items(id),
    equipped_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_equipped_items_user ON equipped_items(user_id);

CREATE TABLE IF NOT EXISTS room_configs (
    room_type   VARCHAR(20) PRIMARY KEY,
    min_bet     INTEGER NOT NULL DEFAULT 0,
    max_bet     INTEGER NOT NULL DEFAULT 0,
    max_players INTEGER NOT NULL DEFAULT 3,
    min_players INTEGER NOT NULL DEFAULT 2
);

CREATE TABLE IF NOT EXISTS arena_matches (
    id                      VARCHAR(36) PRIMARY KEY,
    mode                    VARCHAR(20) NOT NULL DEFAULT 'duel',
    status                  VARCHAR(20) NOT NULL DEFAULT 'active',
    player_one_id           VARCHAR(36) NOT NULL REFERENCES users(id),
    player_two_id           VARCHAR(36) NOT NULL REFERENCES users(id),
    stake_amount            INTEGER NOT NULL CHECK (stake_amount > 0),
    pot_amount              INTEGER NOT NULL CHECK (pot_amount >= 0),
    payout_amount           INTEGER NOT NULL DEFAULT 0 CHECK (payout_amount >= 0),
    burn_amount             INTEGER NOT NULL DEFAULT 0 CHECK (burn_amount >= 0),
    winner_user_id          VARCHAR(36),
    round_number            INTEGER NOT NULL DEFAULT 1,
    player_one_hp           INTEGER NOT NULL DEFAULT 100,
    player_two_hp           INTEGER NOT NULL DEFAULT 100,
    player_one_ability_used BOOLEAN NOT NULL DEFAULT FALSE,
    player_two_ability_used BOOLEAN NOT NULL DEFAULT FALSE,
    metadata                JSONB NOT NULL DEFAULT '{}',
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    finished_at             TIMESTAMP WITH TIME ZONE,
    CHECK (player_one_id <> player_two_id),
    CHECK (status IN ('active', 'finished', 'draw', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS arena_rounds (
    id                   VARCHAR(36) PRIMARY KEY,
    match_id             VARCHAR(36) NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
    round_number         INTEGER NOT NULL,
    status               VARCHAR(20) NOT NULL DEFAULT 'open',
    deadline_at          TIMESTAMP WITH TIME ZONE NOT NULL,
    player_one_action    VARCHAR(20),
    player_two_action    VARCHAR(20),
    player_one_hp_after  INTEGER,
    player_two_hp_after  INTEGER,
    resolution_details   JSONB NOT NULL DEFAULT '{}',
    created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resolved_at          TIMESTAMP WITH TIME ZONE,
    UNIQUE(match_id, round_number),
    CHECK (status IN ('open', 'resolved'))
);

CREATE TABLE IF NOT EXISTS arena_actions (
    id           VARCHAR(36) PRIMARY KEY,
    match_id     VARCHAR(36) NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL,
    user_id      VARCHAR(36) NOT NULL REFERENCES users(id),
    action       VARCHAR(20) NOT NULL,
    is_auto      BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(match_id, round_number, user_id),
    CHECK (action IN ('attack', 'defend', 'ability', 'risk'))
);

CREATE INDEX IF NOT EXISTS idx_arena_matches_player_one ON arena_matches(player_one_id);
CREATE INDEX IF NOT EXISTS idx_arena_matches_player_two ON arena_matches(player_two_id);
CREATE INDEX IF NOT EXISTS idx_arena_matches_status ON arena_matches(status);
CREATE INDEX IF NOT EXISTS idx_arena_rounds_match ON arena_rounds(match_id, round_number);
CREATE INDEX IF NOT EXISTS idx_arena_actions_match_round ON arena_actions(match_id, round_number);


CREATE TABLE IF NOT EXISTS boss_raids (
    id              VARCHAR(36) PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    level           INTEGER NOT NULL DEFAULT 1,
    phase           INTEGER NOT NULL DEFAULT 1,
    max_hp          INTEGER NOT NULL,
    current_hp      INTEGER NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    raid_end_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    loot_table      JSONB NOT NULL DEFAULT '{}',
    rewards_settled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CHECK (status IN ('active', 'defeated', 'expired'))
);

CREATE TABLE IF NOT EXISTS boss_raid_damage (
    id       SERIAL PRIMARY KEY,
    raid_id  VARCHAR(36) NOT NULL REFERENCES boss_raids(id),
    user_id  VARCHAR(36) NOT NULL REFERENCES users(id),
    damage   INTEGER NOT NULL,
    dealt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS boss_raid_rewards (
    id         SERIAL PRIMARY KEY,
    raid_id    VARCHAR(36) NOT NULL REFERENCES boss_raids(id),
    user_id    VARCHAR(36) NOT NULL,
    coins      INTEGER NOT NULL DEFAULT 0,
    xp         INTEGER NOT NULL DEFAULT 0,
    item_drop  VARCHAR(100),
    claimed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Migration: add FK on existing boss_raid_rewards.raid_id if missing
ALTER TABLE boss_raid_rewards
    DROP CONSTRAINT IF EXISTS boss_raid_rewards_raid_id_fkey;
ALTER TABLE boss_raid_rewards
    ADD CONSTRAINT boss_raid_rewards_raid_id_fkey
    FOREIGN KEY (raid_id) REFERENCES boss_raids(id);

CREATE INDEX IF NOT EXISTS idx_boss_raids_status         ON boss_raids(status);
CREATE INDEX IF NOT EXISTS idx_boss_raid_damage_raid     ON boss_raid_damage(raid_id);
CREATE INDEX IF NOT EXISTS idx_boss_raid_damage_raid_user ON boss_raid_damage(raid_id, user_id);
CREATE INDEX IF NOT EXISTS idx_boss_raid_rewards_raid    ON boss_raid_rewards(raid_id);

CREATE TABLE IF NOT EXISTS daily_quest_progress (
    user_id     VARCHAR(36) NOT NULL REFERENCES users(id),
    quest_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    quest_key   VARCHAR(50) NOT NULL,
    progress    INTEGER NOT NULL DEFAULT 0,
    completed   BOOLEAN NOT NULL DEFAULT FALSE,
    claimed     BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (user_id, quest_date, quest_key)
);
CREATE INDEX IF NOT EXISTS idx_dqp_user_date ON daily_quest_progress(user_id, quest_date);

CREATE TABLE IF NOT EXISTS daily_chest_claims (
    user_id      VARCHAR(36) NOT NULL REFERENCES users(id),
    claim_date   DATE NOT NULL,
    claimed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reward_coins INTEGER NOT NULL DEFAULT 0,
    reward_xp    INTEGER NOT NULL DEFAULT 0,
    item_tier    TEXT,
    item_id      INTEGER REFERENCES items(id),
    inventory_id VARCHAR(36) REFERENCES inventory(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, claim_date),
    CHECK (reward_coins >= 0),
    CHECK (reward_xp >= 0),
    CHECK (item_tier IS NULL OR item_tier IN ('common', 'uncommon', 'rare', 'epic', 'legendary'))
);
CREATE INDEX IF NOT EXISTS idx_daily_chest_claims_user_date ON daily_chest_claims(user_id, claim_date DESC);

CREATE TABLE IF NOT EXISTS early_access (
    id              SERIAL PRIMARY KEY,
    telegram_id     BIGINT UNIQUE NOT NULL,
    username        VARCHAR(255),
    first_name      VARCHAR(255),
    registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tokens_awarded  BOOLEAN NOT NULL DEFAULT FALSE,
    awarded_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_early_access_tokens_awarded ON early_access(tokens_awarded);

"""


async def init():
    database_url = os.environ.get('DATABASE_URL')
    if database_url:
        dsn = database_url.replace('postgres://', 'postgresql://', 1)
        conn = await asyncpg.connect(dsn=dsn)
    else:
        conn = await asyncpg.connect(
            host=os.environ.get('PG_HOST', 'localhost'),
            port=int(os.environ.get('PG_PORT', '5432')),
            database=os.environ.get('PG_DB', 'riskarena_db'),
            user=os.environ.get('PG_USER', 'postgres'),
            password=os.environ.get('PG_PASSWORD', 'postgres'),
        )
    try:
        await conn.execute(CREATE_TABLES_SQL)
        # Migration: allow multiple pending results per user (remove unique constraint if exists)
        await conn.execute("""
            ALTER TABLE pending_results DROP CONSTRAINT IF EXISTS pending_results_user_id_key;
        """)
        # Migration: enforce non-negative token balance at DB level
        await conn.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'token_balance_non_negative' AND conrelid = 'users'::regclass
                ) THEN
                    ALTER TABLE users ADD CONSTRAINT token_balance_non_negative CHECK (token_balance >= 0);
                END IF;
            END;
            $$;
        """)
        await conn.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'xp_non_negative' AND conrelid = 'users'::regclass
                ) THEN
                    ALTER TABLE users ADD CONSTRAINT xp_non_negative CHECK (xp >= 0);
                END IF;
            END;
            $$;
        """)
        await conn.execute("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'daily_chest_claims_inventory_id_fkey'
                      AND conrelid = 'daily_chest_claims'::regclass
                      AND confdeltype <> 'n'
                ) THEN
                    ALTER TABLE daily_chest_claims
                        DROP CONSTRAINT daily_chest_claims_inventory_id_fkey;
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'daily_chest_claims_inventory_id_fkey'
                      AND conrelid = 'daily_chest_claims'::regclass
                ) THEN
                    ALTER TABLE daily_chest_claims
                        ADD CONSTRAINT daily_chest_claims_inventory_id_fkey
                        FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE SET NULL;
                END IF;
            END;
            $$;
        """)
        # Migration: add FK on inventory.item_id if not already present
        await conn.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'inventory_item_id_fkey' AND conrelid = 'inventory'::regclass
                ) THEN
                    ALTER TABLE inventory ADD CONSTRAINT inventory_item_id_fkey
                        FOREIGN KEY (item_id) REFERENCES items(id);
                END IF;
            END;
            $$;
        """)
        # Item seeding handled via FULL_ITEM_CATALOG in itemization.py
        print("✅ All tables created successfully.")
        await conn.execute("""
            ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_item_rarity_check;
        """)
        await conn.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'inventory_item_rarity_check' AND conrelid = 'inventory'::regclass
                ) THEN
                    ALTER TABLE inventory ADD CONSTRAINT inventory_item_rarity_check
                        CHECK (item_rarity IN ('Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'));
                END IF;
            END;
            $$;
        """)
        await conn.execute("ALTER TABLE items ADD COLUMN IF NOT EXISTS passive_type TEXT;")
        await conn.execute("ALTER TABLE items ADD COLUMN IF NOT EXISTS passive_value REAL DEFAULT 0.0;")
        await conn.execute("ALTER TABLE items ADD COLUMN IF NOT EXISTS lpc_visual JSONB;")
        await conn.execute("ALTER TABLE items ADD COLUMN IF NOT EXISTS ability_key TEXT;")
        await conn.execute("ALTER TABLE items ADD COLUMN IF NOT EXISTS ability_cooldown_ms INTEGER DEFAULT 0;")
        await conn.execute("ALTER TABLE inventory ADD COLUMN IF NOT EXISTS enchant_level INTEGER NOT NULL DEFAULT 0;")
        await conn.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'inventory_enchant_level_non_negative' AND conrelid = 'inventory'::regclass
                ) THEN
                    ALTER TABLE inventory ADD CONSTRAINT inventory_enchant_level_non_negative
                        CHECK (enchant_level >= 0);
                END IF;
            END;
            $$;
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS item_scrolls (
                user_id     VARCHAR(36) NOT NULL REFERENCES users(id),
                scroll_type TEXT NOT NULL,
                quantity    INTEGER NOT NULL DEFAULT 0,
                updated_at  TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (user_id, scroll_type),
                CHECK (scroll_type IN ('normal_scroll', 'blessed_scroll')),
                CHECK (quantity >= 0)
            );
        """)
        await conn.execute("ALTER TABLE equipped_items ADD COLUMN IF NOT EXISTS inventory_id VARCHAR(36);")
        await conn.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'equipped_items_inventory_id_fkey' AND conrelid = 'equipped_items'::regclass
                ) THEN
                    ALTER TABLE equipped_items ADD CONSTRAINT equipped_items_inventory_id_fkey
                        FOREIGN KEY (inventory_id) REFERENCES inventory(id);
                END IF;
            END;
            $$;
        """)
        await conn.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_items_class_slot_tier
            ON items(class_name, slot, tier);
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_items_shop_browse
            ON items(tier, class_name, slot);
        """)
        await conn.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'items_class_name_check' AND conrelid = 'items'::regclass
                ) THEN
                    ALTER TABLE items ADD CONSTRAINT items_class_name_check
                        CHECK (class_name IN ('warrior', 'mage', 'rogue'));
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'items_slot_check' AND conrelid = 'items'::regclass
                ) THEN
                    ALTER TABLE items ADD CONSTRAINT items_slot_check
                        CHECK (slot IN ('weapon', 'armor', 'ability'));
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'items_tier_check' AND conrelid = 'items'::regclass
                ) THEN
                    ALTER TABLE items ADD CONSTRAINT items_tier_check
                        CHECK (tier IN ('common', 'uncommon', 'rare', 'epic', 'legendary'));
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'items_passive_type_check' AND conrelid = 'items'::regclass
                ) THEN
                    ALTER TABLE items ADD CONSTRAINT items_passive_type_check
                        CHECK (
                            passive_type IS NULL OR
                            passive_type IN (
                                'bonus_attack_percent',
                                'bonus_ability_percent',
                                'damage_reduction_percent',
                                'risk_success_bonus',
                                'boss_damage_percent',
                                'lifesteal_percent'
                            )
                        );
                END IF;
            END;
            $$;
        """)
        await conn.executemany(
            """
            INSERT INTO items
                (name, description, class_name, slot, tier, price,
                 attack_bonus, ability_bonus, defend_reduction, hp_bonus,
                 risk_win_chance, passive_type, passive_value, image_path, lpc_visual,
                 ability_key, ability_cooldown_ms)
            VALUES
                ($1, $2, $3, $4, $5, $6,
                 $7, $8, $9, $10,
                 $11, $12, $13, $14, $15::jsonb,
                 $16, $17)
            ON CONFLICT (class_name, slot, tier) DO UPDATE
            SET name = EXCLUDED.name,
                description = EXCLUDED.description,
                price = EXCLUDED.price,
                attack_bonus = EXCLUDED.attack_bonus,
                ability_bonus = EXCLUDED.ability_bonus,
                defend_reduction = EXCLUDED.defend_reduction,
                hp_bonus = EXCLUDED.hp_bonus,
                risk_win_chance = EXCLUDED.risk_win_chance,
                passive_type = EXCLUDED.passive_type,
                passive_value = EXCLUDED.passive_value,
                image_path = EXCLUDED.image_path,
                lpc_visual = EXCLUDED.lpc_visual,
                ability_key = EXCLUDED.ability_key,
                ability_cooldown_ms = EXCLUDED.ability_cooldown_ms
            """,
            seed_rows(),
        )
        await conn.execute("""
            UPDATE items SET image_path = '/items/warrior_sword.png'
            WHERE class_name = 'warrior' AND slot = 'weapon' AND image_path = '/items/warrior_weapon.png';
            UPDATE items SET image_path = '/items/mage_staff.png'
            WHERE class_name = 'mage' AND slot = 'weapon' AND image_path = '/items/mage_weapon.png';
            UPDATE items SET image_path = '/items/rogue_dagger.png'
            WHERE class_name = 'rogue' AND slot = 'weapon' AND image_path = '/items/rogue_weapon.png';
        """)
        await conn.execute("""
            UPDATE equipped_items ei
            SET inventory_id = (
                SELECT inv.id
                FROM inventory inv
                WHERE inv.user_id = ei.user_id AND inv.item_id = ei.item_id
                ORDER BY inv.acquired_at ASC, inv.id ASC
                LIMIT 1
            )
            WHERE ei.inventory_id IS NULL
        """)
        await conn.execute("""
            UPDATE inventory inv
            SET item_type = i.slot,
                item_name = i.name,
                item_rarity = CASE i.tier
                    WHEN 'common' THEN 'Common'
                    WHEN 'uncommon' THEN 'Uncommon'
                    WHEN 'rare' THEN 'Rare'
                    WHEN 'epic' THEN 'Epic'
                    WHEN 'legendary' THEN 'Legendary'
                    ELSE inv.item_rarity
                END
            FROM items i
            WHERE inv.item_id = i.id
        """)
        await conn.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'equipped_items' AND column_name = 'class_name'
                ) THEN
                    ALTER TABLE equipped_items ADD COLUMN class_name TEXT NOT NULL DEFAULT '';
                    UPDATE equipped_items ei
                    SET class_name = COALESCE(
                        (SELECT class_name FROM users WHERE id = ei.user_id), 'warrior'
                    );
                    ALTER TABLE equipped_items DROP CONSTRAINT IF EXISTS equipped_items_pkey;
                    ALTER TABLE equipped_items ADD PRIMARY KEY (user_id, slot, class_name);
                END IF;
            END;
            $$;
        """)
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(init())
