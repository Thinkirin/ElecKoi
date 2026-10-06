[CmdletBinding()]
param(
    [ValidatePattern('^[a-z][a-z0-9-]*$')][string]$ReleaseTag = 'ui1',
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$WslDistribution = 'Ubuntu-26.04'
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$androidProject = Join-Path $repo 'apps\android'
$assets = Join-Path $repo "build\android-runtime\runtime-assets-m3-m4-$ReleaseTag"
$previousJavaHome = $env:JAVA_HOME
$previousJavaOptions = $env:JAVA_TOOL_OPTIONS
$finalApk = Join-Path $repo "build\android-runtime\app-debug-m3-m4-$ReleaseTag-20261005.apk"
if (Test-Path -LiteralPath $finalApk) { throw "$ReleaseTag APK already exists; preserve the prior release" }

# The caller must freeze and rebuild shared packages/renderer before invoking this release script.
$wslScript = & wsl.exe -d $WslDistribution -- wslpath -a (Join-Path $PSScriptRoot 'package-ui1.sh')
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the package script path in WSL' }
& wsl.exe -d $WslDistribution -- bash $wslScript.Trim() $ReleaseTag
if ($LASTEXITCODE -ne 0) { throw "$ReleaseTag ARM64 Host/assets packaging failed ($LASTEXITCODE)" }

try {
    if ($JavaHome) { $env:JAVA_HOME = $JavaHome }
    $longUnixDirectory = 'C:\' + ('eleckoi_no_afunix_' * 8)
    $env:JAVA_TOOL_OPTIONS = "$previousJavaOptions -Djdk.net.unixdomain.tmpdir=$longUnixDirectory".Trim()
    Push-Location -LiteralPath $androidProject
    try {
        & .\gradlew.bat --no-daemon '-Dorg.gradle.jvmargs=-Xmx3072m -Dfile.encoding=UTF-8' "-PunifiedRuntimeAssetsDir=$assets" ':app:assembleDebug'
        if ($LASTEXITCODE -ne 0) { throw "$ReleaseTag Android APK build failed ($LASTEXITCODE)" }
    } finally { Pop-Location }
} finally {
    $env:JAVA_HOME = $previousJavaHome
    $env:JAVA_TOOL_OPTIONS = $previousJavaOptions
}

& (Join-Path $PSScriptRoot 'verify-ui1-apk.ps1') -ReleaseTag $ReleaseTag
