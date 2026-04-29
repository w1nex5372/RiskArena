"""
init_db.py — Create all PostgreSQL tables
Run once: python init_db.py
"""
import asyncio
import asyncpg
import os
from dotenv import load_dotenv
from pathlib import Path

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
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned       BOOLEAN NOT NULL DEFAULT FALSE;

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

CREATE TABLE IF NOT EXISTS room_configs (
    room_type   VARCHAR(20) PRIMARY KEY,
    min_bet     INTEGER NOT NULL DEFAULT 0,
    max_bet     INTEGER NOT NULL DEFAULT 0,
    max_players INTEGER NOT NULL DEFAULT 3,
    min_players INTEGER NOT NULL DEFAULT 2
);

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
            database=os.environ.get('PG_DB', 'casino_db'),
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
        print("✅ All tables created successfully.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(init())
