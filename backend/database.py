"""
database.py — asyncpg connection pool for PostgreSQL
"""
import asyncpg
import os
import logging
from typing import Optional

_pool: Optional[asyncpg.Pool] = None


async def create_pool() -> asyncpg.Pool:
    global _pool
    database_url = os.environ.get('DATABASE_URL')
    if database_url:
        # Render provides postgresql:// but asyncpg needs postgresql://
        dsn = database_url.replace('postgres://', 'postgresql://', 1)
        _pool = await asyncpg.create_pool(dsn=dsn, min_size=5, max_size=20, command_timeout=30)
        logging.info("🐘 PostgreSQL: Connected via DATABASE_URL")
    else:
        _pool = await asyncpg.create_pool(
            host=os.environ.get('PG_HOST', 'localhost'),
            port=int(os.environ.get('PG_PORT', '5432')),
            database=os.environ.get('PG_DB', 'casino_db'),
            user=os.environ.get('PG_USER', 'postgres'),
            password=os.environ.get('PG_PASSWORD', 'postgres'),
            min_size=5,
            max_size=20,
            command_timeout=30,
        )
        logging.info(f"🐘 PostgreSQL: Connected to '{os.environ.get('PG_DB', 'casino_db')}'")
    return _pool


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        logging.info("🐘 PostgreSQL pool closed")


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialized. Call create_pool() first.")
    return _pool
