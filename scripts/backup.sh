#!/usr/bin/env sh
# Backup do banco e dos anexos do Gestão TI.
# Uso: ./scripts/backup.sh [diretorio_destino]
# Gera: backups/gestao-ti_AAAA-MM-DD_HHMM.dump (banco, formato custom do pg_dump)
#       backups/gestao-ti_AAAA-MM-DD_HHMM_uploads.tar.gz (anexos)
set -eu

DEST="${1:-./backups}"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DEST"

echo ">> Backup do banco de dados..."
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -F c' > "$DEST/gestao-ti_${STAMP}.dump"

echo ">> Backup dos anexos..."
docker compose exec -T api sh -c 'cd /data && tar czf - uploads' > "$DEST/gestao-ti_${STAMP}_uploads.tar.gz" || echo "   (sem anexos ainda — ok)"

echo ">> Concluído:"
ls -lh "$DEST" | grep "$STAMP"
echo ""
echo "IMPORTANTE: um backup só é válido depois de testado."
echo "Teste a restauração periodicamente: ./scripts/restore.sh $DEST/gestao-ti_${STAMP}.dump (em ambiente de teste)"
