$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$program = Join-Path $repo "target\sbf-solana-solana\release\oss_bounty_escrow.so"
$ledger = Join-Path $repo "test-ledger"
$payerAccount = Join-Path $repo ".tmp\test-payer-account.json"
$programId = "6UoYT4jtiS23rCU1zARqnn181BxwuJ9waS1sv35gRg1Z"

if (-not (Test-Path -LiteralPath $program)) {
    throw "Missing SBF artifact: $program"
}

$payerPubkey = node (Join-Path $PSScriptRoot "create-test-account.mjs")
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create the local test payer account fixture"
}

$validator = Start-Process `
    -FilePath "solana-test-validator" `
    -ArgumentList @(
        "--reset",
        "--ledger", $ledger,
        "--account", $payerPubkey, $payerAccount,
        "--bpf-program", $programId, $program
    ) `
    -WindowStyle Hidden `
    -PassThru

try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            $response = Invoke-RestMethod `
                -Uri "http://127.0.0.1:8899" `
                -Method Post `
                -ContentType "application/json" `
                -TimeoutSec 1 `
                -Body '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
            if ($response.result -eq "ok") {
                $ready = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }

    if (-not $ready) {
        throw "Local validator did not become healthy"
    }

    npm run test:integration
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    if (-not $validator.HasExited) {
        Stop-Process -Id $validator.Id
    }
}
