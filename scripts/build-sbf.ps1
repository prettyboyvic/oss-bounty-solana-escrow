$ErrorActionPreference = "Stop"

$solana = Get-Command "solana" -ErrorAction Stop
$solanaBin = Split-Path -Parent $solana.Source
$platformRust = Join-Path `
    $solanaBin `
    "platform-tools-sdk\sbf\dependencies\platform-tools\rust\bin"
$cargo = Join-Path $platformRust "cargo.exe"
$rustc = Join-Path $platformRust "rustc.exe"

if (-not (Test-Path -LiteralPath $cargo)) {
    throw "Solana platform Cargo was not found at $cargo"
}

$env:PATH = "$platformRust;$env:PATH"
$env:RUSTC = $rustc

& $cargo build --release --target sbf-solana-solana --workspace
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
