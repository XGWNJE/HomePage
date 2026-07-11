[CmdletBinding()]
param(
    [switch]$PlanOnly,
    [string]$ServerInfraRoot = 'D:\ObjectCode\Server-infra'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$serverEnvPath = Join-Path $ServerInfraRoot 'server.local.env'
$maintainScript = Join-Path $ServerInfraRoot 'scripts\maintain.ps1'
$remoteHelper = Join-Path $projectRoot '.agents\skills\deploy-homepage\scripts\deploy-frontend.sh'
$outputRoot = Join-Path $projectRoot 'output\content-release'

function Read-DotEnv {
    param([Parameter(Mandatory)][string]$Path)

    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if ($line -notmatch '^([^#=]+)=(.*)$') { continue }
        $key = $matches[1].Trim()
        $value = $matches[2].Trim()
        if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $values[$key] = $value
    }
    return $values
}

function Invoke-Native {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$Arguments
    )

    $output = & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
    return @($output)
}

function ConvertTo-BashLiteral {
    param([Parameter(Mandatory)][string]$Value)
    $singleQuote = [char]39
    $doubleQuote = [char]34
    $escapedQuote = [string]::Concat($singleQuote, $doubleQuote, $singleQuote, $doubleQuote, $singleQuote)
    return [string]::Concat($singleQuote, $Value.Replace([string]$singleQuote, $escapedQuote), $singleQuote)
}

function Get-GitStatusPaths {
    $paths = @()
    foreach ($line in @(& git -C $projectRoot status --porcelain=v1)) {
        if ($line.Length -lt 4) { continue }
        $statusPath = $line.Substring(3)
        if ($statusPath.Contains(' -> ')) {
            $paths += $statusPath.Split(@(' -> '), [System.StringSplitOptions]::RemoveEmptyEntries)
        } else {
            $paths += $statusPath
        }
    }
    return $paths
}

function Test-PublicUrl {
    param(
        [Parameter(Mandatory)][string]$Url,
        [int]$ExpectedStatus = 200
    )

    $status = (& curl.exe --silent --show-error --location --output NUL --write-out '%{http_code}' --max-time 15 $Url).Trim()
    if ($LASTEXITCODE -ne 0 -or $status -ne [string]$ExpectedStatus) {
        throw "Probe failed: $Url expected $ExpectedStatus, received $status"
    }
}

if (-not (Test-Path -LiteralPath $serverEnvPath -PathType Leaf)) {
    throw "Missing server inventory: $serverEnvPath"
}
if (-not (Test-Path -LiteralPath $maintainScript -PathType Leaf)) {
    throw "Missing Server-infra maintenance entrypoint: $maintainScript"
}
if (-not (Test-Path -LiteralPath $remoteHelper -PathType Leaf)) {
    throw "Missing remote deployment helper: $remoteHelper"
}

$gitRoot = (& git -C $projectRoot rev-parse --show-toplevel).Trim()
if ([System.IO.Path]::GetFullPath($gitRoot) -ne [System.IO.Path]::GetFullPath($projectRoot)) {
    throw "Unexpected Git root: $gitRoot"
}

$workingPaths = @(Get-GitStatusPaths)
if ($workingPaths.Count -gt 0) {
    throw "Content publishing requires a clean worktree. Commit the article and its images first. Dirty paths: $($workingPaths -join ', ')"
}

$server = Read-DotEnv -Path $serverEnvPath
$requiredKeys = @('VPS_IP', 'SSH_USER', 'SSH_PORT', 'SSH_KEY_PATH')
$missingKeys = @($requiredKeys | Where-Object { -not $server.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($server[$_]) })
if ($missingKeys.Count -gt 0) {
    throw "Server inventory is missing required keys: $($missingKeys -join ', ')"
}
if (-not (Test-Path -LiteralPath $server['SSH_KEY_PATH'] -PathType Leaf)) {
    throw "SSH key does not exist: $($server['SSH_KEY_PATH'])"
}

$sshTarget = "$($server['SSH_USER'])@$($server['VPS_IP'])"
$sshArgs = @(
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=yes',
    '-p', $server['SSH_PORT'],
    '-i', $server['SSH_KEY_PATH']
)
$scpArgs = @(
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=yes',
    '-P', $server['SSH_PORT'],
    '-i', $server['SSH_KEY_PATH']
)

function Invoke-Remote {
    param([Parameter(Mandatory)][string]$Command)
    return Invoke-Native -FilePath 'ssh.exe' -Arguments ($sshArgs + @($sshTarget, $Command.Replace("`r", '')))
}

$metadataCommand = @'
set -eu
release_id="$(basename "$(readlink -f /var/www/xgwnje-home.releases/current)")"
manifest="$(find "/var/www/xgwnje-home.releases/${release_id}" -maxdepth 1 -type f -name 'release-manifest-*.json' | head -n 1)"
test -n "$manifest"
cat "$manifest"
'@
$production = ((Invoke-Remote -Command $metadataCommand) -join "`n") | ConvertFrom-Json
$productionRevision = [string]$production.revision
$previousRelease = [string]$production.releaseId

& git -C $projectRoot cat-file -e "$productionRevision`^{commit}"
if ($LASTEXITCODE -ne 0) {
    throw "Production revision is not available locally: $productionRevision"
}

$changedPaths = @(& git -C $projectRoot diff --name-only "$productionRevision..HEAD")
$env:CONTENT_RELEASE_PATHS_JSON = ConvertTo-Json -Compress -InputObject $changedPaths
try {
    $scopeJson = (& node (Join-Path $projectRoot 'scripts\content-release-scope.mjs')) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Content release scope classifier failed.' }
    $scope = $scopeJson | ConvertFrom-Json
} finally {
    Remove-Item Env:CONTENT_RELEASE_PATHS_JSON -ErrorAction SilentlyContinue
}

if (-not $scope.eligible) {
    $rejected = @($scope.rejectedPaths) -join ', '
    throw "Content fast lane rejected this release. Only src/content/blog/** and public/image/blog/** are allowed. Rejected: $rejected"
}

Push-Location $projectRoot
try {
    Invoke-Native -FilePath 'npm.cmd' -Arguments @('run', 'content:check') | Out-Host
} finally {
    Pop-Location
}

$distRoot = Join-Path $projectRoot 'dist'
foreach ($route in @($scope.routes)) {
    $relative = if ($route -eq '/') { 'index.html' } elseif ($route.EndsWith('/')) { Join-Path $route.Trim('/') 'index.html' } else { $route.Trim('/') }
    if (-not (Test-Path -LiteralPath (Join-Path $distRoot $relative) -PathType Leaf)) {
        throw "Built content route is missing: $route ($relative)"
    }
}

$head = (& git -C $projectRoot rev-parse HEAD).Trim()
$headShort = (& git -C $projectRoot rev-parse --short=7 HEAD).Trim()
$releaseId = "$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))-content-$headShort"
$artifactDir = Join-Path $outputRoot $releaseId

if ($PlanOnly) {
    [ordered]@{
        mode = 'ContentOnly'
        planOnly = $true
        productionRelease = $previousRelease
        productionRevision = $productionRevision
        revision = $head
        changedPaths = @($scope.paths)
        routes = @($scope.routes)
    } | ConvertTo-Json -Depth 5
    exit 0
}

$branch = (& git -C $projectRoot branch --show-current).Trim()
if ($branch -ne 'main') {
    throw "Content publishing requires the main branch. Current branch: $branch"
}
$remoteMainLine = @(& git -C $projectRoot ls-remote --heads origin refs/heads/main) | Select-Object -First 1
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($remoteMainLine)) {
    throw 'Unable to resolve origin/main before content publishing.'
}
$remoteMainRevision = ($remoteMainLine -split '\s+')[0]
if ($remoteMainRevision -ne $head) {
    throw "Push the committed article to origin/main before publishing. Local HEAD: $head; origin/main: $remoteMainRevision"
}

New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null

Test-PublicUrl -Url 'https://xgwnje.cn/'
Test-PublicUrl -Url 'https://api.xgwnje.cn/health'

$archiveName = "homepage-frontend-$releaseId.tar.gz"
$manifestName = "release-manifest-$releaseId.json"
$archivePath = Join-Path $artifactDir $archiveName
$manifestPath = Join-Path $artifactDir $manifestName
$sumsPath = Join-Path $artifactDir 'SHA256SUMS'

Invoke-Native -FilePath 'tar.exe' -Arguments @('-czf', $archivePath, '-C', $distRoot, '.') | Out-Null
$files = @(Get-ChildItem -LiteralPath $distRoot -Recurse -File)
$fileCount = $files.Count
$totalBytes = ($files | Measure-Object Length -Sum).Sum
$archiveSha = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$indexSha = (Get-FileHash -LiteralPath (Join-Path $distRoot 'index.html') -Algorithm SHA256).Hash.ToLowerInvariant()

$manifest = [ordered]@{
    releaseId = $releaseId
    scope = 'content-only'
    revision = $head
    productionBaseRevision = $productionRevision
    branch = $branch
    gitStatus = 'clean'
    builtAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    changedPaths = @($scope.paths)
    affectedRoutes = @($scope.routes)
    environment = [ordered]@{
        node = (& node --version).Trim()
        npm = (& npm --version).Trim()
    }
    frontend = [ordered]@{
        archive = $archiveName
        sha256 = $archiveSha
        fileCount = $fileCount
        totalBytes = $totalBytes
        indexSha256 = $indexSha
    }
    backend = [ordered]@{
        deployed = $false
        currentRevision = [string]$production.backend.currentRevision
    }
}
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 8), $utf8NoBom)
$manifestSha = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
$sumText = "$archiveSha  $archiveName`n$manifestSha  $manifestName`n"
[System.IO.File]::WriteAllText($sumsPath, $sumText, $utf8NoBom)

$remoteStaging = "/tmp/homepage-release-$releaseId"
Invoke-Remote -Command "set -eu; mkdir -p $(ConvertTo-BashLiteral $remoteStaging)" | Out-Host
Invoke-Native -FilePath 'scp.exe' -Arguments ($scpArgs + @(
    $archivePath,
    $manifestPath,
    $sumsPath,
    $remoteHelper,
    "$sshTarget`:$remoteStaging/"
)) | Out-Host

$helperPath = "$remoteStaging/deploy-frontend.sh"
$quoted = @($releaseId, $archiveSha, [string]$fileCount, [string]$totalBytes, $indexSha, $previousRelease) | ForEach-Object { ConvertTo-BashLiteral $_ }
$prepare = "bash $(ConvertTo-BashLiteral $helperPath) prepare $($quoted -join ' ')"
$activate = "bash $(ConvertTo-BashLiteral $helperPath) activate $($quoted -join ' ')"
$rollback = "bash $(ConvertTo-BashLiteral $helperPath) rollback $($quoted -join ' ')"

$activated = $false
try {
    Invoke-Remote -Command $prepare | Out-Host
    Invoke-Remote -Command $activate | Out-Host
    $activated = $true

    foreach ($route in @($scope.routes)) {
        Test-PublicUrl -Url ("https://xgwnje.cn" + $route)
    }
    Test-PublicUrl -Url 'https://api.xgwnje.cn/health'
    Test-PublicUrl -Url ("https://xgwnje.cn/__content-release-probe-$releaseId") -ExpectedStatus 404

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File $maintainScript -Mode AfterChange -Scope homepage,homepage-api | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Server-infra AfterChange failed.' }
    Invoke-Remote -Command "rm -rf $(ConvertTo-BashLiteral $remoteStaging)" | Out-Null
} catch {
    if ($activated) {
        Invoke-Remote -Command $rollback | Out-Host
        powershell.exe -NoProfile -ExecutionPolicy Bypass -File $maintainScript -Mode AfterChange -Scope homepage,homepage-api | Out-Host
    }
    throw
}

[ordered]@{
    mode = 'ContentOnly'
    releaseId = $releaseId
    revision = $head
    previousRelease = $previousRelease
    archiveSha256 = $archiveSha
    manifestSha256 = $manifestSha
    backup = "/var/www/xgwnje-home.backup-$releaseId"
    rollback = "bash /var/www/xgwnje-home.releases/$releaseId/deploy-frontend.sh rollback $releaseId $archiveSha $fileCount $totalBytes $indexSha $previousRelease"
    changedPaths = @($scope.paths)
    verifiedRoutes = @($scope.routes)
} | ConvertTo-Json -Depth 6
