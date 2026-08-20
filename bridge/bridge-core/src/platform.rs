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
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle, MOVEFILE_REPLACE_EXISTING,
        MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

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
            match File::options().read(true).write(true).open(path) {
                Ok(_) => Ok(false),
                Err(error) if error.kind() == io::ErrorKind::PermissionDenied => Ok(true),
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

#[cfg(not(windows))]
mod host {
    use super::*;

    #[async_trait]
    impl Platform for HostPlatform {
        fn file_identity(&self, file: &File) -> io::Result<OsFileIdentity> {
            let meta = file.metadata()?;
            Ok(OsFileIdentity {
                volume: 0,
                file_index: meta.len() as u128,
            })
        }
        fn is_locked(&self, _path: &Path) -> io::Result<bool> {
            Ok(false)
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
