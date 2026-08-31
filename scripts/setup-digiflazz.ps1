param(
  [switch]$Apply,
  [switch]$Remap,
  [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

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

$adminToken = Get-DotEnvValue -Name "NAMBAH_ADMIN_API_TOKEN"
$headers = @{ Authorization = "Bearer $adminToken" }
$body = @{
  apply = $Apply.IsPresent
  remap = $Remap.IsPresent
} | ConvertTo-Json -Compress

$mode = if ($Apply.IsPresent) { "APPLY" } else { "DRY RUN" }
Write-Host "Nambah Digiflazz setup — $mode"
Write-Host "Endpoint : $BaseUrl/api/admin/digiflazz/bootstrap"
Write-Host "Remap    : $($Remap.IsPresent)"
Write-Host ""

try {
  $response = Invoke-RestMethod `
    -Method POST `
    -Uri "$BaseUrl/api/admin/digiflazz/bootstrap" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body $body

  Write-Host "Supplier catalog : $($response.summary.supplierCatalogItems)"
  Write-Host "Produk Nambah    : $($response.summary.nambahProducts)"
  Write-Host "Sudah mapped     : $($response.summary.alreadyMapped)"
  Write-Host "Suggested        : $($response.summary.suggested)"
  Write-Host "Auto mapped      : $($response.summary.autoMapped)"
  Write-Host "Belum mapped     : $($response.summary.unmapped)"
  Write-Host ""

  $unmapped = @($response.products | Where-Object { $_.state -eq "unmapped" })
  if ($unmapped.Count -gt 0) {
    Write-Host "Produk yang masih perlu dicek manual:" -ForegroundColor Yellow
    foreach ($item in $unmapped) {
      Write-Host "- $($item.productId) — $($item.label)"
      if ($item.candidates -and $item.candidates.Count -gt 0) {
        foreach ($candidate in @($item.candidates)) {
          Write-Host "    $($candidate.sku) | $($candidate.name) | Rp$($candidate.cost) | score $($candidate.score)"
        }
      }
    }
  }

  if (-not $Apply.IsPresent) {
    Write-Host ""
    Write-Host "Dry run selesai. Jika hasilnya masuk akal, jalankan:" -ForegroundColor Cyan
    Write-Host ".\scripts\setup-digiflazz.ps1 -Apply"
  }
}
catch {
  Write-Host "Setup Digiflazz gagal." -ForegroundColor Red
  if ($_.ErrorDetails.Message) {
    Write-Host $_.ErrorDetails.Message
  }
  else {
    Write-Host $_.Exception.Message
  }
  exit 1
}
