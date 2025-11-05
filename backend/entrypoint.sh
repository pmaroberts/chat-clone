#!/usr/bin/env bash
set -euo pipefail

echo "Waiting for database at ${DATABASE_URL:-<unset>} ..."
python /app/backend/wait_for_db.py

echo "Running migrations..."
python -m alembic upgrade head

echo "Starting API..."
exec python -m uvicorn main:app --host 0.0.0.0 --port 8000

