use std::future::Future;
use tokio::sync::watch;

/// Network work belongs to the pairing that started it. Retiring a pairing
/// cancels its pending futures instead of letting them resume under a new key.
pub struct PairingWork {
    state: watch::Sender<(u64, bool)>,
}

impl Default for PairingWork {
    fn default() -> Self {
        Self {
            state: watch::channel((0, true)).0,
        }
    }
}

impl PairingWork {
    pub fn retire(&self) {
        self.state.send_modify(|state| {
            state.0 = state.0.wrapping_add(1);
            state.1 = false;
        });
    }

    pub fn resume(&self) {
        self.state.send_modify(|state| state.1 = true);
    }

    pub fn lease(&self) -> Option<PairingLease> {
        let state = self.state.subscribe();
        let (generation, active) = *state.borrow();
        active.then_some(PairingLease { state, generation })
    }
}

pub struct PairingLease {
    state: watch::Receiver<(u64, bool)>,
    generation: u64,
}

impl PairingLease {
    pub async fn run<F: Future>(mut self, work: F) -> Option<F::Output> {
        let current = *self.state.borrow_and_update();
        if current != (self.generation, true) {
            return None;
        }
        tokio::pin!(work);
        loop {
            tokio::select! {
                biased;
                changed = self.state.changed() => {
                    if changed.is_err() || *self.state.borrow_and_update() != (self.generation, true) {
                        return None;
                    }
                }
                result = &mut work => return Some(result),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };

    #[tokio::test]
    async fn a_late_response_cannot_finish_after_disconnect_and_repairing() {
        let pairing = PairingWork::default();
        let lease = pairing.lease().unwrap();
        let (response, pending) = tokio::sync::oneshot::channel();
        let finished = Arc::new(AtomicBool::new(false));
        let callback = finished.clone();
        let task = tokio::spawn(lease.run(async move {
            pending.await.unwrap();
            callback.store(true, Ordering::SeqCst);
        }));
        tokio::task::yield_now().await;
        pairing.retire();
        assert!(pairing.lease().is_none());
        pairing.resume();
        let _ = response.send(());
        assert!(task.await.unwrap().is_none());
        assert!(!finished.load(Ordering::SeqCst));
        assert_eq!(pairing.lease().unwrap().run(async { 42 }).await, Some(42));
    }

    #[tokio::test]
    async fn a_watcher_queued_before_disconnect_never_starts_on_the_new_pairing() {
        let pairing = PairingWork::default();
        let queued = pairing.lease().unwrap();
        pairing.retire();
        pairing.resume();
        assert!(
            queued
                .run(async { panic!("old watcher ran") })
                .await
                .is_none()
        );
    }

    #[tokio::test]
    async fn resuming_the_same_pairing_preserves_pending_work() {
        let pairing = PairingWork::default();
        let lease = pairing.lease().unwrap();
        pairing.resume();
        assert_eq!(lease.run(async { 42 }).await, Some(42));
    }
}
