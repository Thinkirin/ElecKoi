param([string]$Output = 'build/android-runtime/downloads', [string]$Proxy = 'http://127.0.0.1:7890')
$ErrorActionPreference = 'Stop'
$destination = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$packages = @(
    '@deepseek-ai/node-addon-system-linux-arm64/0.1.2',
    '@koromix/koffi-linux-arm64/3.1.1',
    '@koromix/koffi-linux-arm64/3.1.5',
    '@deepseek-ai/libreoffice-kit-wasm/0.1.1',
    '@img/sharp-linux-arm64/0.35.4',
    '@img/sharp-libvips-linux-arm64/1.3.3',
    'node-addon-require-builtin-linux-arm64-gnu/0.1.6',
    '@vscode/ripgrep-linux-arm64/1.18.0',
    'sherpa-onnx-linux-arm64/1.13.8'
)
$evidence = @()
foreach ($specification in $packages) {
    $metadata = Invoke-RestMethod -Uri "https://registry.npmjs.org/$specification" -Proxy $Proxy
    $name = ($metadata.name -replace '[^a-zA-Z0-9.-]', '_') + '-' + $metadata.version + '.tgz'
    $archive = Join-Path $destination $name
    if (!(Test-Path -LiteralPath $archive)) {
        Invoke-WebRequest -Uri $metadata.dist.tarball -Proxy $Proxy -OutFile $archive
    }
    $hasher = [Security.Cryptography.SHA512]::Create()
    try { $integrity = 'sha512-' + [Convert]::ToBase64String($hasher.ComputeHash([IO.File]::ReadAllBytes($archive))) }
    finally { $hasher.Dispose() }
    if ($integrity -ne $metadata.dist.integrity) { throw "Native npm tarball integrity mismatch: $name" }
    $evidence += @{ name = $metadata.name; version = $metadata.version; archive = $name;
        url = $metadata.dist.tarball; integrity = $integrity; sha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$sqliteName = 'better-sqlite3-v12.11.1-node-v137-linux-arm64.tar.gz'
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/WiseLibs/better-sqlite3/releases/tags/v12.11.1' -Proxy $Proxy
$sqliteAsset = $release.assets | Where-Object { $_.name -eq $sqliteName }
if (!$sqliteAsset) { throw "SQLite ABI137 ARM64 release asset missing: $sqliteName" }
$sqlitePath = Join-Path $destination $sqliteName
if (!(Test-Path -LiteralPath $sqlitePath)) { Invoke-WebRequest -Uri $sqliteAsset.browser_download_url -Proxy $Proxy -OutFile $sqlitePath }
$sqliteSha = (Get-FileHash -LiteralPath $sqlitePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($sqliteAsset.digest -and $sqliteAsset.digest -ne "sha256:$sqliteSha") { throw 'SQLite release asset checksum mismatch' }
$evidence += @{ name = 'better-sqlite3'; version = '12.11.1'; nodeAbi = 137; archive = $sqliteName;
    url = $sqliteAsset.browser_download_url; sha256 = $sqliteSha; releaseDigest = $sqliteAsset.digest }
$evidence | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destination 'native-download-evidence.json') -Encoding utf8
Write-Output "Native runtime dependencies prepared in $destination"
