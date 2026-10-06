[CmdletBinding()]
param([ValidatePattern('^[a-z][a-z0-9-]*$')][string]$ReleaseTag = 'ui1')

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$apkSource = Join-Path $repo 'apps\android\app\build\outputs\apk\debug\app-debug.apk'
$apkTarget = Join-Path $repo "build\android-runtime\app-debug-m3-m4-$ReleaseTag-20261005.apk"
$manifestPath = Join-Path $repo "build\android-runtime\runtime-assets-m3-m4-$ReleaseTag\runtime\manifest.json"
$reportPath = Join-Path $repo "build\android-runtime\apk-m3-m4-$ReleaseTag-report.json"
$version = "m3-m4-unified-20261005-$ReleaseTag"
$assetNames = @('runtime/rootfs.archive', 'runtime/node.archive', 'runtime/app.archive')
if (Test-Path -LiteralPath $apkTarget) { throw "Final $ReleaseTag APK already exists" }
$expected = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($expected.version -ne $version -or $expected.architecture -ne 'arm64-v8a') { throw "Staged manifest is not the $ReleaseTag ARM64 release" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($apkSource)
try {
    $entry = $zip.GetEntry('assets/runtime/manifest.json')
    if ($null -eq $entry) { throw 'APK runtime manifest missing' }
    $reader = [System.IO.StreamReader]::new($entry.Open())
    try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    foreach ($field in @('schemaVersion', 'version', 'architecture', 'nodeExecutable', 'hostEntrypoint', 'protocolVersion')) {
        if ($manifest.$field -ne $expected.$field) { throw "APK manifest differs: $field" }
    }
    if ($manifest.archives.Count -ne 3 -or $expected.archives.Count -ne 3) { throw 'Runtime must contain exactly three declared archives' }
    $checks = @()
    foreach ($name in $assetNames) {
        $archive = @($expected.archives | Where-Object asset -EQ $name)
        $declared = @($manifest.archives | Where-Object asset -EQ $name)
        if ($archive.Count -ne 1 -or $declared.Count -ne 1) { throw "Archive manifest entry missing or duplicated: $name" }
        $archive = $archive[0]
        $declared = $declared[0]
        foreach ($field in @('target', 'bytes', 'sha256')) {
            if ($declared.$field -ne $archive.$field) { throw "APK archive declaration differs: $name.$field" }
        }
        $asset = $zip.GetEntry('assets/' + $name)
        if ($null -eq $asset) { throw "APK asset missing: $name" }
        if ($asset.Length -ne $archive.bytes) { throw "APK archive byte count differs: $name" }
        $stream = $asset.Open()
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try { $actual = [System.BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
        finally { $sha.Dispose(); $stream.Dispose() }
        if ($actual -ne $archive.sha256) { throw "APK archive SHA differs: $name" }
        $checks += [ordered]@{ asset = $name; target = $archive.target; bytes = $asset.Length; sha256 = $actual; pass = $true }
    }
} finally { $zip.Dispose() }

Copy-Item -LiteralPath $apkSource -Destination $apkTarget
$report = [ordered]@{
    pass = $true
    apk = $apkTarget
    bytes = (Get-Item -LiteralPath $apkTarget).Length
    sha256 = (Get-FileHash -LiteralPath $apkTarget -Algorithm SHA256).Hash.ToLowerInvariant()
    runtimeVersion = $manifest.version
    architecture = $manifest.architecture
    archives = $checks
    scope = 'Final ARM64 APK asset bytes and manifest verification; not emulator preview or phone UI acceptance'
    reusedProductionStage = '/home/thinkirin/.cache/eleckoi-unified-runtime/app-release-m3-m4-device4-20261005'
    physicalDeviceVerified = $false
    androidAcceptanceComplete = $false
}
$json = $report | ConvertTo-Json -Depth 6
Set-Content -LiteralPath $reportPath -Value $json -Encoding utf8
$json
