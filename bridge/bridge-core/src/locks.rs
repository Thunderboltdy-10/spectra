use std::sync::{Mutex, RwLock};

/// A panic while a lock is held poisons it. The state behind these locks is
/// always left whole between statements, so a later request recovers the
/// guard instead of failing every request after one panic.
pub(crate) trait Recover<T: ?Sized> {
    fn reading(&self) -> std::sync::RwLockReadGuard<'_, T>;
    fn writing(&self) -> std::sync::RwLockWriteGuard<'_, T>;
}
impl<T: ?Sized> Recover<T> for RwLock<T> {
    fn reading(&self) -> std::sync::RwLockReadGuard<'_, T> { self.read().unwrap_or_else(|poisoned| poisoned.into_inner()) }
    fn writing(&self) -> std::sync::RwLockWriteGuard<'_, T> { self.write().unwrap_or_else(|poisoned| poisoned.into_inner()) }
}
pub(crate) trait Locked<T: ?Sized> {
    fn locked(&self) -> std::sync::MutexGuard<'_, T>;
}
impl<T: ?Sized> Locked<T> for Mutex<T> {
    fn locked(&self) -> std::sync::MutexGuard<'_, T> { self.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) }
}
