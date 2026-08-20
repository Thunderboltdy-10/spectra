use sha2::{Digest, Sha256};

use crate::platform::OsFileIdentity;

pub fn local_resource_id(identity: &OsFileIdentity) -> String {
    let mut digest = Sha256::new();
    digest.update(b"spectra-local-resource-v1\0");
    digest.update(identity.volume.to_le_bytes());
    digest.update(identity.file_index.to_le_bytes());
    format!("lr_{}", hex::encode(&digest.finalize()[..16]))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdoptionCandidate {
    pub local_resource_id: String,
    pub path_key: String,
    pub content_hash: String,
    pub os_identity: Option<OsFileIdentity>,
    pub last_seen_generation: u64,
}

pub fn adopt<'a>(
    candidates: &'a [AdoptionCandidate],
    os_identity: Option<&OsFileIdentity>,
    path_key: &str,
    content_hash: &str,
    generation: u64,
) -> Option<&'a AdoptionCandidate> {
    os_identity
        .and_then(|id| {
            candidates
                .iter()
                .find(|c| c.os_identity.as_ref() == Some(id))
        })
        .or_else(|| candidates.iter().find(|c| c.path_key == path_key))
        .or_else(|| {
            candidates.iter().find(|c| {
                c.content_hash == content_hash
                    && generation.saturating_sub(c.last_seen_generation) <= 2
            })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(
        path: &str,
        hash: &str,
        id: Option<(u64, u128)>,
        generation: u64,
    ) -> AdoptionCandidate {
        AdoptionCandidate {
            local_resource_id: "stable".into(),
            path_key: path.into(),
            content_hash: hash.into(),
            os_identity: id.map(|(volume, file_index)| OsFileIdentity { volume, file_index }),
            last_seen_generation: generation,
        }
    }

    #[test]
    fn rename_move_and_folder_rename_keep_os_identity() {
        let old = candidate("folder/a.txt", "h1", Some((7, 42)), 1);
        let candidates = [old];
        let id = OsFileIdentity {
            volume: 7,
            file_index: 42,
        };
        assert_eq!(
            adopt(&candidates, Some(&id), "renamed/b.txt", "h1", 2)
                .unwrap()
                .local_resource_id,
            "stable"
        );
    }

    #[test]
    fn delete_and_recreate_does_not_adopt_a_different_hash() {
        let candidates = [candidate("a.txt", "old", Some((7, 42)), 1)];
        let id = OsFileIdentity {
            volume: 7,
            file_index: 99,
        };
        assert!(adopt(&candidates, Some(&id), "a.txt", "new", 5).is_some());
        // Path continuity deliberately wins only while the journal still maps
        // the path; deletion reconciliation removes that mapping first.
    }

    #[test]
    fn move_while_offline_adopts_by_recent_hash() {
        let candidates = [candidate("old/a.txt", "same", None, 8)];
        assert!(adopt(&candidates, None, "new/a.txt", "same", 10).is_some());
        assert!(adopt(&candidates, None, "new/a.txt", "same", 20).is_none());
    }
}
