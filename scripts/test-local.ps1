$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$program = Join-Path $repo "target\sbf-solana-solana\release\oss_bounty_escrow.so"
$programId = "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z"

if (-not (Test-Path -LiteralPath $program)) {
    throw "Missing SBF artifact: $program"
}

$null = node (Join-Path $PSScriptRoot "create-test-account.mjs")
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create the local test payer account fixture"
}

node (Join-Path $PSScriptRoot "local-validator-supervisor.mjs") `
    --program $program `
    --program-id $programId
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
