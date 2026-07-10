[CmdletBinding()]
param(
    [switch]$AllowDirty,
    [switch]$SkipVerify,
    [string]$ServerInfraRoot = 'D:\ObjectCode\Server-infra'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$requiredProjectFiles = @('package.json', 'package-lock.json', 'server\package.json', 'server\package-lock.json', 'AGENTS.md')
foreach ($relativePath in $requiredProjectFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relativePath) -PathType Leaf)) {
        throw "Missing required project file: $relativePath"
    }
}

$gitRoot = (& git -C $projectRoot rev-parse --show-toplevel).Trim()
if ([System.IO.Path]::GetFullPath($gitRoot) -ne [System.IO.Path]::GetFullPath($projectRoot)) {
    throw "Unexpected Git root: $gitRoot"
}

$statusLines = @(& git -C $projectRoot status --porcelain=v1)
$isDirty = $statusLines.Count -gt 0
if ($isDirty -and -not $AllowDirty) {
    throw 'Working tree is dirty. Commit/stash it, or use -AllowDirty only after explicit user authorization.'
}

$serverEnvPath = Join-Path $ServerInfraRoot 'server.local.env'
if (-not (Test-Path -LiteralPath $serverEnvPath -PathType Leaf)) {
    throw "Missing server inventory: $serverEnvPath"
}

$envText = Get-Content -LiteralPath $serverEnvPath -Encoding UTF8 -Raw
$requiredServerKeys = @('VPS_IP', 'SSH_USER', 'SSH_PORT', 'SSH_PASSWORD')
$missingKeys = @($requiredServerKeys | Where-Object { $envText -notmatch "(?m)^$([regex]::Escape($_))=" })
if ($missingKeys.Count -gt 0) {
    throw "Server inventory is missing required keys: $($missingKeys -join ', ')"
}

Push-Location $projectRoot
try {
    if (-not $SkipVerify) {
        & npm run verify
        if ($LASTEXITCODE -ne 0) {
            throw "npm run verify failed with exit code $LASTEXITCODE"
        }
    }

    $result = [ordered]@{
        projectRoot = $projectRoot
        branch = (& git branch --show-current).Trim()
        commit = (& git rev-parse HEAD).Trim()
        dirty = $isDirty
        changedPaths = @($statusLines)
        node = (& node --version).Trim()
        npm = (& npm --version).Trim()
        serverInventory = $serverEnvPath
        serverKeysPresent = $requiredServerKeys
        verification = if ($SkipVerify) { 'skipped' } else { 'passed' }
    }
    $result | ConvertTo-Json -Depth 4
} finally {
    Pop-Location
}
