# WHATSAPP_SETUP — Ativar a integração oficial do WhatsApp

Este guia cobre as duas partes necessárias: (1) obter as credenciais na Meta e (2) expor o webhook para a internet via Cloudflare Tunnel, sem abrir portas no firewall da empresa.

**Custo:** zero. Conversas iniciadas pelo cliente/usuário abrem uma janela de atendimento de 24h em que respostas de texto são gratuitas na API oficial da Meta. Como a TI só responde a quem chamou, não há cobrança.

**Pré-requisito:** conta Business já existente na Meta (vocês confirmaram que já têm, por já usarem WhatsApp Business/Ads).

---

## Parte 1 — Credenciais na Meta

### 1.1 Escolher o número de telefone

⚠️ **Atenção importante:** um número de telefone só pode estar em **um lugar por vez** — ou no aplicativo comum do WhatsApp Business (celular), ou na API oficial (Cloud API). Não dá para usar os dois ao mesmo tempo com o mesmo número.

- Se já existe um número usado no app do WhatsApp Business para atendimento (vendas, SAC etc.), **não use esse número aqui** — migrá-lo tira o acesso pelo aplicativo do celular.
- Recomendado: **um número novo e dedicado** só para o canal de TI (pode ser um chip pré-pago simples, só precisa receber o SMS/ligação de verificação uma vez).

### 1.2 Criar o app na Meta for Developers

1. Acesse **https://developers.facebook.com/apps** e entre com a conta Business da empresa.
2. **Criar app** → tipo **Empresa** (Business) → associe à conta Business já existente.
3. No painel do app, adicione o produto **WhatsApp**.
4. Em **WhatsApp → Configuração da API**, você verá um número de teste temporário — troque pelo número real da empresa (opção "Adicionar número de telefone"), seguindo a verificação por SMS/ligação.

### 1.3 Gerar o token permanente

O token que aparece por padrão na tela de configuração **expira em 24h** — não serve para produção. É preciso gerar um token permanente via **Usuário do Sistema**:

1. Vá em **business.facebook.com/settings** → **Usuários → Usuários do sistema**.
2. Crie um usuário do sistema (ex.: "gestao-ti-bot"), papel **Admin**.
3. Em **Adicionar ativos**, vincule o App do WhatsApp criado acima, com permissão de gerenciamento total.
4. Clique em **Gerar novo token** para esse usuário do sistema, selecione o App, marque a permissão `whatsapp_business_messaging` (e `whatsapp_business_management`), e gere **sem data de expiração**.
5. **Copie e guarde esse token com segurança** — é o valor de `WHATSAPP_TOKEN` no `.env` da VM. Ele não é mostrado de novo depois.

### 1.4 Anotar o Phone Number ID

Em **WhatsApp → Configuração da API** no painel do app, copie o **Phone number ID** (um número de identificação, diferente do número de telefone em si). É o valor de `WHATSAPP_PHONE_NUMBER_ID`.

---

## Parte 2 — Expor o webhook (Cloudflare Tunnel)

A Meta precisa conseguir alcançar `https://ALGUM-ENDERECO/api/integrations/whatsapp/webhook` pela internet. Em vez de abrir porta no roteador, usamos um túnel — a VM faz uma conexão de saída para a Cloudflare, sem precisar de IP público nem port-forward.

### 2.1 Conta Cloudflare (grátis)

Se a empresa ainda não tem: crie em **cloudflare.com** (grátis). Idealmente, aponte um domínio (ou subdomínio, ex. `ti.tiaeliana.com.br`) para a Cloudflare — se não tiverem domínio próprio disponível para isso, me avisem, existem alternativas rápidas.

### 2.2 Instalar o `cloudflared` na VM

```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
cloudflared tunnel login
```
(Isso abre um link para autorizar no navegador — autorize com a conta Cloudflare da empresa.)

### 2.3 Criar o túnel, expondo só o caminho do webhook

```bash
cloudflared tunnel create gestao-ti-whatsapp
```
Anote o ID gerado. Crie o arquivo de configuração `~/.cloudflared/config.yml`:

```yaml
tunnel: gestao-ti-whatsapp
credentials-file: /home/SEU_USUARIO/.cloudflared/<ID-DO-TUNEL>.json

ingress:
  # Só o caminho do webhook do WhatsApp fica público — o resto do sistema
  # continua acessível apenas na rede interna, como foi projetado.
  - hostname: ti.tiaeliana.com.br
    path: /api/integrations/whatsapp/webhook
    service: http://localhost:8090
  - service: http_status:404
```

Aponte o DNS (no painel da Cloudflare, aba DNS do domínio):
```bash
cloudflared tunnel route dns gestao-ti-whatsapp ti.tiaeliana.com.br
```

Rode o túnel como serviço permanente:
```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

### 2.4 Testar o webhook antes de cadastrar na Meta

```bash
curl "https://ti.tiaeliana.com.br/api/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=SEU_VERIFY_TOKEN&hub.challenge=teste123"
```
Deve responder `teste123`. Se não responder, revise o `ingress` do túnel e se o sistema está no ar (`docker compose ps`).

---

## Parte 3 — Ligar tudo

### 3.1 Preencher o `.env` na VM

```env
WHATSAPP_TOKEN=<token permanente do usuário do sistema>
WHATSAPP_PHONE_NUMBER_ID=<phone number id>
WHATSAPP_VERIFY_TOKEN=<qualquer texto à sua escolha, ex.: gestao-ti-tia-eliana-2026>
```
Depois:
```bash
docker compose -f docker-compose.production.yml up -d api
```

### 3.2 Cadastrar o webhook no painel da Meta

Em **WhatsApp → Configuração → Webhook**:
- **URL de callback:** `https://ti.tiaeliana.com.br/api/integrations/whatsapp/webhook`
- **Token de verificação:** o mesmo valor de `WHATSAPP_VERIFY_TOKEN`
- Clique em **Verificar e salvar**.
- Em **Campos do webhook**, ative a assinatura de **`messages`**.

### 3.3 Testar de verdade

Mande uma mensagem de WhatsApp para o número dedicado. Em poucos segundos deve:
1. Criar um chamado no sistema (canal WhatsApp);
2. Responder na conversa com o número do chamado.

Confira em **Configurações** dentro do sistema (menu Administração) se o status da integração aparece como **Ativa**.

---

## Regras de funcionamento (já implementadas)

- Mensagem nova → abre chamado novo, avisa o número do chamado.
- Mensagem do mesmo número dentro de 24h de um chamado WhatsApp em aberto → vira resposta no **mesmo** chamado (não duplica).
- Respostas públicas da equipe e a resolução do chamado são enviadas de volta na conversa.
- Número já cadastrado como telefone de um usuário do sistema → chamado nasce em nome dessa pessoa; número desconhecido → fica registrado como contato avulso.

## Segurança — pendência conhecida

O webhook ainda **não valida a assinatura `X-Hub-Signature-256`** enviada pela Meta (ver `docs/SECURITY.md`). Como só o caminho específico do webhook fica exposto (o resto do sistema continua interno) e há limite de requisições, o risco é baixo — mas se a integração ficar em uso por muito tempo, vale implementar essa validação. Avise o Rafael se quiser priorizar isso.
