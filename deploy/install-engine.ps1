# Make the whole engine run by itself on this machine, without administrator rights.
#
#   powershell -ExecutionPolicy Bypass -File deploy\install-engine.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\install-engine.ps1 -Status
#   powershell -ExecutionPolicy Bypass -File deploy\install-engine.ps1 -Remove
#
# ── why this replaces install-worker.ps1 ──────────────────────────────────────────────
#
# On 2026-09-08 Temo pressed Build, waited ten minutes and nothing happened. The request
# sat at `approved` in Postgres, the engine queue was empty, and the worker was up and
# healthy. Three separate things were missing, and every one of them was silent:
#
#   1. NOTHING WAS RUNNING THE BRIDGE. `menu/model_requests.py` is the only code that
#      knows both halves - it turns an approved request into a queue job and a finished
#      job into a model. The old installer never started it, so a request could be
#      approved forever and no job would ever exist.
#
#   2. THE WORKER DID NOT CLAIM GENERATION. `worker.py` claims optimise jobs only unless
#      given `--generate`, and the old launcher did not pass it. So even with a bridge,
#      the generate job would have sat in the queue with nobody to take it.
#
#   3. IT HELD A STALE SECRET. The worker reads `.env` once, at startup. After the R2
#      token was rolled that afternoon the running process kept the old secret in memory
#      and failed **203 consecutive passes** with SignatureDoesNotMatch, writing one line
#      per failure into a log nobody was watching, never exiting, never alerting.
#
# So: two launchers instead of one, `--generate` on the worker, and a `-Status` that
# actually looks at the log for repeated failures instead of printing the last six lines
# and calling it health.
#
# WHY NOT TASK SCHEDULER: Register-ScheduledTask needs elevation on this machine, and a
# setup step that fails with "Access is denied" is a setup step nobody completes - which
# is exactly what happened the first time. The Startup folder needs no rights at all.
param([switch]$Remove, [switch]$Status)

$ErrorActionPreference = 'Stop'
$Repo    = Split-Path -Parent $PSScriptRoot
$Startup = [Environment]::GetFolderPath('Startup')

# Two processes, because they fail differently and restart independently. The worker does
# the heavy, memory-hungry work; the bridge does small database passes. One dying should
# not take the other with it.
$Parts = @(
  @{ Name = 'worker'
     Launcher = Join-Path $Startup 'BetaReal-worker.vbs'
     Script = 'worker.py'
     Args = @('--generate')
     Log = Join-Path $Repo 'out\worker.log'
     Match = '*worker.py*'
     Does = 'claims generate + optimise jobs off the queue' }
  @{ Name = 'bridge'
     Launcher = Join-Path $Startup 'BetaReal-bridge.vbs'
     Script = 'menu\model_requests.py'
     Args = @('--watch')
     Log = Join-Path $Repo 'out\bridge.log'
     Match = '*model_requests.py*'
     Does = 'approved request -> queue job -> model on the menu' }
)

# The old single-worker launcher, so an upgrade removes it rather than leaving a second
# worker running WITHOUT --generate alongside the new one.
$LegacyLauncher = Join-Path $Startup 'BetaReal-worker.vbs'

function Get-Proc([string]$match) {
    Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" |
        Where-Object { $_.CommandLine -like $match }
}

if ($Status) {
    foreach ($p in $Parts) {
        $procs = Get-Proc $p.Match
        "$($p.Name):"
        "  installed : " + (Test-Path $p.Launcher)
        if ($procs) { "  running   : yes, pid " + ($procs.ProcessId -join ', ') }
        else        { "  running   : NO" }
        if (Test-Path $p.Log) {
            # The number that matters. A worker that has failed its last fifty passes is
            # not "running", and the old -Status called it running because the process
            # existed. Repeated identical errors are how a stale secret looks.
            #
            # Only THIS run's lines, though. The log is append-only, so counting the last
            # 60 lines flat reports failures from a previous process that has already been
            # restarted and fixed - which this check did on its very first use. A health
            # signal that is wrong when things are fine is a health signal nobody reads.
            $all   = Get-Content $p.Log -Tail 400
            $start = [Array]::LastIndexOf([string[]]$all, ($all | Where-Object { $_ -match '=== .*started' } | Select-Object -Last 1))
            $tail  = if ($start -ge 0) { $all[$start..($all.Count - 1)] } else { $all }
            $tail  = $tail | Select-Object -Last 60
            $bad  = @($tail | Where-Object { $_ -match 'pass failed|FAILED \(dead\)|Traceback' })
            if ($bad.Count -ge 10) {
                "  health    : UNHEALTHY - $($bad.Count) of the last 60 lines are failures"
                "              " + ($bad[-1] -replace '^\s+', '')
                "              If the R2 or Supabase keys were rotated, RESTART it: the"
                "              process read .env once, at startup."
            } elseif ($bad.Count -gt 0) {
                "  health    : $($bad.Count) recent failures - probably transient"
            } else {
                "  health    : no failures in the last 60 lines"
            }
            "  log       : $($p.Log)"
        }
        ""
    }
    return
}

if ($Remove) {
    foreach ($p in $Parts) {
        Remove-Item $p.Launcher -ErrorAction SilentlyContinue
        Get-Proc $p.Match | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    }
    "Removed. Building a model is manual again:"
    "  python worker.py --generate"
    "  python menu\model_requests.py --watch"
    return
}

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { throw "python is not on PATH." }
# pythonw runs with no console window, so this does not leave two terminals open forever.
$pythonw = $python -replace 'python\.exe$', 'pythonw.exe'
if (-not (Test-Path $pythonw)) { $pythonw = $python }

New-Item -ItemType Directory -Force (Join-Path $Repo 'out') | Out-Null

foreach ($p in $Parts) {
    $argLine = ($p.Args | ForEach-Object { $_ }) -join ' '

    # A .vbs rather than a .bat: WScript.Shell.Run with windowStyle 0 starts it genuinely
    # hidden, where a .bat flashes a console at every logon.
    $vbs = @"
' Starts the BetaReal $($p.Name) at logon. Written by deploy\install-engine.ps1.
' $($p.Does)
' Delete this file, or run install-engine.ps1 -Remove, to stop it.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$Repo"
sh.Run """$pythonw"" ""$Repo\$($p.Script)"" $argLine --log ""$($p.Log)""", 0, False
"@
    Set-Content -Path $p.Launcher -Value $vbs -Encoding ASCII

    # Restart rather than start: the gap between "installed" and "actually running the
    # NEW command line" is where the last one was lost - a worker was up, so it looked
    # fine, and it was the old one without --generate and with the pre-rotation secret.
    Get-Proc $p.Match | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    $startArgs = @("`"$Repo\$($p.Script)`"") + $p.Args + @('--log', "`"$($p.Log)`"")
    Start-Process -FilePath $pythonw -ArgumentList $startArgs `
        -WorkingDirectory $Repo -WindowStyle Hidden
}

Start-Sleep -Seconds 4

"Installed."
foreach ($p in $Parts) {
    $procs = Get-Proc $p.Match
    "  $($p.Name.PadRight(7)) $($p.Does)"
    if ($procs) { "          running, pid " + ($procs.ProcessId -join ', ') }
    else        { "          NOT RUNNING - check $($p.Log)" }
}
""
"Both start at every logon, and just started now."
""
"Check later:  powershell -ExecutionPolicy Bypass -File deploy\install-engine.ps1 -Status"
"Remove:       powershell -ExecutionPolicy Bypass -File deploy\install-engine.ps1 -Remove"
""
"AFTER ROTATING ANY KEY, run this script again. Both processes read .env once at"
"startup, so a rotated secret does not reach a process that is already running - it"
"just fails every pass, quietly, until somebody reads the log."
