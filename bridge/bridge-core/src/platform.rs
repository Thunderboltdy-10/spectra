use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};

use async_trait::async_trait;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OsFileIdentity {
    pub volume: u64,
    pub file_index: u128,
}

#[async_trait]
pub trait Platform: Send + Sync {
    fn file_identity(&self, file: &File) -> io::Result<OsFileIdentity>;
    fn is_locked(&self, path: &Path) -> io::Result<bool>;
    /// Whether an Office `~$` owner file belongs to a running Office session.
    /// Platforms without share-mode semantics cannot tell a live owner file
    /// from one left behind by a crash, so they conservatively treat it as live.
    fn owner_file_is_live(&self, owner_file: &Path) -> bool {
        let _ = owner_file;
        true
    }
    /// Opens a reader that proves no writer owns the file for the lifetime of
    /// the returned handle. Platforms with mandatory share semantics override
    /// this; platforms that cannot offer a writer-completion proof fail closed
    /// with `None` so callers conservatively retry instead of promoting bytes.
    fn open_stable_reader(&self, path: &Path) -> io::Result<Option<File>> {
        let _ = path;
        Ok(None)
    }
    /// Whether a file's bytes live only with a cloud provider (OneDrive Files
    /// On-Demand, Dropbox/Google Drive online-only). Reading such a file
    /// downloads it, so the Bridge leaves it alone until the student makes it
    /// available on this device.
    fn is_online_only(&self, path: &Path, metadata: &std::fs::Metadata) -> bool {
        let _ = (path, metadata);
        false
    }
    fn recycle(&self, path: &Path) -> anyhow::Result<()>;
    fn store_credential(&self, account_id: &str, credential: &str) -> anyhow::Result<()>;
    fn read_credential(&self, account_id: &str) -> anyhow::Result<Option<String>>;
    fn enable_autostart(&self) -> anyhow::Result<()>;
    fn before_write(&self, _target: &Path) -> io::Result<()> {
        Ok(())
    }
    fn readback_ready(&self, _target: &Path) -> io::Result<()> {
        Ok(())
    }
    fn atomic_replace(&self, source: &Path, target: &Path) -> io::Result<()> {
        std::fs::rename(source, target)
    }
    fn canonicalize(&self, path: &Path) -> io::Result<PathBuf> {
        path.canonicalize()
    }
}

#[derive(Debug, Default)]
pub struct HostPlatform;

#[cfg(windows)]
mod host {
    use super::*;
    use std::mem::zeroed;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, FILE_SHARE_READ, GetFileInformationByHandle,
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    const ERROR_SHARING_VIOLATION_CODE: i32 = 32;
    const ERROR_LOCK_VIOLATION_CODE: i32 = 33;

    #[async_trait]
    impl Platform for HostPlatform {
        fn file_identity(&self, file: &File) -> io::Result<OsFileIdentity> {
            let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { zeroed() };
            let succeeded =
                unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) };
            if succeeded == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(OsFileIdentity {
                volume: info.dwVolumeSerialNumber as u64,
                file_index: ((info.nFileIndexHigh as u128) << 32) | info.nFileIndexLow as u128,
            })
        }

        fn is_locked(&self, path: &Path) -> io::Result<bool> {
            Ok(self.open_stable_reader(path)?.is_none())
        }

        fn is_online_only(&self, _path: &Path, metadata: &std::fs::Metadata) -> bool {
            use std::os::windows::fs::MetadataExt;
            attributes_are_online_only(metadata.file_attributes())
        }

        fn owner_file_is_live(&self, owner_file: &Path) -> bool {
            // Office keeps its owner file open for writing while the document
            // is open. One left behind by a crash has no writer, and must not
            // keep the document out of sync until the student reopens it.
            match self.is_locked(owner_file) {
                Ok(held) => held,
                Err(error) => error.kind() != io::ErrorKind::NotFound,
            }
        }

        fn open_stable_reader(&self, path: &Path) -> io::Result<Option<File>> {
            let mut options = File::options();
            // Rust's normal Windows File open shares writes and deletes. A
            // FILE_SHARE_READ-only handle is different: it cannot coexist
            // with an existing writer, and no writer can open until this
            // reader (and its hash pass) is dropped.
            options.read(true).share_mode(FILE_SHARE_READ);
            match options.open(path) {
                Ok(file) => Ok(Some(file)),
                Err(error)
                    if matches!(
                        error.raw_os_error(),
                        Some(ERROR_SHARING_VIOLATION_CODE | ERROR_LOCK_VIOLATION_CODE)
                    ) =>
                {
                    Ok(None)
                }
                Err(error) => Err(error),
            }
        }

        fn recycle(&self, path: &Path) -> anyhow::Result<()> {
            trash::delete(path)?;
            Ok(())
        }

        fn store_credential(&self, account_id: &str, credential: &str) -> anyhow::Result<()> {
            keyring::Entry::new("Spectra Bridge", account_id)?.set_password(credential)?;
            Ok(())
        }

        fn read_credential(&self, account_id: &str) -> anyhow::Result<Option<String>> {
            let entry = keyring::Entry::new("Spectra Bridge", account_id)?;
            match entry.get_password() {
                Ok(value) => Ok(Some(value)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(error.into()),
            }
        }

        fn enable_autostart(&self) -> anyhow::Result<()> {
            // The Tauri shell owns registration. Keeping this method in the
            // platform boundary prevents core code from depending on Tauri.
            Ok(())
        }
        fn atomic_replace(&self, source: &Path, target: &Path) -> io::Result<()> {
            let source = source
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>();
            let target = target
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>();
            let succeeded = unsafe {
                MoveFileExW(
                    source.as_ptr(),
                    target.as_ptr(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            };
            if succeeded == 0 {
                Err(io::Error::last_os_error())
            } else {
                Ok(())
            }
        }
    }
}

/// Cloud Files placeholders whose data is not on disk carry one of these
/// attributes; reading their bytes recalls them from the provider.
#[cfg(windows)]
fn attributes_are_online_only(attributes: u32) -> bool {
    const FILE_ATTRIBUTE_OFFLINE: u32 = 0x0000_1000;
    const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x0004_0000;
    const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;
    attributes
        & (FILE_ATTRIBUTE_OFFLINE
            | FILE_ATTRIBUTE_RECALL_ON_OPEN
            | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)
        != 0
}

#[cfg(unix)]
mod host {
    use super::*;
    use std::os::unix::fs::MetadataExt;

    #[async_trait]
    impl Platform for HostPlatform {
        fn file_identity(&self, file: &File) -> io::Result<OsFileIdentity> {
            let meta = file.metadata()?;
            Ok(OsFileIdentity {
                // A file length is not an identity: same-sized files are
                // common in a school folder and would otherwise share one
                // logical resource on macOS/Linux. Unix exposes the stable
                // device/inode pair needed to survive renames and provider
                // temp-file replacement.
                volume: meta.dev(),
                file_index: meta.ino() as u128,
            })
        }
        fn is_locked(&self, _path: &Path) -> io::Result<bool> {
            Ok(false)
        }
        fn open_stable_reader(&self, path: &Path) -> io::Result<Option<File>> {
            // Linux lacks Windows share-mode proof; open read-only for local QA/sync.
            match File::options().read(true).open(path) {
                Ok(file) => Ok(Some(file)),
                Err(error) => Err(error),
            }
        }
        fn recycle(&self, path: &Path) -> anyhow::Result<()> {
            trash::delete(path)?;
            Ok(())
        }
        fn store_credential(&self, account_id: &str, credential: &str) -> anyhow::Result<()> {
            keyring::Entry::new("Spectra Bridge", account_id)?.set_password(credential)?;
            Ok(())
        }
        fn read_credential(&self, account_id: &str) -> anyhow::Result<Option<String>> {
            let entry = keyring::Entry::new("Spectra Bridge", account_id)?;
            match entry.get_password() {
                Ok(v) => Ok(Some(v)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(e) => Err(e.into()),
            }
        }
        fn enable_autostart(&self) -> anyhow::Result<()> {
            Ok(())
        }
    }
}

#[cfg(not(any(windows, unix)))]
mod host {
    use super::*;

    #[async_trait]
    impl Platform for HostPlatform {
        fn file_identity(&self, file: &File) -> io::Result<OsFileIdentity> {
            let meta = file.metadata()?;
            Ok(OsFileIdentity {
                // Unsupported platforms do not have a stable identity
                // implementation yet. Keep this fallback isolated rather
                // than making macOS use a size-based identity.
                volume: 0,
                file_index: meta.len() as u128,
            })
        }
        fn is_locked(&self, _path: &Path) -> io::Result<bool> {
            Ok(false)
        }
        fn open_stable_reader(&self, path: &Path) -> io::Result<Option<File>> {
            match File::options().read(true).open(path) {
                Ok(file) => Ok(Some(file)),
                Err(error) => Err(error),
            }
        }
        fn recycle(&self, path: &Path) -> anyhow::Result<()> {
            trash::delete(path)?;
            Ok(())
        }
        fn store_credential(&self, account_id: &str, credential: &str) -> anyhow::Result<()> {
            keyring::Entry::new("Spectra Bridge", account_id)?.set_password(credential)?;
            Ok(())
        }
        fn read_credential(&self, account_id: &str) -> anyhow::Result<Option<String>> {
            let entry = keyring::Entry::new("Spectra Bridge", account_id)?;
            match entry.get_password() {
                Ok(v) => Ok(Some(v)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(e) => Err(e.into()),
            }
        }
        fn enable_autostart(&self) -> anyhow::Result<()> {
            Ok(())
        }
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::attributes_are_online_only;

    #[test]
    fn only_cloud_placeholders_without_local_data_are_online_only() {
        // FILE_ATTRIBUTE_ARCHIVE | FILE_ATTRIBUTE_PINNED: hydrated and kept.
        assert!(!attributes_are_online_only(0x20 | 0x0008_0000));
        // OneDrive "online-only" and "free up space" placeholders.
        assert!(attributes_are_online_only(0x20 | 0x0040_0000));
        assert!(attributes_are_online_only(0x20 | 0x0010_0000 | 0x0040_0000));
        assert!(attributes_are_online_only(0x1000));
        assert!(attributes_are_online_only(0x0004_0000));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::{HostPlatform, Platform};
    use std::fs::File;
    use tempfile::tempdir;

    #[test]
    fn same_size_unix_files_have_distinct_resource_identity() {
        let dir = tempdir().unwrap();
        let first = dir.path().join("first.txt");
        let second = dir.path().join("second.txt");
        std::fs::write(&first, b"same-size").unwrap();
        std::fs::write(&second, b"same-size").unwrap();
        let first_id = HostPlatform
            .file_identity(&File::open(first).unwrap())
            .unwrap();
        let second_id = HostPlatform
            .file_identity(&File::open(second).unwrap())
            .unwrap();
        assert_ne!(first_id, second_id);
    }
}
