use serde::Deserialize;
use std::sync::LazyLock;
use std::time::Duration;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RetryPolicy {
    initial_delay_ms: u64,
    max_delay_ms: u64,
    jitter_percent: u64,
    bridge_mount_repair_initial_delay_ms: u64,
    bridge_mount_repair_max_delay_ms: u64,
    bridge_claim_lease_ms: u64,
    bridge_payload_timeout_ms: u64,
    bridge_write_retention_ms: u64,
    collaboration_min_delay_ms: u64,
}

static POLICY: LazyLock<RetryPolicy> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../shared/sync-retry-policy.json"))
        .expect("shared sync retry policy must be valid")
});

pub fn retry_delay_ms(attempt: u32, key: &str) -> u64 {
    retry_delay_ms_with_bounds(attempt, key, POLICY.initial_delay_ms, POLICY.max_delay_ms)
}

pub fn bridge_mount_repair_delay_ms(attempt: u32, key: &str) -> u64 {
    retry_delay_ms_with_bounds(
        attempt,
        key,
        POLICY.bridge_mount_repair_initial_delay_ms,
        POLICY.bridge_mount_repair_max_delay_ms,
    )
}

fn retry_delay_ms_with_bounds(
    attempt: u32,
    key: &str,
    initial_delay_ms: u64,
    max_delay_ms: u64,
) -> u64 {
    let attempt = attempt.max(1);
    let exponent = attempt.saturating_sub(1).min(30);
    let nominal = initial_delay_ms
        .saturating_mul(1_u64 << exponent)
        .min(max_delay_ms);
    let spread = nominal.saturating_mul(POLICY.jitter_percent) / 100;
    if spread == 0 {
        return nominal;
    }
    let offset = stable_hash(&format!("{key}:{attempt}")) % (spread * 2 + 1);
    nominal
        .saturating_sub(spread)
        .saturating_add(offset)
        .max(initial_delay_ms)
        .min(max_delay_ms)
}

/// A retry is never scheduled further ahead than this. A due time beyond it
/// was computed against a wall clock that has since been set back (manual
/// change, NTP correction after a dead CMOS battery); treating it as due keeps
/// the queue from stalling for the size of the jump.
pub fn retry_schedule_horizon() -> Duration {
    Duration::from_millis(
        POLICY
            .max_delay_ms
            .max(POLICY.bridge_mount_repair_max_delay_ms),
    ) + Duration::from_secs(60)
}

pub fn bridge_claim_lease() -> Duration {
    Duration::from_millis(POLICY.bridge_claim_lease_ms)
}

pub fn bridge_payload_timeout() -> Duration {
    Duration::from_millis(POLICY.bridge_payload_timeout_ms)
}

/// Slowest link a native package transfer must still complete on: a crowded
/// school network or a phone hotspot. Only a stalled transfer should time out.
const MIN_PAYLOAD_BYTES_PER_SECOND: u64 = 256 * 1024;

/// Whole-transfer budget for a native package of `bytes`. A fixed budget let
/// only small files through: a 40 MB deck never finished uploading or
/// downloading on an ordinary school connection and retried forever.
pub fn bridge_payload_transfer_timeout(bytes: u64) -> Duration {
    bridge_payload_timeout()
        + Duration::from_millis(bytes.saturating_mul(1_000) / MIN_PAYLOAD_BYTES_PER_SECOND)
}

pub fn bridge_write_retention() -> Duration {
    Duration::from_millis(POLICY.bridge_write_retention_ms)
}

pub fn collaboration_min_delay() -> Duration {
    Duration::from_millis(POLICY.collaboration_min_delay_ms)
}

fn stable_hash(value: &str) -> u64 {
    u64::from(value.as_bytes().iter().fold(0x811c9dc5_u32, |hash, byte| {
        (hash ^ u32::from(*byte)).wrapping_mul(0x01000193)
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_schedule_is_stable_spread_and_capped() {
        assert_eq!(retry_delay_ms(1, "work-a"), retry_delay_ms(1, "work-a"));
        assert_ne!(retry_delay_ms(1, "work-a"), retry_delay_ms(1, "work-b"));
        assert!(retry_delay_ms(1, "work-a") >= 800);
        assert!(retry_delay_ms(1, "work-a") <= 1_200);
        assert!(retry_delay_ms(100, "work-a") <= 60_000);
    }

    #[test]
    fn payload_transfer_budget_grows_with_the_package() {
        assert_eq!(bridge_payload_transfer_timeout(0), bridge_payload_timeout());
        assert!(bridge_payload_transfer_timeout(64 * 1024) < Duration::from_secs(16));
        // A 40 MB deck at 2 Mbit/s needs ~160 s; the budget must allow it.
        assert!(bridge_payload_transfer_timeout(40 * 1024 * 1024) >= Duration::from_secs(160));
        assert!(bridge_payload_transfer_timeout(100 * 1024 * 1024) <= Duration::from_secs(20 * 60));
    }

    #[test]
    fn mount_repair_backoff_is_stable_and_capped() {
        let first = bridge_mount_repair_delay_ms(1, "grant-safe");
        let second = bridge_mount_repair_delay_ms(2, "grant-safe");
        assert!((4_000..=6_000).contains(&first));
        assert!(second > first);
        assert_eq!(first, bridge_mount_repair_delay_ms(1, "grant-safe"));
        assert!(bridge_mount_repair_delay_ms(100, "grant-safe") <= 900_000);
    }
}
