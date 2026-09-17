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

$entries = [System.Collections.Generic.List[object]]::new()
foreach ($item in @($manifest.tools)) {
  if (-not $item.slug -or -not ($item.slug -match '^[a-z0-9]+(?:-[a-z0-9]+)*$')) { throw '现有工具清单包含无效 slug。' }
  if ($item.slug -eq $Slug) { continue }
  $entries.Add([ordered]@{
    slug = [string]$item.slug
    title = ([string]$item.title).Trim()
    summary = ([string]$item.summary).Trim()
    enabled = if ($null -eq $item.enabled) { $true } else { [bool]$item.enabled }
    cspProfile = if ($item.cspProfile) { [string]$item.cspProfile } else { 'inline' }
  })
}
$entries.Add([ordered]@{
  slug = $Slug
  title = $Title.Trim()
  summary = $Summary.Trim()
  enabled = $true
  cspProfile = $CspProfile
})

$releaseId = "tool-$((Get-Date).ToUniversalTime().ToString('yyMMdd.HHmmss'))-$Slug"
$releaseDirectory = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) $releaseId
if (Test-Path -LiteralPath $releaseDirectory) { throw "发布目录已存在，请稍后重试: $releaseDirectory" }
$stageRoot = Join-Path $releaseDirectory 'protected-tools'
$stageToolRoot = Join-Path $stageRoot $Slug
New-Item -ItemType Directory -Path $stageToolRoot -Force | Out-Null

$utf8NoBom = [Text.UTF8Encoding]::new($false)
$nextManifest = [ordered]@{
  version = if ($manifest.version) { [int]$manifest.version } else { 1 }
  tools = @($entries)
}
[IO.File]::WriteAllText((Join-Path $stageRoot 'manifest.json'), ($nextManifest | ConvertTo-Json -Depth 6), $utf8NoBom)
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
