# RUNBOOK — Operação do Gestão TI

Procedimentos do dia a dia para quem opera o sistema. Comandos executados na pasta do projeto (ou em qualquer pasta usando `-p gestao-ti-tia-eliana`).

## Subir / parar / reiniciar

```bash
docker compose up -d                     # sobe (sem rebuild)
docker compose stop                      # para sem remover
docker compose restart api               # reinicia só a API (ex.: após mudar .env)
docker compose down                      # para e remove containers (volumes preservados)
```

## Ver logs

```bash
docker compose logs -f api               # API em tempo real
docker compose logs --tail 100 web       # nginx
docker compose logs db                   # banco
```

Erros da API aparecem como JSON com `"level":50`.

## Saúde

- `http://localhost:8090/api/health` → `{"status":"ok"}`
- `docker compose ps` → db deve estar `healthy`

## Backup (diário recomendado)

```bash
./scripts/backup.sh                      # banco + anexos em ./backups
```

Agendar no Windows: Agendador de Tarefas → executar `sh scripts/backup.sh` via Git Bash. Copie os arquivos de `backups/` para fora do servidor (NAS/HD externo). **Teste a restauração periodicamente** (ambiente separado): `./scripts/restore.sh arquivo.dump`.

## Atualização de versão

```bash
git pull                                 # quando versionado
# Build exige caminho sem acento (bug do BuildKit) — ver README
robocopy "C:\...\Gestão TI" C:\temp\gestao-ti-build /E /XD node_modules dist uploads backups .git
cd C:\temp\gestao-ti-build && docker compose up -d --build
docker compose exec api npx prisma migrate deploy
```

## Recuperar acesso do Owner

Ver [owner-manual.md](owner-manual.md) — inclui o comando de emergência via `docker compose exec api`.

## Problemas comuns

| Sintoma | Causa provável | Ação |
| --- | --- | --- |
| API reiniciando em loop | `JWT_SECRET` de dev em produção ou banco fora | `docker compose logs api`; corrigir `.env`; `docker compose up -d api` |
| "Muitas requisições" | rate-limit (300/min por IP; login 10/min) | aguardar 1 min; se legítimo (ex.: integração), revisar limites em `app.ts` |
| Porta em uso ao subir | conflito com outro projeto Docker | conferir `docker ps`; ajustar `WEB_PORT`/`POSTGRES_PORT` no `.env` |
| WhatsApp não responde | integração inativa ou token expirado | conferir card em Configurações; `docker compose logs api \| grep whatsapp` |
| Rotinas não geram execução | agendador roda a cada 5 min | aguardar um ciclo; conferir logs `[scheduler]` |

## Integração WhatsApp — ativação

1. Criar app na Meta (developers.facebook.com) com produto WhatsApp; obter **token permanente** e **Phone Number ID**.
2. Definir no `.env`: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` (valor livre).
3. `docker compose up -d api` para recarregar.
4. Expor o webhook publicamente com HTTPS (ex.: Cloudflare Tunnel apontando para `http://localhost:8090`) e cadastrar no painel da Meta: URL `https://SEU-DOMINIO/api/integrations/whatsapp/webhook`, verify token = o mesmo do `.env`, assinando o campo `messages`.
5. Testar: enviar mensagem ao número → chamado criado (canal WhatsApp) e resposta automática com o número do chamado.
