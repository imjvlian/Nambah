param(
  [ValidateSet("success", "failed", "pending-success", "pending-failed")]
  [string]$Outcome = "failed"
)

$ErrorActionPreference = "Stop"

$testCases = @{
  "success"        = "087800001230"
  "failed"         = "087800001232"
  "pending-success" = "087800001233"
  "pending-failed"  = "087800001234"
}

function Get-DotEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $envPath = Join-Path (Get-Location) ".env.local"
  if (-not (Test-Path $envPath)) {
    throw ".env.local tidak ditemukan. Jalankan script dari root project Nambah."
  }

  $line = Get-Content $envPath | Where-Object {
    $_ -match "^\s*$([regex]::Escape($Name))\s*="
  } | Select-Object -First 1

  if (-not $line) {
    throw "$Name belum diisi di .env.local."
  }

  $value = ($line -split "=", 2)[1].Trim()

  if (
    ($value.StartsWith('"') -and $value.EndsWith('"')) -or
    ($value.StartsWith("'") -and $value.EndsWith("'"))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }

  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$Name kosong di .env.local."
  }

  return $value
}

function Get-Md5Hex {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  $md5 = [System.Security.Cryptography.MD5]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    $hash = $md5.ComputeHash($bytes)
    return ([System.BitConverter]::ToString($hash)).Replace("-", "").ToLowerInvariant()
  }
  finally {
    $md5.Dispose()
  }
}

$username = Get-DotEnvValue -Name "DIGIFLAZZ_USERNAME"
$apiKey = Get-DotEnvValue -Name "DIGIFLAZZ_API_KEY"
$customerNo = $testCases[$Outcome]
$sku = "xld10"
$refId = "nambah-test-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$sign = Get-Md5Hex -Value "$username$apiKey$refId"

$payload = [ordered]@{
  username       = $username
  buyer_sku_code = $sku
  customer_no    = $customerNo
  ref_id         = $refId
  testing        = $true
  sign           = $sign
}

Write-Host "Digiflazz direct test"
Write-Host "Outcome     : $Outcome"
Write-Host "SKU         : $sku"
Write-Host "Customer No : $customerNo"
Write-Host "Ref ID      : $refId"
Write-Host "Testing     : true"
Write-Host ""
Write-Host "Response:"

try {
  $response = Invoke-RestMethod `
    -Method POST `
    -Uri "https://api.digiflazz.com/v1/transaction" `
    -ContentType "application/json" `
    -Body ($payload | ConvertTo-Json -Compress)

  $response | ConvertTo-Json -Depth 10
}
catch {
  Write-Host "Request gagal." -ForegroundColor Red

  if ($_.ErrorDetails.Message) {
    Write-Host $_.ErrorDetails.Message
  }
  else {
    Write-Host $_.Exception.Message
  }

  exit 1
}
