//! LiteSVM suite for paycheck_router. Needs the SBF builds in target/deploy:
//! `anchor build` and the test swap program (see `common::read_program`).

mod admin;
mod common;
mod inflow;
mod router;
mod vectors;
