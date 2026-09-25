//! Guard math from PRD 6.6, kept free of account types so the same functions
//! run in the program, in property tests and against the golden vectors in
//! `tests/vectors/guard.json`, which `packages/guard-math` checks too.
//!
//! Prices are fixed point at 1e9 and Scaled UI multipliers at 1e12. Each
//! formula is one numerator over one denominator, each a u128 product checked
//! factor by factor in the order written here, floored once. `None` means a
//! product overflowed u128, the denominator was zero, or the quotient does not
//! fit u64; the program reports all three as `MathOverflow`.

pub const PRICE_SCALE_EXP: u32 = 9;
pub const MULTIPLIER_SCALE: f64 = 1e12;
pub const BPS: u128 = 10_000;
/// 1e12 multiplier scale over 1e6 USDC scale.
const MULTIPLIER_OVER_USDC_SCALE: u128 = 1_000_000;

/// Converts a Scaled UI multiplier to fixed point at 1e12, truncating like
/// Rust's `as u128`. Zero after truncation would disable the guard, so it is
/// rejected along with non-finite and non-positive values.
pub fn multiplier_to_e12(multiplier: f64) -> Option<u128> {
    if !multiplier.is_finite() || multiplier <= 0.0 {
        return None;
    }
    let scaled = (multiplier * MULTIPLIER_SCALE) as u128;
    (scaled > 0).then_some(scaled)
}

/// Converts a Pyth price with its exponent to fixed point at 1e9, flooring
/// when the exponent is finer than 1e-9.
pub fn pyth_price_to_e9(price: i64, exponent: i32) -> Option<u64> {
    if price <= 0 {
        return None;
    }
    let price = price as u128;
    let shift = PRICE_SCALE_EXP as i32 + exponent;
    let scaled = if shift >= 0 {
        price.checked_mul(10u128.checked_pow(shift as u32)?)?
    } else {
        price / 10u128.checked_pow(shift.unsigned_abs())?
    };
    let scaled = u64::try_from(scaled).ok()?;
    (scaled > 0).then_some(scaled)
}

fn pow10(exp: u8) -> Option<u128> {
    10u128.checked_pow(u32::from(exp))
}

fn product(factors: &[Option<u128>]) -> Option<u128> {
    factors
        .iter()
        .try_fold(1u128, |acc, factor| acc.checked_mul((*factor)?))
}

fn floor_div_to_u64(numerator: u128, denominator: u128) -> Option<u64> {
    let quotient = numerator.checked_div(denominator)?;
    u64::try_from(quotient).ok()
}

#[derive(Clone, Copy, Debug)]
pub struct BuyInputs {
    /// USDC swapped, base units (leg amount less the fee).
    pub usdc_in: u64,
    pub usdc_price_e9: u64,
    pub price_e9: u64,
    pub band_bps: u16,
    pub multiplier_e12: u128,
    pub decimals: u8,
}

/// floor(U * u * 10^d / (10^6 * P * (1 + b/10^4) * m)), as
/// (U * u_e9 * 10^d * 10^4 * 10^6) / (P_e9 * (10^4 + b) * m_e12).
pub fn min_out_buy(inputs: &BuyInputs) -> Option<u64> {
    let numerator = product(&[
        Some(u128::from(inputs.usdc_in)),
        Some(u128::from(inputs.usdc_price_e9)),
        pow10(inputs.decimals),
        Some(BPS),
        Some(MULTIPLIER_OVER_USDC_SCALE),
    ])?;
    let denominator = product(&[
        Some(u128::from(inputs.price_e9)),
        BPS.checked_add(u128::from(inputs.band_bps)),
        Some(inputs.multiplier_e12),
    ])?;
    floor_div_to_u64(numerator, denominator)
}

#[derive(Clone, Copy, Debug)]
pub struct SellInputs {
    /// Shares sold, raw base units.
    pub amount_in: u64,
    pub usdc_price_e9: u64,
    pub price_e9: u64,
    pub band_bps: u16,
    pub multiplier_e12: u128,
    pub decimals: u8,
}

/// floor(S * m * P * (1 - b/10^4) * 10^6 / (10^d * u)), as
/// (S * m_e12 * P_e9 * (10^4 - b)) / (10^d * u_e9 * 10^4 * 10^6).
pub fn min_usdc_sell(inputs: &SellInputs) -> Option<u64> {
    let numerator = product(&[
        Some(u128::from(inputs.amount_in)),
        Some(inputs.multiplier_e12),
        Some(u128::from(inputs.price_e9)),
        BPS.checked_sub(u128::from(inputs.band_bps)),
    ])?;
    let denominator = product(&[
        pow10(inputs.decimals),
        Some(u128::from(inputs.usdc_price_e9)),
        Some(BPS),
        Some(MULTIPLIER_OVER_USDC_SCALE),
    ])?;
    floor_div_to_u64(numerator, denominator)
}

#[derive(Clone, Copy, Debug)]
pub struct ConvertInputs {
    /// Pre-IPO tokens converted, raw base units.
    pub amount_in: u64,
    pub multiplier_pre_e12: u128,
    pub decimals_pre: u8,
    pub ratio_num: u64,
    pub ratio_den: u64,
    pub band_bps: u16,
    pub multiplier_target_e12: u128,
    pub decimals_target: u8,
}

/// floor(S * m_pre / 10^d_pre * r * (1 - b/10^4) * 10^d_t / m_t), as
/// (S * m_pre_e12 * r_num * (10^4 - b) * 10^d_t) / (10^d_pre * r_den * 10^4 * m_t_e12).
pub fn min_target_convert(inputs: &ConvertInputs) -> Option<u64> {
    let numerator = product(&[
        Some(u128::from(inputs.amount_in)),
        Some(inputs.multiplier_pre_e12),
        Some(u128::from(inputs.ratio_num)),
        BPS.checked_sub(u128::from(inputs.band_bps)),
        pow10(inputs.decimals_target),
    ])?;
    let denominator = product(&[
        pow10(inputs.decimals_pre),
        Some(u128::from(inputs.ratio_den)),
        Some(BPS),
        Some(inputs.multiplier_target_e12),
    ])?;
    floor_div_to_u64(numerator, denominator)
}

/// floor(amount * bps / 10^4)
pub fn bps_of(amount: u64, bps: u16) -> Option<u64> {
    let value = u128::from(amount).checked_mul(u128::from(bps))? / BPS;
    u64::try_from(value).ok()
}

/// True when `conf / price <= max_conf_bps / 10^4`.
pub fn confidence_within(price: u64, conf: u64, max_conf_bps: u16) -> bool {
    price > 0 && u128::from(conf) * BPS <= u128::from(price) * u128::from(max_conf_bps)
}

/// True when the USDC/USD price sits within `peg_bps` of 1.00.
pub fn usdc_on_peg(usdc_price_e9: u64, peg_bps: u16) -> bool {
    let one = 10u64.pow(PRICE_SCALE_EXP);
    u128::from(usdc_price_e9.abs_diff(one)) * BPS <= u128::from(one) * u128::from(peg_bps)
}

#[cfg(test)]
mod tests {
    use super::*;

    const E9: u64 = 1_000_000_000;
    const ONE_E12: u128 = 1_000_000_000_000;

    #[test]
    fn buy_one_share_at_par() {
        let inputs = BuyInputs {
            usdc_in: 100_000_000,
            usdc_price_e9: E9,
            price_e9: 100 * E9,
            band_bps: 0,
            multiplier_e12: ONE_E12,
            decimals: 8,
        };
        assert_eq!(min_out_buy(&inputs), Some(100_000_000));
    }

    #[test]
    fn buy_band_lowers_minimum() {
        let inputs = BuyInputs {
            usdc_in: 100_000_000,
            usdc_price_e9: E9,
            price_e9: 100 * E9,
            band_bps: 100,
            multiplier_e12: ONE_E12,
            decimals: 8,
        };
        assert_eq!(min_out_buy(&inputs), Some(99_009_900));
    }

    #[test]
    fn sell_one_share_at_par() {
        let inputs = SellInputs {
            amount_in: 100_000_000,
            usdc_price_e9: E9,
            price_e9: 100 * E9,
            band_bps: 0,
            multiplier_e12: ONE_E12,
            decimals: 8,
        };
        assert_eq!(min_usdc_sell(&inputs), Some(100_000_000));
    }

    #[test]
    fn convert_five_for_one() {
        let inputs = ConvertInputs {
            amount_in: E9,
            multiplier_pre_e12: ONE_E12,
            decimals_pre: 9,
            ratio_num: 5,
            ratio_den: 1,
            band_bps: 0,
            multiplier_target_e12: ONE_E12,
            decimals_target: 8,
        };
        assert_eq!(min_target_convert(&inputs), Some(500_000_000));
    }

    #[test]
    fn zero_price_is_rejected() {
        let inputs = BuyInputs {
            usdc_in: 1,
            usdc_price_e9: E9,
            price_e9: 0,
            band_bps: 0,
            multiplier_e12: ONE_E12,
            decimals: 8,
        };
        assert_eq!(min_out_buy(&inputs), None);
    }

    #[test]
    fn pyth_exponents_convert_to_e9() {
        assert_eq!(pyth_price_to_e9(18_012_345, -5), Some(180_123_450_000));
        assert_eq!(pyth_price_to_e9(99_990_000, -8), Some(999_900_000));
        assert_eq!(pyth_price_to_e9(123_456_789_012, -11), Some(1_234_567_890));
        assert_eq!(pyth_price_to_e9(0, -8), None);
        assert_eq!(pyth_price_to_e9(-5, -8), None);
    }

    #[test]
    fn multiplier_truncates_to_e12() {
        assert_eq!(
            multiplier_to_e12(1.000_918_075_849_099_6),
            Some(1_000_918_075_849)
        );
        assert_eq!(multiplier_to_e12(1.0), Some(ONE_E12));
        assert_eq!(multiplier_to_e12(f64::NAN), None);
        assert_eq!(multiplier_to_e12(0.0), None);
        assert_eq!(multiplier_to_e12(1e-13), None);
    }

    #[test]
    fn peg_and_confidence_bounds() {
        assert!(usdc_on_peg(995_000_000, 50));
        assert!(usdc_on_peg(1_005_000_000, 50));
        assert!(!usdc_on_peg(994_999_999, 50));
        assert!(!usdc_on_peg(1_005_000_001, 50));
        assert!(confidence_within(10_000, 50, 50));
        assert!(!confidence_within(10_000, 51, 50));
    }
}
