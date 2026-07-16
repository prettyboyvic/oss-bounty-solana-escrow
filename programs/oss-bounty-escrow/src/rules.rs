use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, InitSpace, PartialEq)]
pub enum EscrowStatus {
    Initialized,
    Funded,
    Released,
    Refunded,
    Cancelled,
}

#[error_code]
#[derive(Eq, PartialEq)]
pub enum EscrowError {
    #[msg("The escrow is not in the required state.")]
    InvalidStatus,
    #[msg("The escrow amount must be greater than zero.")]
    InvalidAmount,
    #[msg("The escrow expiry must be in the future.")]
    InvalidExpiry,
    #[msg("The maintainer public key must not be the default key.")]
    InvalidMaintainer,
    #[msg("The contributor public key must not be the default key.")]
    InvalidContributor,
    #[msg("The release destination must be owned by the configured contributor.")]
    InvalidContributorTokenOwner,
    #[msg("Only the recorded sponsor may perform this action.")]
    UnauthorizedSponsor,
    #[msg("The escrow has reached or passed its expiry.")]
    EscrowExpired,
    #[msg("The escrow has not reached its expiry.")]
    EscrowNotExpired,
    #[msg("The provided vault does not match the vault recorded by the escrow.")]
    InvalidVault,
    #[msg("The external reference hash must not be all zeros.")]
    InvalidExternalReference,
}

pub fn validate_initialization(
    external_ref_hash: [u8; 32],
    amount: u64,
    now: i64,
    expiry: i64,
    maintainer: Pubkey,
    contributor: Pubkey,
) -> core::result::Result<(), EscrowError> {
    if external_ref_hash == [0; 32] {
        return Err(EscrowError::InvalidExternalReference);
    }
    if amount == 0 {
        return Err(EscrowError::InvalidAmount);
    }
    if expiry <= now {
        return Err(EscrowError::InvalidExpiry);
    }
    if maintainer == Pubkey::default() {
        return Err(EscrowError::InvalidMaintainer);
    }
    if contributor == Pubkey::default() {
        return Err(EscrowError::InvalidContributor);
    }
    Ok(())
}

pub fn validate_sponsor(
    expected_sponsor: Pubkey,
    signer: Pubkey,
) -> core::result::Result<(), EscrowError> {
    if signer != expected_sponsor {
        return Err(EscrowError::UnauthorizedSponsor);
    }
    Ok(())
}

pub fn can_fund(
    status: EscrowStatus,
    now: i64,
    expiry: i64,
) -> core::result::Result<EscrowStatus, EscrowError> {
    if status != EscrowStatus::Initialized {
        return Err(EscrowError::InvalidStatus);
    }
    if now >= expiry {
        return Err(EscrowError::EscrowExpired);
    }
    Ok(EscrowStatus::Funded)
}

pub fn can_release(
    status: EscrowStatus,
    now: i64,
    expiry: i64,
) -> core::result::Result<EscrowStatus, EscrowError> {
    if status != EscrowStatus::Funded {
        return Err(EscrowError::InvalidStatus);
    }
    if now >= expiry {
        return Err(EscrowError::EscrowExpired);
    }
    Ok(EscrowStatus::Released)
}

pub fn can_refund(
    status: EscrowStatus,
    now: i64,
    expiry: i64,
) -> core::result::Result<EscrowStatus, EscrowError> {
    if status != EscrowStatus::Funded {
        return Err(EscrowError::InvalidStatus);
    }
    if now < expiry {
        return Err(EscrowError::EscrowNotExpired);
    }
    Ok(EscrowStatus::Refunded)
}

pub fn can_cancel(status: EscrowStatus) -> core::result::Result<EscrowStatus, EscrowError> {
    if status != EscrowStatus::Initialized {
        return Err(EscrowError::InvalidStatus);
    }
    Ok(EscrowStatus::Cancelled)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXPIRY: i64 = 1_000;

    #[test]
    fn funding_requires_initialized_state_before_expiry() {
        assert_eq!(
            can_fund(EscrowStatus::Initialized, EXPIRY - 1, EXPIRY),
            Ok(EscrowStatus::Funded)
        );
        assert_eq!(
            can_fund(EscrowStatus::Funded, EXPIRY - 1, EXPIRY),
            Err(EscrowError::InvalidStatus)
        );
        assert_eq!(
            can_fund(EscrowStatus::Initialized, EXPIRY, EXPIRY),
            Err(EscrowError::EscrowExpired)
        );
    }

    #[test]
    fn release_requires_funded_state_strictly_before_expiry() {
        assert_eq!(
            can_release(EscrowStatus::Funded, EXPIRY - 1, EXPIRY),
            Ok(EscrowStatus::Released)
        );
        assert_eq!(
            can_release(EscrowStatus::Initialized, EXPIRY - 1, EXPIRY),
            Err(EscrowError::InvalidStatus)
        );
        assert_eq!(
            can_release(EscrowStatus::Funded, EXPIRY, EXPIRY),
            Err(EscrowError::EscrowExpired)
        );
    }

    #[test]
    fn refund_requires_funded_state_at_or_after_expiry() {
        assert_eq!(
            can_refund(EscrowStatus::Funded, EXPIRY - 1, EXPIRY),
            Err(EscrowError::EscrowNotExpired)
        );
        assert_eq!(
            can_refund(EscrowStatus::Funded, EXPIRY, EXPIRY),
            Ok(EscrowStatus::Refunded)
        );
        assert_eq!(
            can_refund(EscrowStatus::Funded, EXPIRY + 1, EXPIRY),
            Ok(EscrowStatus::Refunded)
        );
        assert_eq!(
            can_refund(EscrowStatus::Released, EXPIRY, EXPIRY),
            Err(EscrowError::InvalidStatus)
        );
    }

    #[test]
    fn cancellation_requires_initialized_state() {
        assert_eq!(
            can_cancel(EscrowStatus::Initialized),
            Ok(EscrowStatus::Cancelled)
        );
        assert_eq!(
            can_cancel(EscrowStatus::Funded),
            Err(EscrowError::InvalidStatus)
        );
        assert_eq!(
            can_cancel(EscrowStatus::Cancelled),
            Err(EscrowError::InvalidStatus)
        );
    }

    #[test]
    fn initialization_requires_positive_amount() {
        let maintainer = Pubkey::new_unique();
        let contributor = Pubkey::new_unique();

        assert_eq!(
            validate_initialization([1; 32], 0, EXPIRY - 1, EXPIRY, maintainer, contributor),
            Err(EscrowError::InvalidAmount)
        );
    }

    #[test]
    fn initialization_rejects_zero_external_reference_hash() {
        assert_eq!(
            validate_initialization(
                [0; 32],
                1,
                EXPIRY - 1,
                EXPIRY,
                Pubkey::new_unique(),
                Pubkey::new_unique()
            ),
            Err(EscrowError::InvalidExternalReference)
        );
    }

    #[test]
    fn initialization_requires_future_expiry() {
        let maintainer = Pubkey::new_unique();
        let contributor = Pubkey::new_unique();

        assert_eq!(
            validate_initialization([1; 32], 1, EXPIRY, EXPIRY, maintainer, contributor),
            Err(EscrowError::InvalidExpiry)
        );
    }

    #[test]
    fn initialization_rejects_default_role_keys() {
        let valid = Pubkey::new_unique();

        assert_eq!(
            validate_initialization([1; 32], 1, EXPIRY - 1, EXPIRY, Pubkey::default(), valid),
            Err(EscrowError::InvalidMaintainer)
        );
        assert_eq!(
            validate_initialization([1; 32], 1, EXPIRY - 1, EXPIRY, valid, Pubkey::default()),
            Err(EscrowError::InvalidContributor)
        );
    }

    #[test]
    fn initialization_accepts_valid_inputs() {
        assert!(validate_initialization(
            [1; 32],
            1,
            EXPIRY - 1,
            EXPIRY,
            Pubkey::new_unique(),
            Pubkey::new_unique()
        )
        .is_ok());
    }

    #[test]
    fn sponsor_authority_must_match_the_recorded_sponsor() {
        let sponsor = Pubkey::new_unique();

        assert!(validate_sponsor(sponsor, sponsor).is_ok());
        assert_eq!(
            validate_sponsor(sponsor, Pubkey::new_unique()),
            Err(EscrowError::UnauthorizedSponsor)
        );
    }
}
