<#
.SYNOPSIS
    Agente de inventário do Gestão TI — Tia Eliana.

.DESCRIPTION
    Coleta a configuração da máquina e envia para o sistema, para manter o
    inventário atualizado sem digitação manual.

    O QUE COLETA (dados do equipamento):
      - Fabricante, modelo, número de série, hostname
      - Processador, memória RAM (com os pentes instalados)
      - Discos, espaço livre e saúde (SMART)
      - Sistema operacional, versão e última inicialização
      - IP e MAC da placa de rede ativa
      - Antivírus instalado e se está ativo
      - Lista de programas instalados

    O QUE NÃO COLETA:
      Nada sobre o uso da máquina. Não captura telas, teclado, sites visitados,
      arquivos, documentos, e-mails nem tempo em aplicativos. Só o retrato da
      configuração do equipamento.

.PARAMETER ApiUrl
    Endereço do sistema. Ex.: http://192.168.0.247:8090

.PARAMETER Token
    Token do agente (mesmo valor de AGENT_TOKEN no servidor).

.PARAMETER SkipSoftware
    Não envia a lista de programas instalados (coleta mais rápida).

.EXAMPLE
    .\gestao-ti-agent.ps1 -ApiUrl "http://192.168.0.247:8090" -Token "SEU_TOKEN"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ApiUrl,
    [Parameter(Mandatory = $true)][string]$Token,
    [switch]$SkipSoftware
)

$ErrorActionPreference = 'Stop'
$AgentVersion = '1.0'

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [$Level] $Message"
}

# Coleta cada bloco isoladamente: se um falhar (driver antigo, WMI corrompido),
# o restante do inventário ainda é enviado.
function Get-SafeValue {
    param([scriptblock]$Block, $Default = $null)
    try { & $Block } catch { return $Default }
}

Write-Log "Iniciando coleta (agente v$AgentVersion)"

# ---------- Identificação ----------
$cs   = Get-SafeValue { Get-CimInstance Win32_ComputerSystem }
$bios = Get-SafeValue { Get-CimInstance Win32_BIOS }
$os   = Get-SafeValue { Get-CimInstance Win32_OperatingSystem }
$cpu  = Get-SafeValue { Get-CimInstance Win32_Processor | Select-Object -First 1 }

# Placa de rede ativa (a que tem gateway configurado)
$netCfg = Get-SafeValue {
    Get-CimInstance Win32_NetworkAdapterConfiguration |
        Where-Object { $_.IPEnabled -eq $true -and $_.DefaultIPGateway } |
        Select-Object -First 1
}
$ipv4 = if ($netCfg) { ($netCfg.IPAddress | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' } | Select-Object -First 1) } else { $null }

# ---------- Memória ----------
$memModules = Get-SafeValue {
    Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
        [pscustomobject]@{
            capacidadeGB = [math]::Round($_.Capacity / 1GB, 0)
            tipo         = switch ($_.SMBIOSMemoryType) { 26 { 'DDR4' } 34 { 'DDR5' } 24 { 'DDR3' } default { "Tipo $($_.SMBIOSMemoryType)" } }
            velocidade   = $_.Speed
            fabricante   = $_.Manufacturer
            slot         = $_.DeviceLocator
        }
    }
} @()

# ---------- Discos ----------
# MSFT_PhysicalDisk informa se é SSD ou HDD; nem todo driver/Windows expõe.
# Consultado uma vez e casado com Win32_DiskDrive pelo índice do dispositivo.
$physicalDisks = Get-SafeValue { @(Get-CimInstance -Namespace root\Microsoft\Windows\Storage MSFT_PhysicalDisk) } @()

$disks = Get-SafeValue {
    Get-CimInstance Win32_DiskDrive | ForEach-Object {
        $drive = $_
        $tipo = 'Desconhecido'
        $phys = $physicalDisks | Where-Object { $_.DeviceId -eq [string]$drive.Index } | Select-Object -First 1
        if ($phys) {
            $tipo = switch ($phys.MediaType) { 3 { 'HDD' } 4 { 'SSD' } 5 { 'SCM' } default { 'Desconhecido' } }
        }
        [pscustomobject]@{
            modelo    = $drive.Model
            serie     = ("$($drive.SerialNumber)" -replace '\s', '')
            tamanhoGB = [math]::Round($drive.Size / 1GB, 0)
            tipo      = $tipo
            saude     = $drive.Status
        }
    }
} @()

$volumes = Get-SafeValue {
    Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
        [pscustomobject]@{
            unidade   = $_.DeviceID
            totalGB   = [math]::Round($_.Size / 1GB, 1)
            livreGB   = [math]::Round($_.FreeSpace / 1GB, 1)
            livrePct  = if ($_.Size -gt 0) { [math]::Round(($_.FreeSpace / $_.Size) * 100, 1) } else { 0 }
        }
    }
} @()

# ---------- Antivírus ----------
$antivirus = Get-SafeValue {
    Get-CimInstance -Namespace root\SecurityCenter2 AntiVirusProduct | ForEach-Object {
        # productState: bit 0x1000 = ativo; 0x10 = assinaturas desatualizadas
        $state = $_.productState
        [pscustomobject]@{
            nome         = $_.displayName
            ativo        = (($state -band 0x1000) -ne 0)
            atualizado   = (($state -band 0x10) -eq 0)
        }
    }
} @()

# ---------- Programas instalados ----------
$softwares = @()
if (-not $SkipSoftware) {
    $softwares = Get-SafeValue {
        $paths = @(
            'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
        )
        Get-ItemProperty $paths -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ReleaseType } |
            ForEach-Object {
                $data = $null
                if ($_.InstallDate -and $_.InstallDate -match '^\d{8}$') {
                    $data = [datetime]::ParseExact($_.InstallDate, 'yyyyMMdd', $null).ToString('o')
                }
                [pscustomobject]@{
                    name        = "$($_.DisplayName)".Trim()
                    version     = if ($_.DisplayVersion) { "$($_.DisplayVersion)".Trim() } else { $null }
                    publisher   = if ($_.Publisher) { "$($_.Publisher)".Trim() } else { $null }
                    installedAt = $data
                }
            } |
            Sort-Object name, version -Unique |
            Select-Object -First 1000
    } @()
    Write-Log "Programas instalados encontrados: $($softwares.Count)"
}

# ---------- Monta o pacote ----------
$payload = @{
    agentVersion = $AgentVersion
    hostname     = $env:COMPUTERNAME
    serialNumber = if ($bios) { "$($bios.SerialNumber)".Trim() } else { $null }
    mac          = if ($netCfg) { $netCfg.MACAddress } else { $null }
    ip           = $ipv4
    os           = if ($os) { "$($os.Caption) $($os.Version)".Trim() } else { $null }
    manufacturer = if ($cs) { "$($cs.Manufacturer)".Trim() } else { $null }
    model        = if ($cs) { "$($cs.Model)".Trim() } else { $null }
    specs        = @{
        processador       = if ($cpu) { $cpu.Name.Trim() } else { $null }
        nucleos           = if ($cpu) { $cpu.NumberOfCores } else { $null }
        threads           = if ($cpu) { $cpu.NumberOfLogicalProcessors } else { $null }
        memoriaTotalGB    = if ($cs) { [math]::Round($cs.TotalPhysicalMemory / 1GB, 0) } else { $null }
        # @() força lista mesmo com 1 item — sem isso o ConvertTo-Json gera objeto
        memoriaModulos    = @($memModules)
        discos            = @($disks)
        volumes           = @($volumes)
        antivirus         = @($antivirus)
        biosVersao        = if ($bios) { $bios.SMBIOSBIOSVersion } else { $null }
        dominio           = if ($cs) { $cs.Domain } else { $null }
        ultimaInicializacao = if ($os) { $os.LastBootUpTime.ToString('o') } else { $null }
        coletadoEm        = (Get-Date).ToString('o')
    }
    softwares = $softwares
}

# ---------- Envia ----------
$json = $payload | ConvertTo-Json -Depth 6 -Compress
Write-Log "Enviando $([math]::Round($json.Length / 1KB, 1)) KB para $ApiUrl"

try {
    $response = Invoke-RestMethod -Uri "$ApiUrl/api/agent/report" -Method Post `
        -Headers @{ 'X-Agent-Token' = $Token } `
        -ContentType 'application/json; charset=utf-8' `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) `
        -TimeoutSec 60

    if ($response.created) {
        Write-Log "Máquina NOVA cadastrada no inventário (id $($response.assetId)) — confira o cadastro no sistema." 'OK'
    } else {
        Write-Log "Inventário atualizado (casou por: $($response.matchedBy))" 'OK'
    }
    exit 0
}
catch {
    Write-Log "Falha ao enviar: $($_.Exception.Message)" 'ERRO'
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Log "Resposta do servidor: $($reader.ReadToEnd())" 'ERRO'
    }
    exit 1
}
