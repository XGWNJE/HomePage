[CmdletBinding()]
param(
    [switch]$PlanOnly,
    [switch]$BenchmarkOnly,
    [string]$ServerInfraRoot = 'D:\ObjectCode\Server-infra',
    [string]$ProjectRoot = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
} else {
    (Resolve-Path -LiteralPath $ProjectRoot).Path
}
$serverEnvPath = Join-Path $ServerInfraRoot 'server.local.env'
$maintainScript = Join-Path $ServerInfraRoot 'scripts\maintain.ps1'
$remoteHelper = Join-Path $projectRoot '.agents\skills\deploy-homepage\scripts\deploy-frontend.sh'
$outputRoot = Join-Path $projectRoot 'output\content-release'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

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

function ConvertTo-WindowsArgument {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Value)
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }

    $builder = [System.Text.StringBuilder]::new()
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes++
            continue
        }
        if ($character -eq '"') {
            [void]$builder.Append(('\' * (($backslashes * 2) + 1)))
            [void]$builder.Append('"')
            $backslashes = 0
            continue
        }
        if ($backslashes -gt 0) {
            [void]$builder.Append(('\' * $backslashes))
            $backslashes = 0
        }
        [void]$builder.Append($character)
    }
    if ($backslashes -gt 0) { [void]$builder.Append(('\' * ($backslashes * 2))) }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Start-CapturedProcess {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$Arguments,
        [switch]$RedirectInput
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = (($Arguments | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.RedirectStandardInput = $RedirectInput.IsPresent
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "Unable to start $FilePath" }
    return [pscustomobject]@{
        Process = $process
        StandardOutput = $process.StandardOutput.ReadToEndAsync()
        StandardError = $process.StandardError.ReadToEndAsync()
    }
}

function Complete-CapturedProcess {
    param(
        [Parameter(Mandatory)]$Handle,
        [Parameter(Mandatory)][string]$Phase
    )
    $Handle.Process.WaitForExit()
    $stdout = $Handle.StandardOutput.GetAwaiter().GetResult()
    $stderr = $Handle.StandardError.GetAwaiter().GetResult()
    $exitCode = $Handle.Process.ExitCode
    $Handle.Process.Dispose()
    if ($exitCode -ne 0) {
        $details = @($stderr.Trim(), $stdout.Trim()) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        throw "$Phase failed with exit code $exitCode.$(if ($details.Count -gt 0) { " $($details -join ' ')" })"
    }
    return [pscustomobject]@{ StandardOutput = $stdout; StandardError = $stderr }
}

function Send-ProcessInput {
    param(
        [Parameter(Mandatory)]$Handle,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Value
    )

    $Handle.Process.StandardInput.Write($Value.Replace("`r", ''))
    $Handle.Process.StandardInput.Close()
}

function Write-Utf8NoBom {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][AllowEmptyString()][string]$Value)
    [System.IO.File]::WriteAllText($Path, $Value, $utf8NoBom)
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

function Convert-RouteToDistPath {
    param([Parameter(Mandatory)][string]$Route)
    if ($Route -eq '/') { return 'index.html' }
    if ($Route.EndsWith('/')) { return ($Route.Trim('/') + '/index.html') }
    return $Route.Trim('/')
}

function Invoke-AfterChange {
    Invoke-Native -FilePath 'powershell.exe' -Arguments @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $maintainScript,
        '-Mode', 'AfterChange',
        '-Scope', 'homepage'
    ) | Out-Host
}

foreach ($path in @($serverEnvPath, $maintainScript, $remoteHelper)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required release file is missing: $path" }
}

$gitRoot = (& git -C $projectRoot rev-parse --show-toplevel).Trim()
if ([System.IO.Path]::GetFullPath($gitRoot) -ne [System.IO.Path]::GetFullPath($projectRoot)) {
    throw "Unexpected Git root: $gitRoot"
}
Set-Location -LiteralPath $projectRoot
$workingPaths = @(Get-GitStatusPaths)
if ($workingPaths.Count -gt 0) {
    throw "Content publishing requires a clean worktree. Commit the article and its images first. Dirty paths: $($workingPaths -join ', ')"
}

$branch = (& git -C $projectRoot branch --show-current).Trim()
$head = (& git -C $projectRoot rev-parse HEAD).Trim()
$headShort = (& git -C $projectRoot rev-parse --short=7 HEAD).Trim()
if (-not $PlanOnly -and -not $BenchmarkOnly -and $branch -ne 'main') {
    throw "Content publishing requires the main branch. Current branch: $branch"
}
if (-not $PlanOnly -and -not $BenchmarkOnly) {
    $upstream = (& git -C $projectRoot rev-parse '@{u}').Trim()
    if ($LASTEXITCODE -ne 0 -or $upstream -ne $head) {
        throw "Push the committed article before publishing. Local HEAD: $head; tracked upstream: $upstream"
    }
}

$server = Read-DotEnv -Path $serverEnvPath
$requiredKeys = @('VPS_IP', 'SSH_USER', 'SSH_PORT', 'SSH_KEY_PATH')
$missingKeys = @($requiredKeys | Where-Object { -not $server.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($server[$_]) })
if ($missingKeys.Count -gt 0) { throw "Server inventory is missing required keys: $($missingKeys -join ', ')" }
if (-not (Test-Path -LiteralPath $server['SSH_KEY_PATH'] -PathType Leaf)) { throw 'Configured SSH key does not exist.' }

$sshTarget = "$($server['SSH_USER'])@$($server['VPS_IP'])"
$sshArgs = @(
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=yes',
    '-p', $server['SSH_PORT'],
    '-i', $server['SSH_KEY_PATH']
)
$scpArgs = @(
    '-q',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=yes',
    '-P', $server['SSH_PORT'],
    '-i', $server['SSH_KEY_PATH']
)
$snapshotCommand = @'
set -eu
available_kb="$(df -Pk /var/www | awk 'NR == 2 {print $4}')"
test "$available_kb" -ge 262144
release_id="$(basename "$(readlink -f /var/www/xgwnje-home.releases/current)")"
manifest="$(find "/var/www/xgwnje-home.releases/${release_id}" -maxdepth 1 -type f -name 'release-manifest-*.json' | head -n 1)"
site="/var/www/xgwnje-home.releases/${release_id}/site"
test -n "$manifest"
test -d "$site"
cat "$manifest"
printf '\n__TREE_TSV__\n'
cd "$site"
find . -type f -printf '%P\n' | LC_ALL=C sort | while IFS= read -r relative; do
    printf '%s\t%s\t%s\n' "$(sha256sum "$relative" | awk '{print $1}')" "$(stat -c '%s' "$relative")" "$relative"
done
'@

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$snapshotHandle = Start-CapturedProcess -FilePath 'ssh.exe' -Arguments ($sshArgs + @($sshTarget, 'bash', '-s')) -RedirectInput
Send-ProcessInput -Handle $snapshotHandle -Value $snapshotCommand
$buildFailure = $null
if (-not $PlanOnly) {
    try {
        Invoke-Native -FilePath 'node.exe' -Arguments @((Join-Path $projectRoot 'scripts\check-language-pairs.mjs')) | Out-Host
        Invoke-Native -FilePath (Join-Path $projectRoot 'node_modules\.bin\astro.cmd') -Arguments @('build') | Out-Host
        Invoke-Native -FilePath 'node.exe' -Arguments @((Join-Path $projectRoot 'scripts\ensure-sitemap-xml.mjs')) | Out-Host
    } catch {
        $buildFailure = $_
    }
}
$snapshotResult = Complete-CapturedProcess -Handle $snapshotHandle -Phase 'Production snapshot'
if ($buildFailure) { throw $buildFailure }

$snapshotParts = [regex]::Split($snapshotResult.StandardOutput, '(?m)^__TREE_TSV__\r?$', 2)
if ($snapshotParts.Count -ne 2) { throw 'Unable to parse the production release snapshot.' }
$production = $snapshotParts[0].Trim() | ConvertFrom-Json
$productionRevision = [string]$production.revision
$previousRelease = [string]$production.releaseId
if ($productionRevision -notmatch '^[a-f0-9]{40}$') { throw 'Production manifest contains an invalid Git revision.' }
if ($previousRelease -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$') { throw 'Production manifest contains an invalid release ID.' }

& git -C $projectRoot cat-file -e "$productionRevision`^{commit}"
if ($LASTEXITCODE -ne 0) { throw "Production revision is not available locally: $productionRevision" }
$changedPaths = @(& git -C $projectRoot diff --name-only "$productionRevision..HEAD")
$deletedArticles = @($changedPaths | Where-Object {
    $_ -match '^src/content/blog/.+\.md$' -and
    -not (Test-Path -LiteralPath (Join-Path $projectRoot $_) -PathType Leaf)
})
if ($deletedArticles.Count -gt 0) {
    throw "Article deletion is not supported by the daily fast lane: $($deletedArticles -join ', ')"
}
$env:CONTENT_RELEASE_PATHS_JSON = ConvertTo-Json -Compress -InputObject $changedPaths
$env:CONTENT_RELEASE_PRODUCTION_REVISION = $productionRevision
try {
    $scopeJson = (& node (Join-Path $projectRoot 'scripts\content-release-scope.mjs')) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Content release scope classifier failed.' }
    $scope = $scopeJson | ConvertFrom-Json
} finally {
    Remove-Item Env:CONTENT_RELEASE_PATHS_JSON -ErrorAction SilentlyContinue
    Remove-Item Env:CONTENT_RELEASE_PRODUCTION_REVISION -ErrorAction SilentlyContinue
}
if (-not $scope.eligible) {
    throw "Fast content release accepts only ordinary Markdown and public/image/blog assets. Rejected: $(@($scope.rejectedPaths) -join ', ')"
}
if (@($scope.publishedToDraft).Count -gt 0) {
    throw "The daily fast lane cannot turn a published article back into a draft: $(@($scope.publishedToDraft) -join ', ')"
}
$articleRoutes = @($scope.routes | Where-Object { $_ -match '^/blog/.+/$' })
if ($articleRoutes.Count -eq 0) { throw 'Fast content release requires at least one non-draft article.' }
foreach ($asset in @($scope.assetFiles)) {
    $assetPath = Join-Path $projectRoot ([string]$asset)
    if (Test-Path -LiteralPath $assetPath -PathType Leaf) {
        $assetBytes = (Get-Item -LiteralPath $assetPath).Length
        if ($assetBytes -gt 1MB) { throw "Blog asset exceeds the one-megabyte fast-lane limit: $asset" }
    }
}

if ($PlanOnly) {
    [ordered]@{
        mode = 'ContentOnlyDelta'
        planOnly = $true
        productionRelease = $previousRelease
        productionRevision = $productionRevision
        revision = $head
        changedPaths = @($scope.paths)
        articleRoutes = $articleRoutes
        skipped = @('full test suite', 'API tests', 'browser QA', 'full dist upload')
    } | ConvertTo-Json -Depth 5
    exit 0
}

$distRoot = Join-Path $projectRoot 'dist'
foreach ($route in $articleRoutes) {
    $relative = Convert-RouteToDistPath -Route ([uri]::UnescapeDataString([string]$route))
    if (-not (Test-Path -LiteralPath (Join-Path $distRoot $relative) -PathType Leaf)) {
        throw "Built article route is missing: $route ($relative)"
    }
}

$releaseId = "$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))-content-$headShort"
$artifactDir = Join-Path $outputRoot $releaseId
New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null
$baselinePath = Join-Path $artifactDir 'BASELINE_TREE.tsv'
Write-Utf8NoBom -Path $baselinePath -Value $snapshotParts[1].TrimStart("`r", "`n")
$deltaJson = ((Invoke-Native -FilePath 'node.exe' -Arguments @(
    (Join-Path $projectRoot 'scripts\content-delta.mjs'),
    '--root', $distRoot,
    '--baseline', $baselinePath
)) -join "`n") | ConvertFrom-Json
$changedOutputPaths = @($deltaJson.delta.changedPaths)
$deletedOutputPaths = @($deltaJson.delta.deletedPaths)
if ($changedOutputPaths.Count -eq 0 -and $deletedOutputPaths.Count -eq 0) {
    throw 'The build produced no public file changes.'
}

$changedListPath = Join-Path $artifactDir 'CHANGED_FILES'
$deletedListPath = Join-Path $artifactDir 'DELETED_FILES'
Write-Utf8NoBom -Path $changedListPath -Value (($changedOutputPaths -join "`n") + "`n")
Write-Utf8NoBom -Path $deletedListPath -Value $(if ($deletedOutputPaths.Count -gt 0) { ($deletedOutputPaths -join "`n") + "`n" } else { '' })

$deltaArchiveName = "homepage-frontend-delta-$releaseId.tar.gz"
$manifestName = "release-manifest-$releaseId.json"
$bundleName = "homepage-content-bundle-$releaseId.tar.gz"
$deltaArchivePath = Join-Path $artifactDir $deltaArchiveName
$manifestPath = Join-Path $artifactDir $manifestName
$sumsPath = Join-Path $artifactDir 'SHA256SUMS'
$helperArtifactPath = Join-Path $artifactDir 'deploy-frontend.sh'
Copy-Item -LiteralPath $remoteHelper -Destination $helperArtifactPath
Invoke-Native -FilePath 'tar.exe' -Arguments @(
    '-czf', $deltaArchivePath,
    '-C', $distRoot,
    '-T', $changedListPath
) | Out-Null

$deltaArchiveSha = (Get-FileHash -LiteralPath $deltaArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
    releaseId = $releaseId
    scope = 'content-only-delta'
    revision = $head
    productionBaseRevision = $productionRevision
    branch = $branch
    gitStatus = 'clean'
    builtAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    changedPaths = @($scope.paths)
    affectedRoutes = @($articleRoutes)
    publishPolicy = [ordered]@{
        format = 'plain-markdown'
        browserQa = $false
        apiTests = $false
        fullDistUpload = $false
    }
    frontend = [ordered]@{
        archive = $deltaArchiveName
        sha256 = $deltaArchiveSha
        changedFileCount = $changedOutputPaths.Count
        deletedFileCount = $deletedOutputPaths.Count
        changedBytes = (Get-Item -LiteralPath $deltaArchivePath).Length
        fileCount = [int]$deltaJson.current.fileCount
        totalBytes = [int64]$deltaJson.current.totalBytes
        indexSha256 = [string]$deltaJson.current.indexSha256
        treeSha256 = [string]$deltaJson.current.treeSha256
    }
    backend = [ordered]@{
        deployed = $false
        currentRevision = [string]$production.backend.currentRevision
    }
}
Write-Utf8NoBom -Path $manifestPath -Value ($manifest | ConvertTo-Json -Depth 8)
$sumFiles = @($deltaArchivePath, $manifestPath, $changedListPath, $deletedListPath, $helperArtifactPath)
$sumLines = foreach ($sumFile in $sumFiles) {
    "$((Get-FileHash -LiteralPath $sumFile -Algorithm SHA256).Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($sumFile))"
}
Write-Utf8NoBom -Path $sumsPath -Value (($sumLines -join "`n") + "`n")

$bundlePath = Join-Path $artifactDir $bundleName
Invoke-Native -FilePath 'tar.exe' -Arguments @(
    '-czf', $bundlePath,
    '-C', $artifactDir,
    $deltaArchiveName,
    $manifestName,
    'SHA256SUMS',
    'CHANGED_FILES',
    'DELETED_FILES',
    'deploy-frontend.sh'
) | Out-Null
$bundleSha = (Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash.ToLowerInvariant()
$buildAndBundleSeconds = $stopwatch.Elapsed.TotalSeconds

if ($BenchmarkOnly) {
    [ordered]@{
        mode = 'ContentOnlyDelta'
        benchmarkOnly = $true
        releaseId = $releaseId
        buildAndBundleSeconds = [math]::Round($buildAndBundleSeconds, 2)
        changedOutputFiles = $changedOutputPaths.Count
        deletedOutputFiles = $deletedOutputPaths.Count
        bundleBytes = (Get-Item -LiteralPath $bundlePath).Length
        fullDistBytes = [int64]$deltaJson.current.totalBytes
    } | ConvertTo-Json -Depth 5
    exit 0
}

$quotedArgs = @(
    $releaseId,
    $deltaArchiveSha,
    [string]$deltaJson.current.fileCount,
    [string]$deltaJson.current.totalBytes,
    [string]$deltaJson.current.indexSha256,
    $previousRelease,
    [string]$deltaJson.current.treeSha256
) | ForEach-Object { ConvertTo-BashLiteral $_ }
$remoteArticleChecks = @($articleRoutes | ForEach-Object {
    $relative = Convert-RouteToDistPath -Route ([uri]::UnescapeDataString([string]$_))
    "test -f /var/www/xgwnje-home/$(ConvertTo-BashLiteral $relative)"
}) -join "`n"
$remotePublicChecks = @($articleRoutes | ForEach-Object {
    "curl --fail --silent --show-error --output /dev/null --max-time 10 $(ConvertTo-BashLiteral ('https://xgwnje.cn' + [string]$_))"
}) -join "`n"
$remoteBundlePath = "/tmp/$bundleName"
$remoteCommand = @"
set -Eeuo pipefail
staging=/tmp/homepage-release-$releaseId
release_dir=/var/www/xgwnje-home.releases/$releaseId
bundle=`$staging/$bundleName
mkdir -p "`$staging"
uploaded_bundle=$(ConvertTo-BashLiteral $remoteBundlePath)
test "`$(sha256sum "`$uploaded_bundle" | awk '{print `$1}')" = '$bundleSha'
mv "`$uploaded_bundle" "`$bundle"
tar -xzf "`$bundle" -C "`$staging"
exec 9>/tmp/xgwnje-home-frontend-release.lock
flock -n 9 || { printf 'Another frontend release is active.\n' >&2; exit 75; }
export HOMEPAGE_FRONTEND_LOCK_HELD=1
test "`$(basename "`$(readlink -f /var/www/xgwnje-home.releases/current)")" = $(ConvertTo-BashLiteral $previousRelease)
activated=0
rollback_on_error() {
    status=`$?
    if test "`$activated" = 1 && test -x "`$release_dir/deploy-frontend.sh"; then
        bash "`$release_dir/deploy-frontend.sh" rollback $($quotedArgs -join ' ') || true
    fi
    rm -rf "`$staging" "`$uploaded_bundle"
    exit "`$status"
}
trap rollback_on_error ERR
bash "`$staging/deploy-frontend.sh" prepare-delta $($quotedArgs -join ' ')
bash "`$staging/deploy-frontend.sh" activate $($quotedArgs -join ' ')
activated=1
$remoteArticleChecks
$remotePublicChecks
rm -rf "`$staging"
trap - ERR
printf 'CONTENT_ACTIVE release=%s previous=%s\n' '$releaseId' '$previousRelease'
"@

$uploadStarted = $stopwatch.Elapsed.TotalSeconds
Invoke-Native -FilePath 'scp.exe' -Arguments ($scpArgs + @($bundlePath, "$sshTarget`:$remoteBundlePath")) | Out-Null
$uploadSeconds = $stopwatch.Elapsed.TotalSeconds - $uploadStarted
$activateStarted = $stopwatch.Elapsed.TotalSeconds
$uploadHandle = Start-CapturedProcess -FilePath 'ssh.exe' -Arguments ($sshArgs + @($sshTarget, 'bash', '-s')) -RedirectInput
Send-ProcessInput -Handle $uploadHandle -Value $remoteCommand
$remoteResult = Complete-CapturedProcess -Handle $uploadHandle -Phase 'Remote content activation'
$activateSeconds = $stopwatch.Elapsed.TotalSeconds - $activateStarted
if ($remoteResult.StandardOutput) { $remoteResult.StandardOutput.Trim() | Out-Host }

$rollbackCommand = "bash /var/www/xgwnje-home.releases/$releaseId/deploy-frontend.sh rollback $($quotedArgs -join ' ')"
$publishedSeconds = $stopwatch.Elapsed.TotalSeconds
try {
    $afterChangeStarted = $stopwatch.Elapsed.TotalSeconds
    Invoke-AfterChange
    $afterChangeSeconds = $stopwatch.Elapsed.TotalSeconds - $afterChangeStarted
} catch {
    $verificationFailure = $_
    try {
        $rollbackHandle = Start-CapturedProcess -FilePath 'ssh.exe' -Arguments ($sshArgs + @($sshTarget, 'bash', '-s')) -RedirectInput
        Send-ProcessInput -Handle $rollbackHandle -Value $rollbackCommand
        $rollbackResult = Complete-CapturedProcess -Handle $rollbackHandle -Phase 'Content rollback'
        if ($rollbackResult.StandardOutput) { $rollbackResult.StandardOutput.Trim() | Out-Host }
        Invoke-AfterChange
    } catch {
        throw "Post-release verification failed and rollback also failed. Verification: $verificationFailure Rollback: $_"
    }
    throw $verificationFailure
}
$stopwatch.Stop()

[ordered]@{
    mode = 'ContentOnlyDelta'
    releaseId = $releaseId
    revision = $head
    previousRelease = $previousRelease
    publishedSeconds = [math]::Round($publishedSeconds, 2)
    totalSeconds = [math]::Round($stopwatch.Elapsed.TotalSeconds, 2)
    buildAndBundleSeconds = [math]::Round($buildAndBundleSeconds, 2)
    uploadSeconds = [math]::Round($uploadSeconds, 2)
    activateSeconds = [math]::Round($activateSeconds, 2)
    afterChangeSeconds = [math]::Round($afterChangeSeconds, 2)
    changedOutputFiles = $changedOutputPaths.Count
    deletedOutputFiles = $deletedOutputPaths.Count
    bundleBytes = (Get-Item -LiteralPath $bundlePath).Length
    fullDistBytes = [int64]$deltaJson.current.totalBytes
    deltaArchiveSha256 = $deltaArchiveSha
    bundleSha256 = $bundleSha
    manifestSha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    treeSha256 = [string]$deltaJson.current.treeSha256
    backup = "/var/www/xgwnje-home.backup-$releaseId"
    rollback = $rollbackCommand
    verifiedRoutes = $articleRoutes
    skipped = @('full test suite', 'API tests', 'browser QA', 'full dist upload')
} | ConvertTo-Json -Depth 6
