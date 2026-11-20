// Protocol calls carry many plain fields, and some return shapes are long by nature.
#![allow(clippy::too_many_arguments, clippy::type_complexity)]

pub mod agent_relay;
pub mod computer_names;
pub mod fs;
pub mod identity;
pub mod journal;
mod locks;
pub mod platform;
pub mod protocol;
pub mod retry;
pub mod server;
pub mod sync;
pub mod watcher;
pub mod works;
pub mod rooms;

pub const BRIDGE_PORT: u16 = 47_615;
pub const PROTOCOL_VERSION: &str = "1.0";
