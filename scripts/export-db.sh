#!/usr/bin/env sh
# Exportação completa do banco em SQL legível (para migração/conferência).
# Uso: ./scripts/export-db.sh [arquivo_saida.sql]
set -eu
OUT="${1:-./backups/gestao-ti_export_$(date +%Y-%m-%d).sql}"
mkdir -p "$(dirname "$OUT")"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' > "$OUT"
echo "Exportado para: $OUT"
