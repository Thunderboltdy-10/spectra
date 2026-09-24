pub mod fs;
pub mod identity;
pub mod journal;
pub mod platform;
pub mod protocol;
pub mod retry;
pub mod server;
pub mod sync;
pub mod watcher;

pub const BRIDGE_PORT: u16 = 47_615;
pub const PROTOCOL_VERSION: &str = "1.0";
