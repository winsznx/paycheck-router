use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod guard;
pub mod state;

declare_id!("PayEFo1ZAPXKf5H4DoqrsEceYzdSvXJBAGBD7AMQY6H");

#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "Paycheck Router",
    project_url: "https://github.com/winsznx/paycheck-router",
    contacts: "link:https://github.com/winsznx/paycheck-router/security/advisories/new",
    policy: "https://github.com/winsznx/paycheck-router/security/policy",
    preferred_languages: "en",
    source_code: "https://github.com/winsznx/paycheck-router"
}
