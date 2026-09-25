//! Checks the program's guard math against the shared golden vectors that
//! `packages/guard-math` also runs.

use paycheck_router::guard::{self, BuyInputs, ConvertInputs, SellInputs};
use serde_json::Value;

fn vectors() -> Value {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/vectors/guard.json");
    let text = std::fs::read_to_string(&path).expect("tests/vectors/guard.json");
    serde_json::from_str(&text).unwrap()
}

fn int<T: std::str::FromStr>(inputs: &Value, key: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    inputs[key]
        .as_str()
        .unwrap_or_else(|| panic!("{key} missing"))
        .parse()
        .unwrap()
}

fn multiplier(inputs: &Value, key: &str) -> Option<u128> {
    let value: f64 = int(inputs, key);
    guard::multiplier_to_e12(value)
}

fn evaluate(kind: &str, inputs: &Value) -> Option<u64> {
    match kind {
        "buy" => guard::min_out_buy(&BuyInputs {
            usdc_in: int(inputs, "usdc_in"),
            usdc_price_e9: int(inputs, "usdc_price_e9"),
            price_e9: int(inputs, "price_e9"),
            band_bps: int(inputs, "band_bps"),
            multiplier_e12: multiplier(inputs, "multiplier")?,
            decimals: int(inputs, "decimals"),
        }),
        "sell" => guard::min_usdc_sell(&SellInputs {
            amount_in: int(inputs, "amount_in"),
            usdc_price_e9: int(inputs, "usdc_price_e9"),
            price_e9: int(inputs, "price_e9"),
            band_bps: int(inputs, "band_bps"),
            multiplier_e12: multiplier(inputs, "multiplier")?,
            decimals: int(inputs, "decimals"),
        }),
        "convert" => guard::min_target_convert(&ConvertInputs {
            amount_in: int(inputs, "amount_in"),
            multiplier_pre_e12: multiplier(inputs, "multiplier_pre")?,
            decimals_pre: int(inputs, "decimals_pre"),
            ratio_num: int(inputs, "ratio_num"),
            ratio_den: int(inputs, "ratio_den"),
            band_bps: int(inputs, "band_bps"),
            multiplier_target_e12: multiplier(inputs, "multiplier_target")?,
            decimals_target: int(inputs, "decimals_target"),
        }),
        other => panic!("unknown vector kind {other}"),
    }
}

#[test]
fn guard_matches_golden_vectors() {
    let doc = vectors();
    assert_eq!(doc["version"], 1);
    let list = doc["vectors"].as_array().unwrap();
    assert!(list.len() >= 25, "need at least 25 vectors");
    let mut kinds = std::collections::BTreeSet::new();
    for vector in list {
        let name = vector["name"].as_str().unwrap();
        let kind = vector["kind"].as_str().unwrap();
        kinds.insert(kind.to_string());
        let actual = evaluate(kind, &vector["inputs"]);
        match &vector["expected"] {
            Value::String(expected) => assert_eq!(
                actual,
                Some(expected.parse::<u64>().unwrap()),
                "vector {name}"
            ),
            Value::Object(error) => {
                assert_eq!(error["error"], "MathOverflow", "vector {name}");
                assert_eq!(actual, None, "vector {name}");
            }
            other => panic!("vector {name}: bad expected {other}"),
        }
    }
    assert_eq!(kinds.len(), 3, "buy, sell and convert all covered");
}
