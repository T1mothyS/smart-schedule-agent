param(
    [Parameter(Mandatory = $true)][string]$Python,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Use a new output directory; existing output is never overwritten.' }
$output = New-Item -ItemType Directory -Path $OutputDirectory
$wheels = New-Item -ItemType Directory -Path (Join-Path $output.FullName 'wheelhouse')
& $Python -m pip download --disable-pip-version-check --index-url https://pypi.org/simple --only-binary=:all: --platform manylinux2014_x86_64 --python-version 312 --implementation cp --abi cp312 --dest $wheels.FullName -r (Join-Path $PSScriptRoot 'requirements.txt') 'pip==25.2'
if ($LASTEXITCODE -ne 0) { throw 'Linux wheel download failed; incomplete output retained.' }
$files = @('requirements.txt', 'serve.py', 'fixtures.py', 'probe.py', 'create_users.py', 'rights', 'config.example', 'ai-calendar-caldav-poc.service', 'nginx-path.conf.example', 'install-runtime.sh', 'README.md')
foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $output.FullName }
$manifest = Get-ChildItem -LiteralPath $output.FullName -File -Recurse | Sort-Object FullName | ForEach-Object {
    $relative = [IO.Path]::GetRelativePath($output.FullName, $_.FullName).Replace('\', '/')
    '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $relative
}
[IO.File]::WriteAllLines((Join-Path $output.FullName 'SHA256SUMS'), $manifest, [Text.UTF8Encoding]::new($false))
Write-Output ('Offline bundle ready: ' + $output.FullName)
