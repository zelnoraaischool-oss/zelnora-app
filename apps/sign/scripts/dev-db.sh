#!/usr/bin/env bash
# ローカル開発用DB（Supabase相当のシム＋マイグレーション）を作り直す。
#   ./scripts/dev-db.sh [dbname]
set -euo pipefail
cd "$(dirname "$0")/.."
BASE=$(./scripts/pg-test.sh start)
DB="${1:-sign_dev}"
psql "$BASE" -q -c "drop database if exists $DB with (force)" -c "create database $DB"
URL="${BASE%/*}/$DB"
psql "$URL" -q -v ON_ERROR_STOP=1 -f supabase/tests/supabase_shim.sql
for f in supabase/migrations/*.sql; do psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f"; done
echo "$URL"
