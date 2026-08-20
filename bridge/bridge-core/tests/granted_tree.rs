use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use spectra_bridge_core::fs::sha256_file;
use spectra_bridge_core::platform::HostPlatform;
use spectra_bridge_core::watcher::scan_page;
use walkdir::WalkDir;

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(".tmp-n3-mount")
        .canonicalize()
        .unwrap()
}

fn manifest(root: &Path) -> BTreeMap<String, String> {
    WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| {
            (
                entry
                    .path()
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/"),
                sha256_file(entry.path()).unwrap(),
            )
        })
        .collect()
}

#[test]
fn granting_and_scanning_the_acceptance_tree_changes_zero_bytes() {
    let root = fixture_root();
    let before = manifest(&root);
    let page = scan_page(&HostPlatform, &root, None, 100).unwrap();
    let after = manifest(&root);
    assert_eq!(page.entries.len(), 4); // one folder plus three files
    assert_eq!(before, after);
}
