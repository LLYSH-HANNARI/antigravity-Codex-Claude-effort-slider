<#
.SYNOPSIS
  Antigravity Codex & Claude 推理等级滑条 Windows 一行在线安装脚本。
.EXAMPLE
  irm https://github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider/releases/latest/download/install.ps1 | iex
#>
param(
  [string]$Mirror = $env:AG_SLIDER_MIRROR
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ManifestUrl = "https://github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider/releases/latest/download/manifest.json"
function Resolve-DownloadUrl([string]$Url, [string]$Prefix) {
  if ([string]::IsNullOrWhiteSpace($Prefix)) { return $Url }
  return ($Prefix.TrimEnd('/') + "/" + $Url)
}

function Invoke-SliderExe([string]$Exe, [string[]]$ArgList) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Exe
  $psi.Arguments = ($ArgList | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join ' '
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  $psi.CreateNoWindow = $true

  $proc = [System.Diagnostics.Process]::Start($psi)
  $stdout = $proc.StandardOutput.ReadToEnd()
  $stderr = $proc.StandardError.ReadToEnd()
  $proc.WaitForExit()
  if (-not [string]::IsNullOrWhiteSpace($stdout)) { Write-Host $stdout.TrimEnd() }
  if (-not [string]::IsNullOrWhiteSpace($stderr)) { Write-Host $stderr.TrimEnd() -ForegroundColor Red }
  return $proc.ExitCode
}

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Antigravity 推理等级滑条 · 在线安装器" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ag-slider-install-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

try {
  $ResolvedManifestUrl = Resolve-DownloadUrl $ManifestUrl $Mirror
  Write-Host "[1/4] 正在获取最新版本清单..."
  $Manifest = Invoke-RestMethod -Uri $ResolvedManifestUrl -TimeoutSec 30

  $ClientAsset = $Manifest.files.client
  $BinAsset = $Manifest.files.binaries."windows-x86_64"
  if (-not $ClientAsset -or -not $BinAsset) {
    throw "Release 清单缺少 Windows 安装产物信息。"
  }

  $ExePath = Join-Path $TmpDir "ag-effort-slider.exe"
  $ClientPath = Join-Path $TmpDir "client.js"

  Write-Host "[2/4] 正在下载原生安装引擎 (v$($Manifest.version))..."
  Invoke-WebRequest -Uri (Resolve-DownloadUrl $BinAsset.url $Mirror) -OutFile $ExePath -TimeoutSec 60
  $ExeHash = (Get-FileHash -Path $ExePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ExeHash -ne $BinAsset.sha256.ToLowerInvariant()) {
    throw "ag-effort-slider.exe SHA-256 校验失败，已中止安装。"
  }

  Write-Host "[3/4] 正在下载并校验客户端脚本..."
  Invoke-WebRequest -Uri (Resolve-DownloadUrl $ClientAsset.url $Mirror) -OutFile $ClientPath -TimeoutSec 60
  $ClientHash = (Get-FileHash -Path $ClientPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ClientHash -ne $ClientAsset.sha256.ToLowerInvariant()) {
    throw "client.js SHA-256 校验失败，已中止安装。"
  }

  Write-Host "[4/4] 正在部署至原生插件目录并注入引导器..."
  $installCode = Invoke-SliderExe $ExePath @("install", "--client", $ClientPath)
  if ($installCode -ne 0) {
    throw "安装程序返回错误码 $installCode"
  }

  if (-not [string]::IsNullOrWhiteSpace($Mirror)) {
    $null = Invoke-SliderExe $ExePath @("config", "--mirror", $Mirror)
  }

  Write-Host "`n安装完成！若 Antigravity 正在运行，请重启或重载窗口生效。" -ForegroundColor Green
} finally {
  if (Test-Path $TmpDir) {
    Remove-Item -Path $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
