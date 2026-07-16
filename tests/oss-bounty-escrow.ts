import * as anchor from "@coral-xyz/anchor";
import assert from "node:assert/strict";
import {
  createAccount,
  createMint,
  getAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import { IDL } from "./idl.ts";
import {
  bn,
  deriveEscrowPda,
  deriveVaultPda,
  expectRejected,
  externalRefHash,
  fundActor,
  unixTimestamp,
  waitUntilTimestamp,
} from "./helpers.ts";

describe("oss-bounty-escrow: initialize and cancel", () => {
  const payer = Keypair.fromSeed(
    Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  );
  const provider = new anchor.AnchorProvider(
    new Connection("http://127.0.0.1:8899", "confirmed"),
    new anchor.Wallet(payer),
    { commitment: "confirmed" },
  );
  anchor.setProvider(provider);

  const program = new anchor.Program(IDL, provider);
  const sponsor = provider.wallet;
  const maintainer = Keypair.generate();
  const contributor = Keypair.generate();
  const attacker = Keypair.generate();

  let mint: PublicKey;
  let sponsorToken: PublicKey;
  let attackerToken: PublicKey;
  let contributorToken: PublicKey;

  before(async () => {
    await fundActor(provider, attacker.publicKey);
    mint = await createMint(
      provider.connection,
      sponsor.payer!,
      sponsor.publicKey,
      null,
      6,
    );
    sponsorToken = await createAccount(
      provider.connection,
      sponsor.payer!,
      mint,
      sponsor.publicKey,
    );
    attackerToken = await createAccount(
      provider.connection,
      sponsor.payer!,
      mint,
      attacker.publicKey,
    );
    contributorToken = await createAccount(
      provider.connection,
      sponsor.payer!,
      mint,
      contributor.publicKey,
    );
    await fundActor(provider, maintainer.publicKey);
    await mintTo(
      provider.connection,
      sponsor.payer!,
      mint,
      sponsorToken,
      sponsor.payer!,
      20_000_000,
    );
    await mintTo(
      provider.connection,
      sponsor.payer!,
      mint,
      attackerToken,
      sponsor.payer!,
      2_000_000,
    );
  });

  async function initialize(reference: string, overrides?: {
    referenceHash?: number[];
    amount?: number;
    expiry?: number;
    maintainer?: PublicKey;
    contributor?: PublicKey;
  }) {
    const referenceHash =
      overrides?.referenceHash ?? externalRefHash(reference);
    const escrow = deriveEscrowPda(sponsor.publicKey, referenceHash);
    const vault = deriveVaultPda(escrow);
    const now = await unixTimestamp(provider);

    await (program.methods as any)
      .initializeEscrow(
        referenceHash,
        bn(overrides?.amount ?? 1_000_000),
        bn(overrides?.expiry ?? now + 3_600),
        overrides?.maintainer ?? maintainer.publicKey,
        overrides?.contributor ?? contributor.publicKey,
      )
      .accounts({
        sponsor: sponsor.publicKey,
        mint,
        escrow,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { escrow, referenceHash, vault };
  }

  async function fund(escrow: PublicKey, vault: PublicKey) {
    await (program.methods as any)
      .fundEscrow()
      .accounts({
        sponsor: sponsor.publicKey,
        mint,
        sponsorToken,
        escrow,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  it("initializes an escrow and deterministic classic SPL-token vault", async () => {
    const { escrow, referenceHash, vault } = await initialize(
      "github:example/project#101",
    );

    const account = await (program.account as any).escrow.fetch(escrow);
    assert.equal(account.sponsor.toBase58(), sponsor.publicKey.toBase58());
    assert.equal(account.maintainer.toBase58(), maintainer.publicKey.toBase58());
    assert.equal(account.contributor.toBase58(), contributor.publicKey.toBase58());
    assert.equal(account.mint.toBase58(), mint.toBase58());
    assert.equal(account.vault.toBase58(), vault.toBase58());
    assert.deepEqual([...account.externalRefHash], referenceHash);
    assert.equal(account.amount.toString(), "1000000");
    assert.deepEqual(account.status, { initialized: {} });
  });

  it("rejects zero amount", async () => {
    await expectRejected(
      initialize("github:example/project#102", { amount: 0 }),
      "InvalidAmount",
    );
  });

  it("rejects an empty external reference hash", async () => {
    await expectRejected(
      initialize("unused-empty-reference", {
        referenceHash: Array<number>(32).fill(0),
      }),
      "InvalidExternalReference",
    );
  });

  it("rejects expiry at the current timestamp", async () => {
    const now = await unixTimestamp(provider);
    await expectRejected(
      initialize("github:example/project#103", { expiry: now }),
      "InvalidExpiry",
    );
  });

  it("rejects default maintainer and contributor keys", async () => {
    await expectRejected(
      initialize("github:example/project#104", {
        maintainer: PublicKey.default,
      }),
      "InvalidMaintainer",
    );
    await expectRejected(
      initialize("github:example/project#105", {
        contributor: PublicKey.default,
      }),
      "InvalidContributor",
    );
  });

  it("rejects duplicate sponsor/reference identity", async () => {
    const reference = "github:example/project#106";
    await initialize(reference);
    await expectRejected(initialize(reference), "already in use");
  });

  it("allows only the sponsor to cancel an initialized escrow", async () => {
    const { escrow } = await initialize("github:example/project#107");

    await expectRejected(
      (program.methods as any)
        .cancel()
        .accounts({ sponsor: attacker.publicKey, escrow })
        .signers([attacker])
        .rpc(),
      "ConstraintHasOne",
    );

    await (program.methods as any)
      .cancel()
      .accounts({ sponsor: sponsor.publicKey, escrow })
      .rpc();

    const account = await (program.account as any).escrow.fetch(escrow);
    assert.deepEqual(account.status, { cancelled: {} });
  });

  it("rejects cancellation replay", async () => {
    const { escrow } = await initialize("github:example/project#108");
    await (program.methods as any)
      .cancel()
      .accounts({ sponsor: sponsor.publicKey, escrow })
      .rpc();

    await expectRejected(
      (program.methods as any)
        .cancel()
        .accounts({ sponsor: sponsor.publicKey, escrow })
        .rpc(),
      "InvalidStatus",
    );
  });

  it("funds exactly the recorded amount", async () => {
    const { escrow, vault } = await initialize("github:example/project#109");
    const sponsorBefore = await getAccount(provider.connection, sponsorToken);

    await fund(escrow, vault);

    const sponsorAfter = await getAccount(provider.connection, sponsorToken);
    const vaultAfter = await getAccount(provider.connection, vault);
    const account = await (program.account as any).escrow.fetch(escrow);

    assert.equal(sponsorBefore.amount - sponsorAfter.amount, 1_000_000n);
    assert.equal(vaultAfter.amount, 1_000_000n);
    assert.deepEqual(account.status, { funded: {} });
  });

  it("rejects funding by a non-sponsor", async () => {
    const { escrow, vault } = await initialize("github:example/project#110");

    await expectRejected(
      (program.methods as any)
        .fundEscrow()
        .accounts({
          sponsor: attacker.publicKey,
          mint,
          sponsorToken: attackerToken,
          escrow,
          vault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([attacker])
        .rpc(),
      "ConstraintHasOne",
    );
  });

  it("rejects a token source not owned by the sponsor", async () => {
    const { escrow, vault } = await initialize("github:example/project#111");

    await expectRejected(
      (program.methods as any)
        .fundEscrow()
        .accounts({
          sponsor: sponsor.publicKey,
          mint,
          sponsorToken: attackerToken,
          escrow,
          vault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "ConstraintTokenOwner",
    );
  });

  it("rejects repeated funding", async () => {
    const { escrow, vault } = await initialize("github:example/project#112");
    const accounts = {
      sponsor: sponsor.publicKey,
      mint,
      sponsorToken,
      escrow,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    };

    await (program.methods as any).fundEscrow().accounts(accounts).rpc();
    await expectRejected(
      (program.methods as any).fundEscrow().accounts(accounts).rpc(),
      "InvalidStatus",
    );
  });

  it("rejects funding when the source balance is insufficient", async () => {
    const { escrow, vault } = await initialize("github:example/project#113");
    const emptySource = await createAccount(
      provider.connection,
      sponsor.payer!,
      mint,
      sponsor.publicKey,
      Keypair.generate(),
    );

    await expectRejected(
      (program.methods as any)
        .fundEscrow()
        .accounts({
          sponsor: sponsor.publicKey,
          mint,
          sponsorToken: emptySource,
          escrow,
          vault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "insufficient funds",
    );
  });

  it("rejects funding with the wrong mint", async () => {
    const { escrow, vault } = await initialize("github:example/project#114");
    const otherMint = await createMint(
      provider.connection,
      sponsor.payer!,
      sponsor.publicKey,
      null,
      6,
    );
    const otherSource = await createAccount(
      provider.connection,
      sponsor.payer!,
      otherMint,
      sponsor.publicKey,
    );

    await expectRejected(
      (program.methods as any)
        .fundEscrow()
        .accounts({
          sponsor: sponsor.publicKey,
          mint: otherMint,
          sponsorToken: otherSource,
          escrow,
          vault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "ConstraintHasOne",
    );
  });

  it("rejects a different token account in place of the recorded vault", async () => {
    const { escrow } = await initialize("github:example/project#125");
    const alternateVault = await createAccount(
      provider.connection,
      sponsor.payer!,
      mint,
      escrow,
      Keypair.generate(),
    );

    await expectRejected(
      (program.methods as any)
        .fundEscrow()
        .accounts({
          sponsor: sponsor.publicKey,
          mint,
          sponsorToken,
          escrow,
          vault: alternateVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "InvalidVault",
    );
  });

  it("rejects funding at or after expiry", async () => {
    const now = await unixTimestamp(provider);
    const expiry = now + 8;
    const { escrow, vault } = await initialize("github:example/project#115", {
      expiry,
    });
    await waitUntilTimestamp(provider, expiry);

    await expectRejected(
      (program.methods as any)
        .fundEscrow()
        .accounts({
          sponsor: sponsor.publicKey,
          mint,
          sponsorToken,
          escrow,
          vault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "EscrowExpired",
    );
  });

  it("rejects release before funding", async () => {
    const { escrow, vault } = await initialize("github:example/project#116");

    await expectRejected(
      (program.methods as any)
        .release()
        .accounts({
          maintainer: maintainer.publicKey,
          mint,
          escrow,
          vault,
          contributorToken,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([maintainer])
        .rpc(),
      "InvalidStatus",
    );
  });

  it("allows only the configured maintainer to release", async () => {
    const { escrow, vault } = await initialize("github:example/project#117");
    await fund(escrow, vault);

    await expectRejected(
      (program.methods as any)
        .release()
        .accounts({
          maintainer: attacker.publicKey,
          mint,
          escrow,
          vault,
          contributorToken,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([attacker])
        .rpc(),
      "ConstraintHasOne",
    );
  });

  it("releases exactly the recorded amount to the contributor", async () => {
    const { escrow, vault } = await initialize("github:example/project#118");
    await fund(escrow, vault);
    const contributorBefore = await getAccount(
      provider.connection,
      contributorToken,
    );

    await (program.methods as any)
      .release()
      .accounts({
        maintainer: maintainer.publicKey,
        mint,
        escrow,
        vault,
        contributorToken,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([maintainer])
      .rpc();

    const contributorAfter = await getAccount(
      provider.connection,
      contributorToken,
    );
    const vaultAfter = await getAccount(provider.connection, vault);
    const account = await (program.account as any).escrow.fetch(escrow);

    assert.equal(contributorAfter.amount - contributorBefore.amount, 1_000_000n);
    assert.equal(vaultAfter.amount, 0n);
    assert.deepEqual(account.status, { released: {} });
  });

  it("rejects release to a token account not owned by the contributor", async () => {
    const { escrow, vault } = await initialize("github:example/project#119");
    await fund(escrow, vault);

    await expectRejected(
      (program.methods as any)
        .release()
        .accounts({
          maintainer: maintainer.publicKey,
          mint,
          escrow,
          vault,
          contributorToken: sponsorToken,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([maintainer])
        .rpc(),
      "InvalidContributorTokenOwner",
    );
  });

  it("rejects release at expiry and allows sponsor refund", async () => {
    const now = await unixTimestamp(provider);
    const expiry = now + 8;
    const { escrow, vault } = await initialize("github:example/project#120", {
      expiry,
    });
    await fund(escrow, vault);
    await waitUntilTimestamp(provider, expiry);

    await expectRejected(
      (program.methods as any)
        .release()
        .accounts({
          maintainer: maintainer.publicKey,
          mint,
          escrow,
          vault,
          contributorToken,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([maintainer])
        .rpc(),
      "EscrowExpired",
    );

    const sponsorBefore = await getAccount(provider.connection, sponsorToken);
    await (program.methods as any)
      .refund()
      .accounts({
        sponsor: sponsor.publicKey,
        mint,
        escrow,
        vault,
        sponsorToken,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    const sponsorAfter = await getAccount(provider.connection, sponsorToken);
    assert.equal(sponsorAfter.amount - sponsorBefore.amount, 1_000_000n);
  });

  it("rejects refund before expiry", async () => {
    const { escrow, vault } = await initialize("github:example/project#121");
    await fund(escrow, vault);

    await expectRejected(
      (program.methods as any)
        .refund()
        .accounts({
          sponsor: sponsor.publicKey,
          mint,
          escrow,
          vault,
          sponsorToken,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "EscrowNotExpired",
    );
  });

  it("rejects refund by a non-sponsor", async () => {
    const now = await unixTimestamp(provider);
    const expiry = now + 8;
    const { escrow, vault } = await initialize("github:example/project#124", {
      expiry,
    });
    await fund(escrow, vault);
    await waitUntilTimestamp(provider, expiry);

    await expectRejected(
      (program.methods as any)
        .refund()
        .accounts({
          sponsor: attacker.publicKey,
          mint,
          escrow,
          vault,
          sponsorToken: attackerToken,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([attacker])
        .rpc(),
      "UnauthorizedSponsor",
    );
  });

  it("refunds only principal and leaves unsolicited dust in the vault", async () => {
    const now = await unixTimestamp(provider);
    const expiry = now + 8;
    const { escrow, vault } = await initialize("github:example/project#126", {
      expiry,
    });
    await fund(escrow, vault);
    await mintTo(
      provider.connection,
      sponsor.payer!,
      mint,
      vault,
      sponsor.payer!,
      11,
    );
    await waitUntilTimestamp(provider, expiry);
    const sponsorBefore = await getAccount(provider.connection, sponsorToken);

    await (program.methods as any)
      .refund()
      .accounts({
        sponsor: sponsor.publicKey,
        mint,
        escrow,
        vault,
        sponsorToken,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const sponsorAfter = await getAccount(provider.connection, sponsorToken);
    const vaultAfter = await getAccount(provider.connection, vault);
    const account = await (program.account as any).escrow.fetch(escrow);

    assert.equal(sponsorAfter.amount - sponsorBefore.amount, 1_000_000n);
    assert.equal(vaultAfter.amount, 11n);
    assert.deepEqual(account.status, { refunded: {} });
  });

  it("rejects terminal replay and conflicting settlement", async () => {
    const { escrow, vault } = await initialize("github:example/project#122");
    await fund(escrow, vault);
    const releaseAccounts = {
      maintainer: maintainer.publicKey,
      mint,
      escrow,
      vault,
      contributorToken,
      tokenProgram: TOKEN_PROGRAM_ID,
    };

    await (program.methods as any)
      .release()
      .accounts(releaseAccounts)
      .signers([maintainer])
      .rpc();

    await expectRejected(
      (program.methods as any)
        .release()
        .accounts(releaseAccounts)
        .signers([maintainer])
        .rpc(),
      "InvalidStatus",
    );
    await expectRejected(
      (program.methods as any)
        .refund()
        .accounts({
          sponsor: sponsor.publicKey,
          mint,
          escrow,
          vault,
          sponsorToken,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "InvalidStatus",
    );
  });

  it("ignores unsolicited vault tokens when releasing the recorded obligation", async () => {
    const { escrow, vault } = await initialize("github:example/project#123");
    await fund(escrow, vault);
    await mintTo(
      provider.connection,
      sponsor.payer!,
      mint,
      vault,
      sponsor.payer!,
      7,
    );
    const contributorBefore = await getAccount(
      provider.connection,
      contributorToken,
    );

    await (program.methods as any)
      .release()
      .accounts({
        maintainer: maintainer.publicKey,
        mint,
        escrow,
        vault,
        contributorToken,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([maintainer])
      .rpc();

    const contributorAfter = await getAccount(
      provider.connection,
      contributorToken,
    );
    const vaultAfter = await getAccount(provider.connection, vault);
    assert.equal(contributorAfter.amount - contributorBefore.amount, 1_000_000n);
    assert.equal(vaultAfter.amount, 7n);
  });
});
