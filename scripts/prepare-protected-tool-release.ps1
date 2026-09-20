[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9]+(?:-[a-z0-9]+)*$')]
  [string]$Slug,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Title,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Summary,

  [ValidateSet('inline', 'plotly-alipay')]
  [string]$CspProfile = 'inline',

  [string]$ToolsRoot,
  [string]$OutputRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $ToolsRoot) { $ToolsRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\protected-tools')) }
if (-not $OutputRoot) { $OutputRoot = Join-Path ([IO.Path]::GetTempPath()) 'aicalendar-tool-releases' }

$source = Get-Item -LiteralPath $InputPath
if (-not $source.PSIsContainer -and $source.Extension.ToLowerInvariant() -eq '.html') {
  $sourcePath = $source.FullName
} else {
  throw 'InputPath 必须指向一个 .html 文件。'
}
if ($source.Length -gt 10MB) { throw '单个工具 HTML 不能超过 10 MB。' }
if ($Slug.Length -gt 80) { throw 'Slug 不能超过 80 个字符。' }

$manifestPath = Join-Path ([IO.Path]::GetFullPath($ToolsRoot)) 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "找不到工具清单: $manifestPath" }
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
if ($null -eq $manifest.tools) { throw '工具清单缺少 tools 数组。' }

# Fast uploads are an exception; the source tree remains authoritative.
$sourceEntry = @($manifest.tools | Where-Object { $_.slug -eq $Slug })
$trackedHtml = Join-Path $ToolsRoot "$Slug/index.html"
if ($sourceEntry.Count -ne 1 -or -not (Test-Path -LiteralPath $trackedHtml -PathType Leaf)) {
  throw '请先将工具 HTML 和清单纳入源码，再准备例外快传。'
}
if ((Get-FileHash -LiteralPath $trackedHtml).Hash -ne (Get-FileHash -LiteralPath $sourcePath).Hash -or
    $sourceEntry[0].title -ne $Title.Trim() -or $sourceEntry[0].summary -ne $Summary.Trim() -or
    $sourceEntry[0].cspProfile -ne $CspProfile -or $sourceEntry[0].enabled -eq $false) {
  throw '快传输入必须与源码 HTML 和清单完全一致。'
}
$releaseId = "tool-$((Get-Date).ToUniversalTime().ToString('yyMMdd.HHmmss'))-$Slug"
$releaseDirectory = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) $releaseId
if (Test-Path -LiteralPath $releaseDirectory) { throw "发布目录已存在，请稍后重试: $releaseDirectory" }
$stageRoot = Join-Path $releaseDirectory 'protected-tools'
$stageToolRoot = Join-Path $stageRoot $Slug
New-Item -ItemType Directory -Path $stageToolRoot -Force | Out-Null

$utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllBytes((Join-Path $stageRoot 'manifest.json'), [IO.File]::ReadAllBytes($manifestPath))
[IO.File]::WriteAllBytes((Join-Path $stageToolRoot 'index.html'), [IO.File]::ReadAllBytes($sourcePath))

$sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifestHash = (Get-FileHash -LiteralPath (Join-Path $stageRoot 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$record = [ordered]@{
  releaseId = $releaseId
  slug = $Slug
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  sourceSha256 = $sourceHash
  manifestSha256 = $manifestHash
  files = @('protected-tools/manifest.json', "protected-tools/$Slug/index.html")
  uploadMode = 'protected-tools fast path'
  note = '仅包含受审阅的 HTML 和工具清单；服务器端仍需按备份、哈希核对、原子替换和回滚流程发布。'
}
[IO.File]::WriteAllText((Join-Path $releaseDirectory 'release.json'), ($record | ConvertTo-Json -Depth 6), $utf8NoBom)

Write-Output "工具发布包已准备: $releaseId"
Write-Output "目录: $releaseDirectory"
Write-Output "HTML SHA-256: $sourceHash"
Write-Output "清单 SHA-256: $manifestHash"
Write-Output '该脚本只准备本地发布包，不会连接服务器或修改生产目录。'
