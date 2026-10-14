# Registra duas tarefas agendadas para o usuário atual:
#   DiarioVozSync        no logon, com 2 min de atraso (o Wi-Fi pode ainda não ter conectado)
#   DiarioVozSync2h      a cada 2 horas, para o PC que fica ligado o dia inteiro
# Rodar sem privilégio de administrador: .\instalar_tarefa.ps1
#
# Usa Register-ScheduledTask em vez de schtasks /tr porque o caminho do projeto
# tem espaço ("Segunda Memoria") e o PowerShell 5.1 perde as aspas internas ao
# repassar argumentos para o schtasks.

$ErrorActionPreference = 'Stop'

$script = Join-Path $PSScriptRoot 'sheet_to_obsidian.py'
$venv = Join-Path $PSScriptRoot '.venv\Scripts\pythonw.exe'
if (Test-Path $venv) {
    $python = $venv          # pythonw: roda sem abrir janela de console
} else {
    $python = (Get-Command py -ErrorAction SilentlyContinue).Source
    if (-not $python) { throw "Nem sync\.venv nem o lançador 'py' foram encontrados. Crie o venv: python -m venv .venv; .venv\Scripts\pip install -r requirements.txt" }
}

$acao = New-ScheduledTaskAction -Execute $python -Argument "`"$script`"" -WorkingDirectory $PSScriptRoot
$usuario = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew

$noLogon = New-ScheduledTaskTrigger -AtLogOn -User $usuario
$noLogon.Delay = 'PT2M'
Register-ScheduledTask -TaskName 'DiarioVozSync' -Action $acao -Trigger $noLogon -Principal $principal `
    -Settings $ajustes -Description 'diario-voz: planilha -> Obsidian (no logon)' -Force | Out-Null

$cada2h = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddHours((Get-Date).Hour + 1) `
    -RepetitionInterval (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName 'DiarioVozSync2h' -Action $acao -Trigger $cada2h -Principal $principal `
    -Settings $ajustes -Description 'diario-voz: planilha -> Obsidian (a cada 2 h)' -Force | Out-Null

Write-Host "Tarefas registradas com $python"
Get-ScheduledTask -TaskName 'DiarioVozSync*' | Select-Object TaskName, State | Format-Table -AutoSize
