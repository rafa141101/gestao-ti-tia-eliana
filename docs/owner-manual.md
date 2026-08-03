# Manual da Diretoria — Gestão TI Tia Eliana

Este manual é para quem **acompanha** a TI, sem precisar aprender a operação técnica.

## Como entrar

1. Abra o navegador em **http://localhost:8090** (ou o endereço interno divulgado pela TI).
2. Entre com seu e-mail e senha. Primeira senha do seed: `Mudar@123` — troque imediatamente: peça a outro Owner/Admin para usar o botão **Redefinir senha** (Administração → Usuários → 🔑) e defina uma senha só sua.
3. Se esquecer a senha: **outro Owner** pode redefinir em Administração → Usuários → 🔑. Um Admin ou a equipe de TI **não** conseguem mexer na conta de um Owner — essa é uma proteção sua.

## O que olhar todo dia — Visão da Diretoria

Menu **Visão da Diretoria**. A primeira tela responde:

- **Agora** — quem está trabalhando, em quê, desde quando, com que prioridade.
- **Cartões** — chamados abertos, sem responsável, SLA vencido, P1, aguardando solicitante/terceiro, tarefas e rotinas atrasadas, idade do backlog. Clique em qualquer cartão para ver a lista por trás do número.
- **Distribuição do trabalho** — horas por tipo (atendimento, desenvolvimento, rotina, reunião, deslocamento…).
- **Indicadores 30 dias** — entradas × saídas, % dentro do SLA, tempo de 1ª resposta, tempo de solução, taxa de reabertura, horas por técnico e por categoria, equipamentos com mais falha, setores que mais solicitam.

> Importante: número de chamados fechados não mede desempenho sozinho. Compare sempre com as horas e o tipo de trabalho.

## Como criar usuários / retirar acessos

Administração → **Usuários**:

- **Novo usuário**: nome, e-mail, senha inicial, perfil, unidade/setor.
- **Retirar acesso**: botão **Inativar** (nunca se apaga usuário — o histórico dele permanece).
- Somente um Owner cria outros Owners/Administradores.
- O sistema **impede** remover o último Owner ativo — você nunca fica trancada para fora.

## Como acompanhar SLAs

- Cartões "SLA vencido"/"P1" na Visão da Diretoria e no Painel Operacional.
- Cada chamado mostra os dois prazos (1ª resposta e solução) com cor e tempo restante.
- Políticas (tempos por prioridade, horário comercial, feriados) em Administração → **Categorias e SLA**. Alterações valem só para chamados novos.

## Como exportar dados

Menu **Relatórios** → canto direito → **Exportar CSV** → escolha (chamados, tempos, projetos, equipamentos, movimentações, auditoria…). O arquivo abre no Excel. Toda exportação fica registrada na auditoria. A empresa consegue retirar todos os dados sem depender de ninguém.

## Como consultar a auditoria

Menu **Auditoria**: quem fez o quê, quando, de onde (IP), com valores antes/depois (clique na linha para expandir). Os registros são **imutáveis** — nem a TI, nem um administrador conseguem apagar ou editar (bloqueado no banco de dados).

## Como fazer backup

Peça à TI para agendar, ou execute na máquina do servidor:

```bash
./scripts/backup.sh
```

Gera dois arquivos em `backups/` (banco + anexos). Guarde-os fora do servidor (HD externo/NAS). **Backup só vale depois de testado**: peça periodicamente um teste de restauração em ambiente separado (`./scripts/restore.sh arquivo.dump`).

## Como recuperar acesso administrativo

1. Outro Owner redefine sua senha (Usuários → 🔑).
2. Se não houver outro Owner disponível, quem tem acesso ao servidor executa (com registro em auditoria via banco):
   ```bash
   docker compose exec api node -e "
   const {PrismaClient}=require('@prisma/client');const bc=require('bcryptjs');
   const p=new PrismaClient();
   p.user.update({where:{email:'diretoria@tiaeliana.com.br'},data:{passwordHash:bc.hashSync('NovaSenha@123',10),failedLogins:0,lockedUntil:null}}).then(()=>{console.log('ok');process.exit(0)});"
   ```
3. O sistema garante que o último Owner ativo nunca é removido ou rebaixado — inclusive contra a própria TI.
