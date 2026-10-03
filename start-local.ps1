$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$nodePath = Join-Path $projectRoot '.local-runtime/node-v22.22.0-win-x64/node.exe'
$entryPath = Join-Path $projectRoot 'apps/server/dist/index.js'
$logDir = Join-Path $projectRoot 'tyr-data/logs'
if (-not (Test-Path -LiteralPath $entryPath)) { throw 'Build missing. Run pnpm build first.' }
if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host 'Port 3001 is already in use. Open http://127.0.0.1:3001/ if TYR is already running.'
    exit 1
}
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$serverProcess = Start-Process -FilePath $nodePath -ArgumentList '--env-file=.env.production', 'apps/server/dist/index.js' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'server.log') -RedirectStandardError (Join-Path $logDir 'server-error.log') -PassThru
$serverProcess.Id | Set-Content -LiteralPath (Join-Path $logDir 'server.pid')
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $serverProcess.Refresh()
    if ($serverProcess.HasExited) { throw "Server exited. See $logDir/server-error.log" }
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 2
        if ($health.ok -or $health.data.ok) { Write-Host 'TYR started: http://127.0.0.1:3001/'; exit 0 }
    } catch { }
    Start-Sleep -Seconds 1
}
throw "Startup timed out. See $logDir/server-error.log"
