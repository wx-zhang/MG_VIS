$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot 'tyr-data/logs/server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'No saved TYR process.'; exit 0 }
$serverProcessId = [int](Get-Content -LiteralPath $pidFile)
$serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $serverProcessId"
$expectedNode = Join-Path $PSScriptRoot '.local-runtime/node-v22.22.0-win-x64/node.exe'
if ($serverProcess) {
    if ($serverProcess.ExecutablePath -ne $expectedNode -or $serverProcess.CommandLine -notlike '*apps/server/dist/index.js*') { throw 'Saved PID belongs to another process; refusing to stop it.' }
    Stop-Process -Id $serverProcessId
}
Remove-Item -LiteralPath $pidFile
Write-Host 'TYR stopped.'
