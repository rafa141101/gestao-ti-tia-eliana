<#
.SYNOPSIS
    Instala o agente de inventário do Gestão TI como tarefa agendada.

.DESCRIPTION
    Copia o agente para C:\ProgramData\GestaoTI e cria uma tarefa que roda
    diariamente (e no login), enviando o inventário da máquina para o sistema.

    Precisa ser executado como Administrador.

.EXAMPLE
    .\instalar-agente.ps1 -ApiUrl "http://192.168.0.247:8090" -Token "SEU_TOKEN"

.EXAMPLE
    # Desinstalar
    .\instalar-agente.ps1 -Desinstalar
#>

[CmdletBinding()]
param(
    [string]$ApiUrl,
    [string]$Token,
    [string]$Horario = '12:00',
    [switch]$Desinstalar
)

$ErrorActionPreference = 'Stop'
$TaskName    = 'GestaoTI-Inventario'
$InstallDir  = "$env:ProgramData\GestaoTI"
$AgentPath   = "$InstallDir\gestao-ti-agent.ps1"

# Precisa de administrador para criar tarefa em nome do SYSTEM
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "Execute este script como Administrador (clique direito no PowerShell > Executar como administrador)."
    exit 1
}

if ($Desinstalar) {
    Write-Host "Removendo tarefa agendada..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
    Write-Host "Agente removido desta máquina." -ForegroundColor Green
    exit 0
}

if (-not $ApiUrl -or -not $Token) {
    Write-Error "Informe -ApiUrl e -Token. Ex.: .\instalar-agente.ps1 -ApiUrl 'http://192.168.0.247:8090' -Token 'xxx'"
    exit 1
}

# ---------- Copia o agente ----------
Write-Host "Instalando em $InstallDir..."
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

$origem = Join-Path $PSScriptRoot 'gestao-ti-agent.ps1'
if (-not (Test-Path $origem)) {
    Write-Error "gestao-ti-agent.ps1 não encontrado na mesma pasta deste instalador."
    exit 1
}
Copy-Item $origem $AgentPath -Force

# Guarda a configuração fora do script, com leitura restrita a Administradores/SYSTEM
$configPath = "$InstallDir\config.json"
@{ ApiUrl = $ApiUrl; Token = $Token } | ConvertTo-Json | Set-Content $configPath -Encoding UTF8

$acl = Get-Acl $configPath
$acl.SetAccessRuleProtection($true, $false)   # remove permissões herdadas
$acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('SYSTEM', 'FullControl', 'Allow')))
$acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('Administradores', 'FullControl', 'Allow'))) 2>$null
$acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('Administrators', 'FullControl', 'Allow'))) 2>$null
Set-Acl $configPath $acl

# ---------- Wrapper que lê a config e chama o agente ----------
$wrapperPath = "$InstallDir\executar.ps1"
@"
`$cfg = Get-Content '$configPath' -Raw | ConvertFrom-Json
& '$AgentPath' -ApiUrl `$cfg.ApiUrl -Token `$cfg.Token *>> '$InstallDir\agente.log'
# Mantém o log enxuto (últimas 500 linhas)
if (Test-Path '$InstallDir\agente.log') {
    `$linhas = Get-Content '$InstallDir\agente.log' -Tail 500
    Set-Content '$InstallDir\agente.log' `$linhas
}
"@ | Set-Content $wrapperPath -Encoding UTF8

# ---------- Tarefa agendada ----------
Write-Host "Criando tarefa agendada '$TaskName' (diária às $Horario e no login)..."
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$wrapperPath`""

$triggers = @(
    (New-ScheduledTaskTrigger -Daily -At $Horario),
    (New-ScheduledTaskTrigger -AtLogOn)
)

$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
    -Principal $principal -Settings $settings `
    -Description 'Envia o inventário desta máquina (hardware e programas instalados) para o Gestão TI.' | Out-Null

Write-Host "`nInstalado com sucesso." -ForegroundColor Green
Write-Host "Executando a primeira coleta agora..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 20

if (Test-Path "$InstallDir\agente.log") {
    Write-Host "`n--- Resultado da primeira coleta ---"
    Get-Content "$InstallDir\agente.log" -Tail 6
}

Write-Host "`nLog em: $InstallDir\agente.log"
Write-Host "Para desinstalar: .\instalar-agente.ps1 -Desinstalar"
