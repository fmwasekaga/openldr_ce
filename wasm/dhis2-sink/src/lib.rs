//! DHIS2 aggregate + tracker sink plugin. Pure mapping/parsing modules (host-testable)
//! plus a wasm-only HTTP client + entrypoint module (added in later tasks).
pub mod types;
pub mod value;
pub mod uid;
pub mod mapping;
pub mod tracker;
