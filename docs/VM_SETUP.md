# VM_SETUP — Implantar o Gestão TI numa VM (para o Fábio)

Este guia parte do princípio de que a VM já existe (criada do mesmo jeito que a do Metabase), com Linux instalado (Ubuntu 22.04/24.04 recomendado) e acesso SSH ou console.

Não é preciso instalar Node.js, compilar nada, nem clonar o código-fonte — as imagens já estão prontas, publicadas em um repositório privado. É o mesmo modelo do Metabase: baixar a imagem e subir.

## 1. Instalar o Docker na VM

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Saia e entre de novo na sessão SSH para o grupo "docker" valer
```

Confirme:
```bash
docker --version
docker compose version
```

## 2. Autenticar no registro de imagens (GitHub Container Registry)

As imagens são **privadas**. O Rafael Castro precisa gerar um **token de acesso** (Personal Access Token do GitHub, só com a permissão `read:packages` — não dá acesso a mais nada, nem ao código-fonte) e te passar o valor:

Link direto para gerar (já vem com a permissão certa marcada): **https://github.com/settings/tokens/new?scopes=read:packages&description=gestao-ti-vm-fabio**

Com o token em mãos, na VM:
```bash
echo "SEU_TOKEN_AQUI" | docker login ghcr.io -u rafa141101 --password-stdin
```

Deve aparecer `Login Succeeded`. Esse login fica salvo na VM — só precisa fazer uma vez.

## 3. Copiar os arquivos de configuração

Você só precisa de **dois arquivos** nesta VM (peça ao Rafael ou baixe do repositório privado `github.com/rafa141101/gestao-ti-tia-eliana`):

- `docker-compose.production.yml`
- `.env.production.example` (renomeie para `.env` e preencha)

```bash
mkdir -p ~/gestao-ti && cd ~/gestao-ti
# copie os dois arquivos para cá (scp, ou baixe do GitHub)
cp .env.production.example .env
nano .env   # preencha POSTGRES_PASSWORD, JWT_SECRET e APP_URL (veja instruções dentro do arquivo)
```

**Gerar valores seguros** para colar no `.env`:
```bash
openssl rand -base64 24    # para POSTGRES_PASSWORD
openssl rand -hex 48       # para JWT_SECRET
```

`APP_URL` deve ser o endereço que as pessoas realmente vão usar no dia a dia dentro da rede da empresa — ex.: `http://10.0.0.15:8090` (IP interno da VM) ou um nome interno, se houver DNS interno.

## 4. Baixar as imagens

```bash
cd ~/gestao-ti
docker compose -f docker-compose.production.yml pull
```

## 5. Trazer os dados reais (⚠️ passo obrigatório nesta migração)

**Importante:** as imagens Docker só contêm o *programa* — não trazem nenhum dado. Os chamados, o inventário (39 equipamentos já cadastrados), os usuários etc. moram só no banco de dados. Você vai receber do Rafael um arquivo de backup (`gestao-ti_AAAA-MM-DD_HHMM.dump`, ~100KB) — é ele que traz tudo isso para a VM nova. **Não rode o seed** (isso criaria dados fictícios de demonstração por cima/no lugar dos reais).

Suba só o banco primeiro:
```bash
docker compose -f docker-compose.production.yml up -d db
sleep 10   # aguarda o banco ficar pronto
```

Copie o arquivo `.dump` que o Rafael te passou para a VM (USB, transferência de rede, o que for mais fácil) e restaure:
```bash
docker compose -f docker-compose.production.yml exec -T db pg_restore -U gestao -d gestao_ti --no-owner < gestao-ti_AAAA-MM-DD_HHMM.dump
```
(ajuste o nome do arquivo para o que você recebeu)

Se também recebeu o arquivo `..._uploads.tar.gz` (anexos de chamados, se houver), restaure assim:
```bash
docker compose -f docker-compose.production.yml up -d api
sleep 5
docker compose -f docker-compose.production.yml exec -T api sh -c 'cd /data && tar xzf -' < gestao-ti_AAAA-MM-DD_HHMM_uploads.tar.gz
```

Agora suba o resto:
```bash
docker compose -f docker-compose.production.yml up -d
```

Aguarde ~10 segundos e confira:
```bash
docker compose -f docker-compose.production.yml ps
curl http://localhost:8090/api/health
```
Deve responder `{"status":"ok",...}`. Teste também um login (peça as credenciais reais ao Rafael) para confirmar que os dados vieram certos.

> **Instalação nova, sem dados a migrar?** Nesse caso (não é o cenário desta migração), pule a restauração e rode `docker compose -f docker-compose.production.yml exec api npx prisma db seed` para criar contas de demonstração (senha padrão `Mudar@123`, deve ser trocada no primeiro acesso).

## 6. Acessar

Do navegador de qualquer computador na rede da empresa: `http://ENDERECO-DA-VM:8090`

## 7. Firewall / portas

**Nenhuma porta precisa ficar aberta para a internet.** O sistema roda só na rede interna. A única exceção é a integração com WhatsApp, que usa um túnel de saída (Cloudflare Tunnel) — não abre porta nenhuma no roteador/firewall também. Veja [`WHATSAPP_SETUP.md`](WHATSAPP_SETUP.md).

Se a empresa usa firewall entre VLANs, libere apenas a porta `8090/tcp` de entrada (saída da rede dos usuários para a VM).

## 8. Backup automático

Agende no `cron` da VM (rodando diariamente de madrugada):

```bash
crontab -e
# adicione a linha:
0 3 * * * cd ~/gestao-ti && docker compose -f docker-compose.production.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -F c' > /caminho/de/backup/gestao-ti_$(date +\%Y-\%m-\%d).dump
```

Copie os backups para fora da VM periodicamente (outro servidor, NAS, nuvem). Veja mais detalhes em [`RUNBOOK.md`](RUNBOOK.md).

## 9. Atualizar para uma versão nova no futuro

Quando o Rafael publicar uma atualização:
```bash
cd ~/gestao-ti
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d
docker compose -f docker-compose.production.yml exec api npx prisma migrate deploy
```
Isso baixa as imagens novas e aplica qualquer alteração no banco automaticamente — sem perder dados.

## Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| `docker login` recusa | Token expirado ou sem permissão `read:packages` — peça um novo |
| `pull access denied` | Não fez o login, ou o token não tem acesso ao repositório | 
| API reinicia em loop | `.env` incompleto (falta `JWT_SECRET` ou `POSTGRES_PASSWORD`) — veja `docker compose logs api` |
| Porta 8090 já em uso | Outro serviço usando a porta — troque `WEB_PORT` no `.env` |
