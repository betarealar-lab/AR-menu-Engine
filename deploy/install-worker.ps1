# Make the optimiser run by itself, without administrator rights.
#
#   powershell -ExecutionPolicy Bypass -File deploy\install-worker.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\install-worker.ps1 -Remove
#   powershell -ExecutionPolicy Bypass -File deploy\install-worker.ps1 -Status
#
# Drops a launcher in the current user's Startup folder, so worker.py starts at logon and
# keeps watching R2 for dishes that have a master and no shipping files.
#
# WHY NOT TASK SCHEDULER: Register-ScheduledTask needs elevation on this machine, and a
# setup step that fails with "Access is denied" is a setup step nobody completes - which
# is exactly what happened: the installer was never run, nothing was watching, and a
# generated dish sat un-optimised looking broken. The Startup folder needs no rights at
# all, and it is the same outcome.
#
# WHY THIS EXISTS: optimising a raw Meshy master needs ~830 MB, the hosted Studio has
# 512 MB, so it archives the master and correctly refuses the rest. Until the worker
# moves to a container with real memory (ROADMAP 1.1) this machine finishes the job.

param([switch]$Remove, [switch]$Status)

$ErrorActionPreference = 'Stop'
$Repo    = Split-Path -Parent $PSScriptRoot
$Startup = [Environment]::GetFolderPath('Startup')
$Launcher = Join-Path $Startup 'BetaReal-worker.vbs'
$Log     = Join-Path $Repo 'out\worker.log'

function Get-WorkerProcess {
    Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" |
        Where-Object { $_.CommandLine -like '*worker.py*' }
}

if ($Status) {
    "installed : " + (Test-Path $Launcher)
    $p = Get-WorkerProcess
    if ($p) { "running   : yes, pid " + ($p.ProcessId -join ', ') } else { "running   : no" }
    if (Test-Path $Log) {
        "log       : $Log"
        Get-Content $Log -Tail 6 | ForEach-Object { "   $_" }
    }
    return
}

if ($Remove) {
    Remove-Item $Launcher -ErrorAction SilentlyContinue
    Get-WorkerProcess | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    "Removed. Optimising is manual again: python worker.py"
    return
}

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { throw "python is not on PATH." }
# pythonw runs with no console window, so this does not leave a terminal open forever.
$pythonw = $python -replace 'python\.exe$', 'pythonw.exe'
if (-not (Test-Path $pythonw)) { $pythonw = $python }

New-Item -ItemType Directory -Force (Split-Path $Log) | Out-Null

# A .vbs rather than a .bat: WScript.Shell.Run with windowStyle 0 starts it genuinely
# hidden, where a .bat flashes a console every logon.
$vbs = @"
' Starts the BetaReal optimise worker at logon. Written by deploy\install-worker.ps1.
' Delete this file, or run install-worker.ps1 -Remove, to stop it.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$Repo"
sh.Run """$pythonw"" ""$Repo\worker.py"" --log ""$Log""", 0, False
"@
Set-Content -Path $Launcher -Value $vbs -Encoding ASCII

# Start it now as well, so it works this session and not only after the next logon -
# the gap between "installed" and "actually running" is where the last one was lost.
Get-WorkerProcess | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process -FilePath $pythonw `
    -ArgumentList "`"$Repo\worker.py`"", '--log', "`"$Log`"" `
    -WorkingDirectory $Repo -WindowStyle Hidden

Start-Sleep -Seconds 3
$p = Get-WorkerProcess

"Installed."
"  launcher : $Launcher"
"  runs     : $pythonw worker.py"
"  starts   : at every logon, and just now"
if ($p) { "  running  : yes, pid " + ($p.ProcessId -join ', ') }
else     { "  running  : NO - check $Log" }
"  log      : $Log"
""
"Check later:  powershell -ExecutionPolicy Bypass -File deploy\install-worker.ps1 -Status"
"Remove:       powershell -ExecutionPolicy Bypass -File deploy\install-worker.ps1 -Remove"
""
"While this machine is off, generating and judging still work and masters are still"
"archived - new dishes just wait for their shipping files until it is back on."
