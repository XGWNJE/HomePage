[CmdletBinding()]
param(
    [switch]$SkipPreflight,
    [string]$ServerInfraRoot = 'D:\ObjectCode\Server-infra'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$serverEnvPath = Join-Path $ServerInfraRoot 'server.local.env'
$maintainScript = Join-Path $ServerInfraRoot 'scripts\maintain.ps1'
$preflightScript = Join-Path $projectRoot '.agents\skills\deploy-homepage\scripts\preflight.ps1'
$frontendHelper = Join-Path $projectRoot '.agents\skills\deploy-homepage\scripts\deploy-frontend.sh'
$apiHelper = Join-Path $projectRoot '.agents\skills\deploy-homepage\scripts\deploy-api.sh'
$outputRoot = Join-Path $projectRoot 'output\full-release'

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

function Test-PublicUrl {
    param(
        [Parameter(Mandatory)][string]$Url,
        [int]$ExpectedStatus = 200
    )

    $status = (& curl.exe --silent --show-error --location --output NUL --write-out '%{http_code}' --max-time 20 $Url).Trim()
    if ($LASTEXITCODE -ne 0 -or $status -ne [string]$ExpectedStatus) {
        throw "Probe failed: $Url expected $ExpectedStatus, received $status"
    }
}

function Test-ApiHealth {
    param([Parameter(Mandatory)][string]$Revision)

    $json = (& curl.exe --silent --show-error --location --max-time 20 'https://api.xgwnje.cn/health') -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Public API health request failed.' }
    $health = $json | ConvertFrom-Json
    if (-not $health.ok -or $health.revision -ne $Revision -or $health.readiness.database -ne 'ready') {
        throw "Unexpected public API health for revision $Revision"
    }
}

foreach ($path in @($serverEnvPath, $maintainScript, $preflightScript, $frontendHelper, $apiHelper)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required release file is missing: $path"
    }
}

$gitRoot = (& git -C $projectRoot rev-parse --show-toplevel).Trim()
if ([System.IO.Path]::GetFullPath($gitRoot) -ne [System.IO.Path]::GetFullPath($projectRoot)) {
    throw "Unexpected Git root: $gitRoot"
}
$statusLines = @(& git -C $projectRoot status --porcelain=v1)
if ($statusLines.Count -gt 0) {
    throw "Full publishing requires a clean worktree. Commit first. Dirty paths: $($statusLines -join ', ')"
}

$branch = (& git -C $projectRoot branch --show-current).Trim()
if ($branch -ne 'main') { throw "Full publishing requires main. Current branch: $branch" }
$head = (& git -C $projectRoot rev-parse HEAD).Trim()
$remoteMainLine = @(& git -C $projectRoot ls-remote --heads origin refs/heads/main) | Select-Object -First 1
$remoteMain = if ([string]::IsNullOrWhiteSpace($remoteMainLine)) { '' } else { ($remoteMainLine -split '\s+')[0] }
if ([string]::IsNullOrWhiteSpace($remoteMain) -or $remoteMain -ne $head) {
    throw "Push main before production release. Local HEAD: $head; origin/main: $remoteMain"
}

if (-not $SkipPreflight) {
    Invoke-Native -FilePath 'npm.cmd' -Arguments @('ci') | Out-Host
    Invoke-Native -FilePath 'npm.cmd' -Arguments @('ci', '--prefix', 'server') | Out-Host
    Invoke-Native -FilePath 'powershell.exe' -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $preflightScript, '-Mode', 'FullAudit') | Out-Host
}

$server = Read-DotEnv -Path $serverEnvPath
$requiredKeys = @('VPS_IP', 'SSH_USER', 'SSH_PORT', 'SSH_KEY_PATH')
$missingKeys = @($requiredKeys | Where-Object { -not $server.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($server[$_]) })
if ($missingKeys.Count -gt 0) { throw "Server inventory is missing required keys: $($missingKeys -join ', ')" }
if (-not (Test-Path -LiteralPath $server['SSH_KEY_PATH'] -PathType Leaf)) { throw 'Configured SSH key does not exist.' }

$sshTarget = "$($server['SSH_USER'])@$($server['VPS_IP'])"
$sshArgs = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes', '-p', $server['SSH_PORT'], '-i', $server['SSH_KEY_PATH'])
$scpArgs = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes', '-P', $server['SSH_PORT'], '-i', $server['SSH_KEY_PATH'])
function Invoke-Remote {
    param([Parameter(Mandatory)][string]$Command)
    return Invoke-Native -FilePath 'ssh.exe' -Arguments ($sshArgs + @($sshTarget, $Command.Replace("`r", '')))
}

$baselineLines = @(Invoke-Remote -Command @'
set -eu
test "$(systemctl is-active homepage-api.service)" = active
nginx -t >/dev/null 2>/dev/null
printf 'frontendRelease=%s\n' "$(basename "$(readlink -f /var/www/xgwnje-home.releases/current)")"
printf 'apiRelease=%s\n' "$(basename "$(readlink -f /opt/homepage-api/current)")"
'@)
$baselineValues = @{}
foreach ($line in $baselineLines) {
    if ($line -match '^(?<key>frontendRelease|apiRelease)=(?<value>.+)$') {
        $baselineValues[$matches['key']] = $matches['value']
    }
}
if (-not $baselineValues.ContainsKey('frontendRelease') -or -not $baselineValues.ContainsKey('apiRelease')) {
    throw 'Unable to read the current frontend and API release identifiers from the server.'
}
$baseline = [pscustomobject]@{ frontendRelease = $baselineValues['frontendRelease']; apiRelease = $baselineValues['apiRelease'] }
Test-PublicUrl -Url 'https://xgwnje.cn/'
Test-ApiHealth -Revision ((& curl.exe --silent --show-error --location --max-time 20 'https://api.xgwnje.cn/health' | ConvertFrom-Json).revision)
Test-PublicUrl -Url 'https://visionguard.xgwnje.cn/' -ExpectedStatus 404

$distRoot = Join-Path $projectRoot 'dist'
if (-not (Test-Path -LiteralPath (Join-Path $distRoot 'index.html') -PathType Leaf)) { throw 'dist/index.html is missing after preflight.' }
$releaseId = "$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))-full-$((& git -C $projectRoot rev-parse --short=7 HEAD).Trim())"
$artifactDir = Join-Path $outputRoot $releaseId
New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null

$frontendArchiveName = "homepage-frontend-$releaseId.tar.gz"
$apiArchiveName = "homepage-api-$releaseId.tar.gz"
$manifestName = "release-manifest-$releaseId.json"
$frontendArchivePath = Join-Path $artifactDir $frontendArchiveName
$apiArchivePath = Join-Path $artifactDir $apiArchiveName
$manifestPath = Join-Path $artifactDir $manifestName
$sumsPath = Join-Path $artifactDir 'SHA256SUMS'
Invoke-Native -FilePath 'tar.exe' -Arguments @('-czf', $frontendArchivePath, '-C', $distRoot, '.') | Out-Null
Invoke-Native -FilePath 'tar.exe' -Arguments @('-czf', $apiArchivePath, '-C', (Join-Path $projectRoot 'server'), 'package.json', 'package-lock.json', 'scripts', 'src', 'test') | Out-Null

$files = @(Get-ChildItem -LiteralPath $distRoot -Recurse -File)
$fileCount = $files.Count
$totalBytes = ($files | Measure-Object Length -Sum).Sum
$indexSha = (Get-FileHash -LiteralPath (Join-Path $distRoot 'index.html') -Algorithm SHA256).Hash.ToLowerInvariant()
$frontendSha = (Get-FileHash -LiteralPath $frontendArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$apiSha = (Get-FileHash -LiteralPath $apiArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
    releaseId = $releaseId
    scope = 'full-audit'
    revision = $head
    branch = $branch
    gitStatus = 'clean'
    builtAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    productionBase = $baseline
    environment = [ordered]@{ node = (& node --version).Trim(); npm = (& npm --version).Trim() }
    frontend = [ordered]@{ archive = $frontendArchiveName; sha256 = $frontendSha; fileCount = $fileCount; totalBytes = $totalBytes; indexSha256 = $indexSha }
    backend = [ordered]@{ archive = $apiArchiveName; sha256 = $apiSha; deployed = $true; currentRevision = $head }
}
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 8), $utf8NoBom)
$manifestSha = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText($sumsPath, "$frontendSha  $frontendArchiveName`n$apiSha  $apiArchiveName`n$manifestSha  $manifestName`n", $utf8NoBom)

$remoteStaging = "/tmp/homepage-release-$releaseId"
Invoke-Remote -Command "set -eu; mkdir -p $(ConvertTo-BashLiteral $remoteStaging)" | Out-Host
Invoke-Native -FilePath 'scp.exe' -Arguments ($scpArgs + @($frontendArchivePath, $apiArchivePath, $manifestPath, $sumsPath, $frontendHelper, $apiHelper, "$sshTarget`:$remoteStaging/")) | Out-Host

$frontendArgs = @($releaseId, $frontendSha, [string]$fileCount, [string]$totalBytes, $indexSha, [string]$baseline.frontendRelease) | ForEach-Object { ConvertTo-BashLiteral $_ }
$apiArgs = @($releaseId, $apiSha, $head, [string]$baseline.apiRelease) | ForEach-Object { ConvertTo-BashLiteral $_ }
$frontendPrepare = "bash $(ConvertTo-BashLiteral "$remoteStaging/deploy-frontend.sh") prepare $($frontendArgs -join ' ')"
$frontendActivate = "bash $(ConvertTo-BashLiteral "$remoteStaging/deploy-frontend.sh") activate $($frontendArgs -join ' ')"
$frontendRollback = "bash $(ConvertTo-BashLiteral "$remoteStaging/deploy-frontend.sh") rollback $($frontendArgs -join ' ')"
$apiPrepare = "bash $(ConvertTo-BashLiteral "$remoteStaging/deploy-api.sh") prepare $($apiArgs -join ' ')"
$apiActivate = "bash $(ConvertTo-BashLiteral "$remoteStaging/deploy-api.sh") activate $($apiArgs -join ' ')"
$apiRollback = "bash $(ConvertTo-BashLiteral "$remoteStaging/deploy-api.sh") rollback $($apiArgs -join ' ')"
$escapedMaintainScript = $maintainScript.Replace("'", "''")
$maintainCommand = "& '$escapedMaintainScript' -Mode AfterChange -Scope @('anytls','homepage','homepage-api','visionguard')"

$apiActivated = $false
$frontendActivated = $false
try {
    Invoke-Remote -Command $apiPrepare | Out-Host
    Invoke-Remote -Command $frontendPrepare | Out-Host
    Invoke-Remote -Command $apiActivate | Out-Host
    $apiActivated = $true
    Invoke-Remote -Command $frontendActivate | Out-Host
    $frontendActivated = $true

    foreach ($route in @('/', '/about/', '/blog/', '/tags/', '/blog/site-maintenance-cleanup-cn/', '/blog/site-maintenance-cleanup-en/', '/admin/', '/rss.xml', '/sitemap-index.xml')) {
        Test-PublicUrl -Url ("https://xgwnje.cn" + $route)
    }
    Test-PublicUrl -Url ("https://xgwnje.cn/__full-release-probe-$releaseId") -ExpectedStatus 404
    Test-ApiHealth -Revision $head
    Test-PublicUrl -Url 'https://visionguard.xgwnje.cn/' -ExpectedStatus 404
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $maintainCommand | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Server-infra AfterChange failed.' }
    Invoke-Remote -Command "rm -rf $(ConvertTo-BashLiteral $remoteStaging)" | Out-Null
} catch {
    if ($frontendActivated) { Invoke-Remote -Command $frontendRollback | Out-Host }
    if ($apiActivated) { Invoke-Remote -Command $apiRollback | Out-Host }
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $maintainCommand | Out-Host
    throw
}

[ordered]@{
    mode = 'FullAudit'
    releaseId = $releaseId
    revision = $head
    previousFrontendRelease = $baseline.frontendRelease
    previousApiRelease = $baseline.apiRelease
    frontendArchiveSha256 = $frontendSha
    apiArchiveSha256 = $apiSha
    manifestSha256 = $manifestSha
    frontendBackup = "/var/www/xgwnje-home.backup-$releaseId"
    apiBackup = "/opt/homepage-api/backups/$releaseId"
    rollback = [ordered]@{
        frontend = "bash /var/www/xgwnje-home.releases/$releaseId/deploy-frontend.sh rollback $releaseId $frontendSha $fileCount $totalBytes $indexSha $($baseline.frontendRelease)"
        api = "bash /opt/homepage-api/releases/$releaseId/.release/deploy-api.sh rollback $releaseId $apiSha $head $($baseline.apiRelease)"
    }
} | ConvertTo-Json -Depth 6
