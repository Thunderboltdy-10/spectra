use std::collections::BTreeMap;
use std::path::Path;

use spectra_bridge_core::fs::sha256_file;
use spectra_bridge_core::platform::HostPlatform;
use spectra_bridge_core::watcher::scan_page;
use walkdir::WalkDir;

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
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    std::fs::create_dir(root.join("Lesson notes")).unwrap();
    std::fs::write(root.join("readme.txt"), b"Keep the original bytes").unwrap();
    std::fs::write(root.join("Lesson notes").join("equation.txt"), "x² + y² = r²").unwrap();
    std::fs::write(root.join("Lesson notes").join("data.csv"), b"day,value\n1,42\n").unwrap();
    let before = manifest(&root);
    let page = scan_page(&HostPlatform, &root, None, 100).unwrap();
    let after = manifest(&root);
    assert_eq!(page.entries.len(), 4); // one folder plus three files
    assert_eq!(before, after);
}
