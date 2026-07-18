[CmdletBinding()]
param(
    [ValidateSet('ContentOnly', 'FastFrontend', 'FullAudit')]
    [string]$Mode = 'FastFrontend',
    [switch]$AllowDirty,
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

$serverValues = @{}
foreach ($line in Get-Content -LiteralPath $serverEnvPath -Encoding UTF8) {
    if ($line -notmatch '^([^#=]+)=(.*)$') { continue }
    $key = $matches[1].Trim()
    $value = $matches[2].Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    $serverValues[$key] = $value
}
$requiredServerKeys = @('VPS_IP', 'SSH_USER', 'SSH_PORT', 'SSH_KEY_PATH')
$missingKeys = @($requiredServerKeys | Where-Object { -not $serverValues.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($serverValues[$_]) })
if ($missingKeys.Count -gt 0) {
    throw "Server inventory is missing required keys: $($missingKeys -join ', ')"
}
if (-not (Test-Path -LiteralPath $serverValues['SSH_KEY_PATH'] -PathType Leaf)) {
    throw 'Configured SSH key does not exist.'
}

Push-Location $projectRoot
try {
    $verificationCommands = switch ($Mode) {
        'ContentOnly' { @('npm run content:check') }
        'FullAudit' { @('npm run verify') }
        default {
            @(
                'npm run test:ui-reuse',
                'npm run typecheck',
                'npm run build'
            )
        }
    }

    foreach ($command in $verificationCommands) {
        & cmd.exe /d /s /c $command
        if ($LASTEXITCODE -ne 0) {
            throw "$command failed with exit code $LASTEXITCODE"
        }
    }

    $result = [ordered]@{
        mode = $Mode
        projectRoot = $projectRoot
        branch = (& git branch --show-current).Trim()
        commit = (& git rev-parse HEAD).Trim()
        dirty = $isDirty
        changedPaths = @($statusLines)
        node = (& node --version).Trim()
        npm = (& npm --version).Trim()
        serverInventory = $serverEnvPath
        serverKeysPresent = $requiredServerKeys
        verification = 'passed'
        verificationCommands = $verificationCommands
    }
    $result | ConvertTo-Json -Depth 4
} finally {
    Pop-Location
}
