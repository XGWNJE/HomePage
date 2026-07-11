[CmdletBinding()]
param(
    [switch]$IncludeReleaseArtifacts
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [System.IO.Path]::GetFullPath((Resolve-Path (Join-Path $PSScriptRoot '..')).Path)
$rootPrefix = $projectRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$targets = @(
    'dist',
    '.astro',
    'output\playwright',
    'output\chrome-cdp-links',
    'output\chrome-cdp-links-shot',
    'output\chrome-cdp-links-style'
)

if ($IncludeReleaseArtifacts) {
    $targets = @('dist', '.astro', 'output')
}

$removed = @()
foreach ($relativePath in $targets) {
    $target = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $relativePath))
    if (-not $target.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean outside the project root: $target"
    }
    if (-not (Test-Path -LiteralPath $target)) { continue }
    Remove-Item -LiteralPath $target -Recurse -Force
    $removed += $relativePath
}

if (-not $IncludeReleaseArtifacts) {
    foreach ($pattern in @('*.log', '*.pid')) {
        foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'output') -File -Filter $pattern -ErrorAction SilentlyContinue)) {
            $target = [System.IO.Path]::GetFullPath($file.FullName)
            if (-not $target.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Refusing to clean outside the project root: $target"
            }
            Remove-Item -LiteralPath $target -Force
            $removed += "output\$($file.Name)"
        }
    }
}

[ordered]@{
    projectRoot = $projectRoot
    includeReleaseArtifacts = [bool]$IncludeReleaseArtifacts
    removed = $removed
    preserved = if ($IncludeReleaseArtifacts) { @('server-data') } else { @('output\deploy', 'output\content-release', 'server-data') }
} | ConvertTo-Json -Depth 4
