use solana_loader_v3_interface::instruction;
use solana_pubkey::Pubkey;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn main() {
    let buffer = "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW"
        .parse::<Pubkey>()
        .expect("fixture buffer key is valid");
    let authority = "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk"
        .parse::<Pubkey>()
        .expect("fixture authority key is valid");
    let vectors = [
        ("offset-zero", 0u32, vec![1, 2, 3]),
        ("non-zero-offset", 7u32, vec![9]),
        ("multi-byte-offset-boundary", 256u32, vec![0xaa, 0xbb]),
        (
            "near-maximum-planned-payload",
            0x0006_0400u32,
            (0..1011).map(|index| (index % 251) as u8).collect(),
        ),
    ]
    .into_iter()
    .map(|(coverage, offset, payload)| {
        let ix = instruction::write(&buffer, &authority, offset, payload.clone());
        let mut vector = serde_json::json!({
            "coverage": coverage,
            "offset": offset,
            "accounts": ix.accounts.iter().map(|account| serde_json::json!({
                "pubkey": account.pubkey.to_string(),
                "isSigner": account.is_signer,
                "isWritable": account.is_writable,
            })).collect::<Vec<_>>(),
            "programId": ix.program_id.to_string(),
        });
        if coverage == "near-maximum-planned-payload" {
            vector["payloadPattern"] = serde_json::json!({
                "kind": "incrementing-modulo",
                "modulo": 251,
                "length": payload.len(),
            });
            vector["instructionHeaderHex"] = serde_json::json!(hex(&ix.data[..16]));
            vector["instructionLength"] = serde_json::json!(ix.data.len());
        } else {
            vector["payloadHex"] = serde_json::json!(hex(&payload));
            vector["instructionDataHex"] = serde_json::json!(hex(&ix.data));
        }
        vector
    })
    .collect::<Vec<_>>();
    println!("{}", serde_json::to_string_pretty(&serde_json::json!({
        "provenance": {
            "agaveTag": "v2.2.20",
            "agaveCommit": "df1f50cc0045157e099dcb047b853f611b6050d9",
            "agaveWorkspaceDependency": "solana-loader-v3-interface = 5.0.0",
            "interfaceCrate": "solana-loader-v3-interface",
            "interfaceVersion": "5.0.0",
            "interfaceChecksum": "6f7162a05b8b0773156b443bccd674ea78bb9aa406325b467ea78c06c99a63a2",
            "enumVariant": "UpgradeableLoaderInstruction::Write",
            "enumDiscriminant": 1,
            "serialization": "bincode-1.3.3",
            "generator": "tools/loader-v3-vectors",
        },
        "vectors": vectors,
    })).expect("fixture JSON serializes"));
}
