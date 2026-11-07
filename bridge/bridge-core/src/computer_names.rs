//! The names of files and folders in the ordinary places on this computer.
//!
//! Spectra AI can ask what is here so it can offer to bring something in. It
//! gets names and whether each is a file or a folder, one level at a time, and
//! only inside Documents, Desktop, Downloads and OneDrive. Nothing here opens a
//! file, follows a link out of those places, or changes anything.

use anyhow::{anyhow, bail};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

const MAX_ENTRIES: usize = 300;
const MAX_SCANNED: usize = 5_000;
const PLACES: [&str; 3] = ["Documents", "Desktop", "Downloads"];
const NEVER_LISTED: [&str; 8] = [
    "node_modules",
    "appdata",
    "$recycle.bin",
    "system volume information",
    "desktop.ini",
    "thumbs.db",
    "__pycache__",
    "ntuser.dat",
];

fn home() -> anyhow::Result<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| anyhow!("This computer's home folder can't be found."))
}

fn quiet_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    name.starts_with('.') || name.starts_with("~$") || NEVER_LISTED.contains(&lower.as_str())
}

#[cfg(windows)]
fn hidden_by_system(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN_OR_SYSTEM: u32 = 0x2 | 0x4;
    metadata.file_attributes() & HIDDEN_OR_SYSTEM != 0
}

#[cfg(not(windows))]
fn hidden_by_system(_: &std::fs::Metadata) -> bool {
    false
}

fn places(home: &Path) -> Vec<String> {
    let mut found: Vec<String> = PLACES
        .iter()
        .filter(|place| home.join(place).is_dir())
        .map(|place| (*place).to_string())
        .collect();
    if let Ok(entries) = std::fs::read_dir(home) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_cloud_folder = name == "OneDrive" || name.starts_with("OneDrive - ");
            if is_cloud_folder && entry.path().is_dir() {
                found.push(name);
            }
        }
    }
    found
}

fn segments(relative: &str) -> anyhow::Result<Vec<&str>> {
    if relative.starts_with('/') || relative.starts_with('\\') {
        bail!("That path isn't one Spectra can look at.");
    }
    relative
        .split(['/', '\\'])
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            if segment == "." || segment == ".." || segment.contains(':') {
                bail!("That path isn't one Spectra can look at.");
            }
            Ok(segment)
        })
        .collect()
}

/// A path someone named, checked step by step: it stays inside one of the
/// places, and no step is hidden or a link that leads somewhere else.
fn resolve_in(home: &Path, relative: &str) -> anyhow::Result<PathBuf> {
    let parts = segments(relative)?;
    let Some(place) = parts.first() else {
        bail!("Name a file or folder.");
    };
    if !places(home).iter().any(|known| known == place) {
        bail!("Spectra only looks in Documents, Desktop, Downloads and OneDrive.");
    }
    let root = home.join(place);
    let mut path = root.clone();
    for part in &parts[1..] {
        path.push(part);
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|_| anyhow!("{relative} isn't on this computer."))?;
        if quiet_name(part) || hidden_by_system(&metadata) || metadata.file_type().is_symlink() {
            bail!("That path isn't one Spectra can look at.");
        }
    }
    let inside = path
        .canonicalize()
        .map_err(|_| anyhow!("{relative} isn't on this computer."))?;
    let root = root.canonicalize()?;
    if !inside.starts_with(&root) {
        bail!("That path isn't one Spectra can look at.");
    }
    Ok(inside)
}

fn list_in(home: &Path, relative: &str) -> anyhow::Result<Value> {
    let parts = segments(relative)?;
    if parts.is_empty() {
        let entries: Vec<Value> = places(home)
            .into_iter()
            .map(|name| json!({ "name": name, "kind": "folder" }))
            .collect();
        return Ok(json!({ "path": "", "entries": entries, "truncated": false }));
    }
    let folder = resolve_in(home, relative)?;
    if !folder.is_dir() {
        bail!("{relative} is a file, not a folder.");
    }
    let mut named: Vec<(bool, String)> = Vec::new();
    let mut truncated = false;
    for (index, entry) in std::fs::read_dir(&folder)?.enumerate() {
        if index >= MAX_SCANNED {
            truncated = true;
            break;
        }
        let Ok(entry) = entry else { continue };
        // DirEntry metadata does not follow links, so a link is seen as a link.
        let Ok(metadata) = entry.metadata() else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if metadata.file_type().is_symlink() || quiet_name(&name) || hidden_by_system(&metadata) {
            continue;
        }
        named.push((metadata.is_dir(), name));
    }
    named.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase()))
    });
    if named.len() > MAX_ENTRIES {
        truncated = true;
        named.truncate(MAX_ENTRIES);
    }
    let entries: Vec<Value> = named
        .into_iter()
        .map(|(is_folder, name)| {
            json!({ "name": name, "kind": if is_folder { "folder" } else { "file" } })
        })
        .collect();
    Ok(json!({ "path": parts.join("/"), "entries": entries, "truncated": truncated }))
}

/// Names one level down from `relative`; the places themselves when it is empty.
pub fn list(relative: &str) -> anyhow::Result<Value> {
    list_in(&home()?, relative)
}

/// The real path of something named from `list`, once it is known to be allowed.
pub fn resolve(relative: &str) -> anyhow::Result<PathBuf> {
    resolve_in(&home()?, relative)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn computer() -> tempfile::TempDir {
        let home = tempfile::tempdir().unwrap();
        let documents = home.path().join("Documents");
        fs::create_dir_all(documents.join("IB").join("Physics")).unwrap();
        fs::create_dir_all(documents.join("node_modules")).unwrap();
        fs::create_dir_all(documents.join(".secret")).unwrap();
        fs::write(documents.join("IB").join("Lab report.docx"), "private words").unwrap();
        fs::write(documents.join("~$Lab report.docx"), "lock").unwrap();
        fs::write(documents.join("IB").join(".env"), "KEY=1").unwrap();
        fs::create_dir_all(home.path().join("Desktop")).unwrap();
        fs::create_dir_all(home.path().join("AppData").join("Local")).unwrap();
        fs::write(home.path().join("passwords.txt"), "x").unwrap();
        home
    }

    fn names(listing: &Value) -> Vec<String> {
        listing["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["name"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn it_starts_from_the_ordinary_places_and_nothing_else() {
        let home = computer();
        let listing = list_in(home.path(), "").unwrap();
        assert_eq!(names(&listing), vec!["Documents", "Desktop"]);
    }

    #[test]
    fn it_gives_names_and_kinds_without_what_should_stay_out_of_sight() {
        let home = computer();
        let listing = list_in(home.path(), "Documents/IB").unwrap();
        assert_eq!(names(&listing), vec!["Physics", "Lab report.docx"]);
        assert_eq!(listing["entries"][0]["kind"], "folder");
        assert_eq!(listing["entries"][1]["kind"], "file");
        assert!(!listing.to_string().contains("private words"));
        let top = list_in(home.path(), "Documents").unwrap();
        assert_eq!(names(&top), vec!["IB"]);
    }

    #[test]
    fn it_refuses_every_way_out_of_the_places() {
        let home = computer();
        for path in [
            "..",
            "Documents/..",
            "Documents/../AppData",
            "AppData",
            "AppData/Local",
            "passwords.txt",
            "C:/Windows",
            "C:\\Windows",
            "/etc",
            "Documents/.secret",
            "Documents/node_modules",
            "Documents/IB/.env",
        ] {
            assert!(list_in(home.path(), path).is_err(), "{path} should be refused");
            assert!(resolve_in(home.path(), path).is_err(), "{path} should be refused");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_link_out_of_a_place_is_neither_listed_nor_followed() {
        let home = computer();
        std::os::unix::fs::symlink(
            home.path().join("AppData"),
            home.path().join("Documents/way-out"),
        )
        .unwrap();
        assert_eq!(names(&list_in(home.path(), "Documents").unwrap()), vec!["IB"]);
        assert!(resolve_in(home.path(), "Documents/way-out").is_err());
    }

    #[test]
    fn a_named_file_resolves_to_its_real_path() {
        let home = computer();
        let path = resolve_in(home.path(), "Documents\\IB\\Lab report.docx").unwrap();
        assert!(path.is_file());
        assert!(resolve_in(home.path(), "Documents/IB/missing.docx").is_err());
    }
}
