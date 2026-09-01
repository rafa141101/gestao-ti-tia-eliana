# Agente de inventário — Gestão TI

Coleta automaticamente a configuração das máquinas e mantém o inventário atualizado, sem digitação manual.

## O que coleta

Dados **do equipamento**:

- Fabricante, modelo, número de série, hostname
- Processador, memória RAM (com os pentes instalados)
- Discos (SSD/HDD), espaço livre e status de saúde
- Sistema operacional, versão e desde quando está ligada
- IP e MAC da placa de rede
- Antivírus instalado e se está ativo
- Lista de programas instalados

## O que NÃO coleta

**Nada sobre o uso da máquina.** Não captura telas, teclado, sites visitados, arquivos, documentos, e-mails, nem tempo em aplicativos.

Monitoramento de uso de aplicações é outra funcionalidade, que não está implementada e que exigiria — antes de qualquer implementação — política escrita e comunicação prévia aos funcionários (LGPD).

## Requisitos

- Windows 10/11 ou Windows Server (PowerShell 5.1, já vem instalado)
- Acesso de rede ao servidor do Gestão TI
- Token do agente (`AGENT_TOKEN`, definido no `.env` do servidor)

## Instalação em uma máquina

Copie a pasta `agent` para a máquina e execute o PowerShell **como Administrador**:

```powershell
.\instalar-agente.ps1 -ApiUrl "http://192.168.0.247:8090" -Token "SEU_TOKEN"
```

Isso instala em `C:\ProgramData\GestaoTI` e cria uma tarefa agendada que roda **diariamente ao meio-dia e a cada login**. A primeira coleta é executada na hora, e o resultado aparece no final da instalação.

Para mudar o horário: `-Horario "18:30"`.

### Desinstalar

```powershell
.\instalar-agente.ps1 -Desinstalar
```

### Instalação em massa (várias máquinas)

Coloque a pasta `agent` num compartilhamento de rede e distribua via GPO (Configuração do Computador → Scripts de Inicialização) ou rode remotamente:

```powershell
$maquinas = 'PC-EXPEDICAO-01', 'PC-CONFEITARIA-02'
foreach ($m in $maquinas) {
    Invoke-Command -ComputerName $m -ScriptBlock {
        & \\servidor\ti$\agent\instalar-agente.ps1 -ApiUrl "http://192.168.0.247:8090" -Token "SEU_TOKEN"
    }
}
```

## Como a máquina é identificada

O agente casa a coleta com o cadastro do inventário nesta ordem, usando só identificadores **estáveis**:

1. **Número de série** (da BIOS/placa-mãe)
2. **Hostname**
3. **MAC**

O **IP não é usado** para identificar. Com DHCP, o endereço troca de dono — em teste, o IP de um equipamento da planilha já pertencia a outra máquina, o que teria vinculado o cadastro errado. Seriais genéricos que muitas placas devolvem (`None`, `To be filled by O.E.M.`, `Default string`…) também são descartados, senão todas essas máquinas casariam entre si.

### Primeira coleta de máquinas já cadastradas

Os equipamentos importados da planilha não têm número de série nem hostname, então a primeira coleta **não casa sozinha** — a máquina entra no inventário marcada como **"Descoberto automaticamente"**, com um aviso apontando qual cadastro tem aquele mesmo IP.

Na tela do equipamento, o inventariante escolhe:

- **Vincular a cadastro existente** — transfere a coleta para o cadastro certo e inativa o duplicado
- **É uma máquina nova** — marca como conferida

Feito isso uma vez, o hostname fica gravado e todas as coletas seguintes casam sozinhas.

## Verificar se está funcionando

Na máquina:

```powershell
Get-ScheduledTask GestaoTI-Inventario | Get-ScheduledTaskInfo   # última execução e resultado
Get-Content C:\ProgramData\GestaoTI\agente.log -Tail 20         # log
```

No sistema: a tela do equipamento mostra **"Configuração coletada automaticamente"** com a data da última coleta.

## Rodar manualmente (teste)

```powershell
.\gestao-ti-agent.ps1 -ApiUrl "http://192.168.0.247:8090" -Token "SEU_TOKEN"
```

Use `-SkipSoftware` para pular a lista de programas (coleta bem mais rápida).

## Segurança

- O token fica em `C:\ProgramData\GestaoTI\config.json`, com leitura restrita a Administradores e SYSTEM
- O agente só **envia** dados; não recebe comandos nem executa nada vindo do servidor
- Sem `AGENT_TOKEN` configurado no servidor, a coleta fica desligada e os endpoints recusam qualquer envio
- O token é compartilhado entre as máquinas — se vazar, alguém na rede interna conseguiria enviar inventário falso. Para o cenário atual (rede interna) é aceitável; se um dia o sistema for exposto, vale trocar por token por máquina

## Ativar no servidor

No `.env` do servidor:

```env
AGENT_TOKEN=um-valor-longo-e-aleatorio
```

Gere com: `openssl rand -hex 24`. Depois reinicie a API (`docker compose up -d api`).
