//! LiteSVM suite for paycheck_router. Needs the SBF builds in target/deploy:
//! `anchor build` and the test swap program (see `common::read_program`).

mod admin;
mod common;
mod convert;
mod execute;
mod fixtures;
mod fuzz;
mod inflow;
mod market;
mod router;
mod snapshots;
mod swap;
mod vectors;
