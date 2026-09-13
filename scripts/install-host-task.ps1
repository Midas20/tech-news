# Registers the "NewsTrack" scheduled task that keeps the site up on this host.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-host-task.ps1
#
# Run once, elevated. It is idempotent: an existing task is replaced.
#
# The task runs scripts\host.mjs at boot and again every five minutes; host.mjs
# exits at once when a supervisor is already alive, so the repetition only
# matters when the supervisor itself has died.
#
# S4U, NOT SYSTEM. The task runs as the account that installed it, without a
# stored password and whether or not anyone is logged on. SYSTEM would work too,
# but it has a different profile, and every file the app writes -- server.log,
# the lock -- would then belong to an account nobody logs in as.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$user = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction -Execute $node -Argument 'scripts\host.mjs' -WorkingDirectory $root
$triggers = @(
  (New-ScheduledTaskTrigger -AtStartup),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5))
)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName 'NewsTrack' -Action $action -Trigger $triggers `
  -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'NewsTrack'
Write-Output "NewsTrack task registered for $user and started: $node scripts\host.mjs in $root"
