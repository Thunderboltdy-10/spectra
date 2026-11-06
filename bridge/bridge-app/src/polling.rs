use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

pub const ACTIVE_POLL_INTERVAL: Duration = Duration::from_millis(250);
pub const MAX_POLL_DELAY: Duration = Duration::from_secs(15);
/// Remote work has no push signal in the Bridge protocol, so discovery remains
/// bounded by this interval even while local wakes are instantaneous.
pub const REMOTE_DISCOVERY_BOUND: Duration = MAX_POLL_DELAY;

/// With the work signal live, nothing new arrives unannounced: this is only a safety net.
pub const SIGNALLED_IDLE_DELAY: Duration = Duration::from_secs(60 * 60);
/// Queued work that a claim passed over, such as a retry not yet due.
pub const SIGNALLED_BUSY_DELAY: Duration = Duration::from_secs(5 * 60);

const IDLE_BASE: Duration = Duration::from_millis(500);
const FAILURE_BASE: Duration = Duration::from_secs(1);
const MAX_BASE_DELAY: Duration = Duration::from_secs(13);
const MAX_JITTER: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PollResult {
    /// A queued local or remote operation completed and may have created more work.
    WorkCompleted,
    /// All attempted remote calls succeeded, but there was no work to apply.
    SuccessfulIdle,
    /// The deployment or device is not configured yet.
    Disconnected,
    /// The device credential is not available.
    Unauthenticated,
    /// A configuration read or validation failed.
    FailedConfiguration,
    /// The one-time replica migration could not complete.
    FailedMigration,
    /// A request or its side effect failed and must be retried.
    FailedRequest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PollState {
    Active,
    Idle,
    Disconnected,
    Unauthenticated,
    FailedConfiguration,
    FailedMigration,
    FailedRequest,
}

impl PollResult {
    pub fn state(self) -> PollState {
        match self {
            Self::WorkCompleted => PollState::Active,
            Self::SuccessfulIdle => PollState::Idle,
            Self::Disconnected => PollState::Disconnected,
            Self::Unauthenticated => PollState::Unauthenticated,
            Self::FailedConfiguration => PollState::FailedConfiguration,
            Self::FailedMigration => PollState::FailedMigration,
            Self::FailedRequest => PollState::FailedRequest,
        }
    }

    fn is_failure(self) -> bool {
        matches!(
            self,
            Self::Disconnected
                | Self::Unauthenticated
                | Self::FailedConfiguration
                | Self::FailedMigration
                | Self::FailedRequest
        )
    }
}

/// Backoff for the Bridge's one worker. It keeps active local work responsive,
/// while all no-work and failure paths remain bounded and jittered.
#[derive(Debug, Clone)]
pub struct PollScheduler {
    idle_cycles: u32,
    failure_cycles: u32,
    process_seed: u64,
    jitter_seed: u64,
    state: PollState,
}

impl PollScheduler {
    pub fn new(process_seed: u64) -> Self {
        Self {
            idle_cycles: 0,
            failure_cycles: 0,
            process_seed,
            jitter_seed: process_seed,
            state: PollState::Idle,
        }
    }

    /// Reseed jitter when the persisted device identity becomes known or
    /// changes. A process seed and device identity together prevent two
    /// Bridges from synchronizing their discovery calls.
    pub fn set_device_id(&mut self, device_id: Option<&str>) {
        self.jitter_seed = device_seed(self.process_seed, device_id);
    }

    pub fn record(&mut self, result: PollResult) {
        self.state = result.state();
        if result == PollResult::WorkCompleted {
            self.idle_cycles = 0;
            self.failure_cycles = 0;
        } else if result == PollResult::SuccessfulIdle {
            self.idle_cycles = self.idle_cycles.saturating_add(1).min(8);
            // A successful request clears request-failure backoff, but does
            // not pretend that an empty discovery produced work.
            self.failure_cycles = 0;
        } else if result.is_failure() {
            self.failure_cycles = self.failure_cycles.saturating_add(1).min(8);
            self.idle_cycles = self.idle_cycles.saturating_add(1).min(8);
        }
    }

    #[cfg(test)]
    pub fn state(&self) -> PollState {
        self.state
    }

    #[cfg(test)]
    pub fn idle_cycles(&self) -> u32 {
        self.idle_cycles
    }

    #[cfg(test)]
    pub fn failure_cycles(&self) -> u32 {
        self.failure_cycles
    }

    /// The wait while the work signal is live; `busy` is what it last said.
    pub fn next_delay_signalled(&self, busy: bool) -> Duration {
        if self.state != PollState::Idle {
            return self.next_delay();
        }
        if busy { SIGNALLED_BUSY_DELAY } else { SIGNALLED_IDLE_DELAY }
    }

    pub fn next_delay(&self) -> Duration {
        if self.state == PollState::Active {
            return ACTIVE_POLL_INTERVAL;
        }
        let (base, cycle) = if self.state == PollState::Idle {
            (IDLE_BASE, self.idle_cycles)
        } else {
            (FAILURE_BASE, self.failure_cycles)
        };
        let exponential = base
            .saturating_mul(1_u32 << cycle.saturating_sub(1).min(6))
            .min(MAX_BASE_DELAY);
        let jitter = jitter_for(
            self.jitter_seed,
            self.idle_cycles,
            self.failure_cycles,
            exponential,
        );
        exponential
            .saturating_add(jitter)
            .min(REMOTE_DISCOVERY_BOUND)
    }
}

fn device_seed(process_seed: u64, device_id: Option<&str>) -> u64 {
    let mut value = process_seed ^ 0x9e37_79b9_7f4a_7c15;
    if let Some(device_id) = device_id {
        for byte in device_id.as_bytes() {
            value ^= u64::from(*byte);
            value = value.wrapping_mul(0x1000_0000_01b3);
            value ^= value >> 29;
        }
    }
    split_mix(value)
}

fn jitter_for(seed: u64, idle_cycles: u32, failure_cycles: u32, base: Duration) -> Duration {
    let maximum = base.div_f32(5.0).min(MAX_JITTER);
    if maximum.is_zero() {
        return Duration::ZERO;
    }
    let mixed = split_mix(seed ^ (u64::from(idle_cycles) << 32) ^ u64::from(failure_cycles));
    Duration::from_millis(mixed % (maximum.as_millis() as u64 + 1))
}

fn split_mix(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WaitResult {
    TimedOut,
    Woken,
    Shutdown,
}

struct WakeInner {
    notify: tokio::sync::Notify,
    configuration_changed: AtomicBool,
    shutdown: AtomicBool,
}

/// Coalescing local wake and shutdown signal. `notify_one` deliberately keeps
/// at most one permit: several file/config events do not create duplicate
/// polling work, and a permit raised while the worker is busy is consumed by
/// its next wait.
#[derive(Clone)]
pub struct PollWake {
    inner: Arc<WakeInner>,
}

impl PollWake {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(WakeInner {
                notify: tokio::sync::Notify::new(),
                configuration_changed: AtomicBool::new(false),
                shutdown: AtomicBool::new(false),
            }),
        }
    }

    pub fn wake(&self) {
        if !self.is_shutdown() {
            self.inner.notify.notify_one();
        }
    }

    pub fn wake_configuration(&self) {
        if !self.is_shutdown() {
            self.inner
                .configuration_changed
                .store(true, Ordering::Release);
            self.inner.notify.notify_one();
        }
    }

    pub fn take_configuration_changed(&self) -> bool {
        self.inner
            .configuration_changed
            .swap(false, Ordering::AcqRel)
    }

    pub fn shutdown(&self) {
        self.inner.shutdown.store(true, Ordering::Release);
        self.inner.notify.notify_waiters();
    }

    pub fn is_shutdown(&self) -> bool {
        self.inner.shutdown.load(Ordering::Acquire)
    }

    pub async fn wait(&self, delay: Duration) -> WaitResult {
        // Register before checking shutdown. Otherwise a shutdown between the
        // check and `notified()` could leave this worker asleep until the
        // discovery bound expires.
        let notified = self.inner.notify.notified();
        tokio::pin!(notified);
        if self.is_shutdown() {
            return WaitResult::Shutdown;
        }
        tokio::select! {
            _ = &mut notified => {
                if self.is_shutdown() { WaitResult::Shutdown } else { WaitResult::Woken }
            }
            _ = tokio::time::sleep(delay) => {
                if self.is_shutdown() { WaitResult::Shutdown } else { WaitResult::TimedOut }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    #[derive(Debug, Default)]
    struct VirtualClock {
        now: Duration,
    }

    #[derive(Debug, Default)]
    struct FakeTransport {
        outcomes: VecDeque<PollResult>,
        request_times: Vec<Duration>,
    }

    impl FakeTransport {
        fn new(outcomes: impl IntoIterator<Item = PollResult>) -> Self {
            Self {
                outcomes: outcomes.into_iter().collect(),
                request_times: Vec::new(),
            }
        }

        fn request(&mut self, now: Duration) -> PollResult {
            self.request_times.push(now);
            self.outcomes
                .pop_front()
                .unwrap_or(PollResult::SuccessfulIdle)
        }
    }

    fn simulate_window(
        scheduler: &mut PollScheduler,
        transport: &mut FakeTransport,
        clock: &mut VirtualClock,
        window: Duration,
        local_wakes: &[Duration],
    ) {
        let mut wake_index = 0;
        while clock.now <= window {
            let result = transport.request(clock.now);
            scheduler.record(result);
            let due = clock.now + scheduler.next_delay();
            let next_wake = local_wakes
                .get(wake_index)
                .copied()
                .filter(|wake| *wake <= window);
            if let Some(wake) = next_wake {
                if wake <= due {
                    clock.now = wake;
                    while local_wakes.get(wake_index).copied() == Some(wake) {
                        wake_index += 1;
                    }
                    continue;
                }
            }
            if due > window {
                break;
            }
            clock.now = due;
        }
    }

    #[test]
    fn idle_transport_request_count_is_bounded_and_jitter_is_independent() {
        let outcomes = std::iter::repeat(PollResult::SuccessfulIdle).take(32);
        let mut transport = FakeTransport::new(outcomes);
        let mut clock = VirtualClock::default();
        let mut scheduler = PollScheduler::new(7);
        scheduler.set_device_id(Some("device-a"));
        simulate_window(
            &mut scheduler,
            &mut transport,
            &mut clock,
            Duration::from_secs(60),
            &[],
        );

        let mut other = PollScheduler::new(8);
        other.set_device_id(Some("device-a"));
        let mut same_state = PollScheduler::new(7);
        same_state.set_device_id(Some("device-a"));
        same_state.record(PollResult::SuccessfulIdle);
        other.record(PollResult::SuccessfulIdle);
        assert!(
            transport.request_times.len() <= 10,
            "idle requests: {:?}",
            transport.request_times
        );
        let maximum_gap = transport
            .request_times
            .windows(2)
            .map(|window| window[1] - window[0])
            .max()
            .unwrap_or_default();
        assert!(maximum_gap <= REMOTE_DISCOVERY_BOUND);
        assert!(same_state.next_delay() != other.next_delay());
        assert!(scheduler.next_delay() <= MAX_POLL_DELAY);
        println!(
            "controlled idle transport requests in 60s: {}; maximum gap: {:?}; remote bound: {:?}",
            transport.request_times.len(),
            maximum_gap,
            REMOTE_DISCOVERY_BOUND
        );
    }

    #[test]
    fn active_work_keeps_the_short_poll_interval() {
        let mut scheduler = PollScheduler::new(11);
        scheduler.record(PollResult::WorkCompleted);
        assert_eq!(scheduler.state(), PollState::Active);
        assert_eq!(scheduler.next_delay(), ACTIVE_POLL_INTERVAL);
    }

    #[test]
    fn remote_discovery_has_an_exact_fifteen_second_bound() {
        let mut scheduler = PollScheduler::new(12);
        for _ in 0..12 {
            scheduler.record(PollResult::SuccessfulIdle);
            assert!(scheduler.next_delay() <= REMOTE_DISCOVERY_BOUND);
        }
        assert_eq!(REMOTE_DISCOVERY_BOUND, Duration::from_secs(15));
    }

    #[test]
    fn simultaneous_local_wakes_coalesce_and_bound_queued_work_latency() {
        let mut transport =
            FakeTransport::new([PollResult::SuccessfulIdle, PollResult::WorkCompleted]);
        let mut clock = VirtualClock::default();
        let mut scheduler = PollScheduler::new(13);
        simulate_window(
            &mut scheduler,
            &mut transport,
            &mut clock,
            Duration::from_secs(1),
            &[Duration::from_millis(100), Duration::from_millis(100)],
        );
        assert_eq!(
            &transport.request_times[..2],
            &[Duration::ZERO, Duration::from_millis(100)]
        );
        assert_eq!(transport.request_times.len(), 4);
        println!(
            "queued local work latency with coalesced wakes: {:?}; requests: {}",
            transport.request_times[1] - Duration::from_millis(100),
            transport.request_times.len()
        );
    }

    #[test]
    fn credential_change_does_not_spin_at_250ms() {
        let mut scheduler = PollScheduler::new(14);
        scheduler.record(PollResult::Unauthenticated);
        assert_eq!(scheduler.state(), PollState::Unauthenticated);
        assert!(scheduler.next_delay() >= FAILURE_BASE);
    }

    #[test]
    fn request_failure_uses_bounded_exponential_backoff() {
        let mut scheduler = PollScheduler::new(15);
        scheduler.record(PollResult::FailedRequest);
        let first = scheduler.next_delay();
        scheduler.record(PollResult::FailedRequest);
        let second = scheduler.next_delay();
        assert!(first >= FAILURE_BASE);
        assert!(second >= first);
        assert!(second <= MAX_POLL_DELAY);
    }

    #[test]
    fn configuration_failure_is_not_a_hot_loop() {
        let mut scheduler = PollScheduler::new(16);
        scheduler.record(PollResult::FailedConfiguration);
        assert_eq!(scheduler.state(), PollState::FailedConfiguration);
        assert!(scheduler.next_delay() >= FAILURE_BASE);
    }

    #[test]
    fn migration_failure_is_not_a_hot_loop() {
        let mut scheduler = PollScheduler::new(17);
        scheduler.record(PollResult::FailedMigration);
        assert_eq!(scheduler.state(), PollState::FailedMigration);
        assert!(scheduler.next_delay() >= FAILURE_BASE);
    }

    #[test]
    fn successful_retry_resets_failure_and_returns_to_active_polling() {
        let mut scheduler = PollScheduler::new(18);
        scheduler.record(PollResult::FailedRequest);
        assert!(scheduler.failure_cycles() > 0);
        scheduler.record(PollResult::WorkCompleted);
        assert_eq!(scheduler.failure_cycles(), 0);
        assert_eq!(scheduler.idle_cycles(), 0);
        assert_eq!(scheduler.next_delay(), ACTIVE_POLL_INTERVAL);
    }

    #[tokio::test]
    async fn shutdown_interrupts_a_long_wait() {
        let wake = PollWake::new();
        let waiter = {
            let wake = wake.clone();
            tokio::spawn(async move { wake.wait(Duration::from_secs(15)).await })
        };
        tokio::task::yield_now().await;
        wake.shutdown();
        assert_eq!(waiter.await.unwrap(), WaitResult::Shutdown);
    }

    #[tokio::test]
    async fn wake_preempts_sleep_and_multiple_signals_remain_one_permit() {
        let wake = PollWake::new();
        let waiter = {
            let wake = wake.clone();
            tokio::spawn(async move { wake.wait(Duration::from_secs(15)).await })
        };
        tokio::task::yield_now().await;
        wake.wake();
        wake.wake();
        assert_eq!(waiter.await.unwrap(), WaitResult::Woken);
        assert_eq!(wake.wait(Duration::ZERO).await, WaitResult::Woken);
    }
}
