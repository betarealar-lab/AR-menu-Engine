# Make the optimiser run by itself.
#
#   powershell -ExecutionPolicy Bypass -File deploy\install-worker.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\install-worker.ps1 -Remove
#
# Registers a Windows scheduled task that starts worker.py when you log in and keeps it
# watching R2 for dishes that have a master and no shipping files. Nothing about it needs
# a window open or a terminal left running.
#
# WHY THIS EXISTS AT ALL: optimising a raw Meshy master needs ~830 MB, and the hosted
# Studio has 512 MB, so it archives the master and correctly refuses the rest. Until the
# worker moves to a container with real memory (ROADMAP 1.1) this machine is the thing
# that finishes the job - and a step somebody has to remember is a step that gets
# forgotten, which is exactly what happened: a dish sat un-optimised and looked broken.
#
# It runs as you, not as SYSTEM, because it needs .env and your Python. It is a normal
# user task; nothing here needs administrator rights.

param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$TaskName = 'BetaReal optimise worker'
$Repo     = Split-Path -Parent $PSScriptRoot
$Log      = Join-Path $Repo 'out\worker.log'

if ($Remove) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        "Removed '$TaskName'. Optimising is manual again: python worker.py"
    } else {
        "'$TaskName' was not registered."
    }
    return
}

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { throw "python is not on PATH. Install it, or edit this script." }

# pythonw runs without a console window, so it does not sit in the taskbar forever.
$pythonw = $python -replace 'python\.exe$', 'pythonw.exe'
if (-not (Test-Path $pythonw)) { $pythonw = $python }

New-Item -ItemType Directory -Force (Split-Path $Log) | Out-Null

$action = New-ScheduledTaskAction -Execute $pythonw `
    -Argument "`"$Repo\worker.py`"" -WorkingDirectory $Repo

# At logon, and every 15 minutes after - because the interesting failure is not "the
# machine restarted", it is "the worker died at 3am and nobody noticed until a dish
# would not ship".
$atLogon  = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RestartInterval (New-TimeSpan -Minutes 15) -RestartCount 999 `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $atLogon `
    -Settings $settings -Description `
    'Optimises BetaReal dishes that the hosted Studio has too little memory to finish.' | Out-Null

Start-ScheduledTask -TaskName $TaskName

"Registered '$TaskName'."
"  runs      : $pythonw $Repo\worker.py"
"  starts    : at logon, restarts every 15 min if it stops"
"  started   : now"
""
"Check it:   Get-ScheduledTask -TaskName '$TaskName'"
"Stop it:    Stop-ScheduledTask -TaskName '$TaskName'"
"Remove it:  powershell -ExecutionPolicy Bypass -File deploy\install-worker.ps1 -Remove"
""
"While your machine is off, generation and judging still work and masters are still"
"archived - new dishes simply wait for shipping files until it is back."
