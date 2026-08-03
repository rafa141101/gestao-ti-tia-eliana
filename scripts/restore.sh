#!/usr/bin/env sh
# Restauração do banco do Gestão TI a partir de um backup gerado por backup.sh.
# Uso: ./scripts/restore.sh backups/gestao-ti_AAAA-MM-DD_HHMM.dump [arquivo_uploads.tar.gz]
# ATENÇÃO: substitui TODOS os dados atuais do banco. Confirme antes.
set -eu

DUMP="${1:?Informe o arquivo .dump do banco}"
UPLOADS="${2:-}"

printf "Isso vai SUBSTITUIR todos os dados atuais. Digite 'sim' para continuar: "
read -r CONFIRm
[ "$CONFIRm" = "sim" ] || { echo "Cancelado."; exit 1; }

echo ">> Restaurando banco de dados de $DUMP..."
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < "$DUMP"

if [ -n "$UPLOADS" ]; then
  echo ">> Restaurando anexos de $UPLOADS..."
  docker compose exec -T api sh -c 'rm -rf /data/uploads && mkdir -p /data'
  docker compose exec -T api sh -c 'cd /data && tar xzf -' < "$UPLOADS"
fi

echo ">> Restauração concluída. Reinicie a API: docker compose restart api"
