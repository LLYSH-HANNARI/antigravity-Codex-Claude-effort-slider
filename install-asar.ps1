param(
  [switch]$Uninstall,
  [string]$AsarPath = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

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

# 优先使用原生 Rust 二进制（支持原生插件目录托管、自动更新与 SessionStart 自愈）
$InstalledBin = Join-Path $env:USERPROFILE ".gemini\config\plugins\antigravity-effort-slider\bin\ag-effort-slider.exe"
$CandidateBins = @(
  (Join-Path $RootDir "ag-effort-slider.exe"),
  (Join-Path $RootDir "bin\ag-effort-slider.exe"),
  (Join-Path $RootDir "installer\target\release\ag-effort-slider.exe"),
  $InstalledBin
)

$RustBin = $CandidateBins | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($RustBin) {
  $rustArgs = @()
  if ($Uninstall) {
    $rustArgs += "uninstall"
  } else {
    $rustArgs += "install"
    $LocalClient = Join-Path $RootDir "lib\client.js"
    if (Test-Path $LocalClient) {
      $rustArgs += "--client"
      $rustArgs += $LocalClient
    }
  }
  if ($AsarPath -ne "") {
    $rustArgs += "--asar"
    $rustArgs += $AsarPath
  }
  $code = Invoke-SliderExe $RustBin $rustArgs
  exit $code
}

# 开发者本地尚未编译 Rust 二进制时，平滑回退到 Node.js 安装脚本
$CliScript = Join-Path $RootDir "tools\cli-install.cjs"
$nodeArgs = @($CliScript)
if ($Uninstall) {
  $nodeArgs += "--uninstall"
}
if ($AsarPath -ne "") {
  $nodeArgs += "--asar"
  $nodeArgs += $AsarPath
}

& node @nodeArgs
exit $LASTEXITCODE
