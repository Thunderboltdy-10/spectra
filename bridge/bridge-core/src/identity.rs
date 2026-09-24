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
    pub available: bool,
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
        .or_else(|| {
            candidates
                .iter()
                .find(|c| c.path_key == path_key && (c.available || c.content_hash == content_hash))
        })
        .or_else(|| {
            // Same bytes at a new path are a copy while the original is still
            // present. Hash continuity is only a move when the prior occupant
            // has already disappeared.
            let mut matches = candidates.iter().filter(|c| {
                !c.available
                    && c.content_hash == content_hash
                    && generation.saturating_sub(c.last_seen_generation) <= 2
            });
            let candidate = matches.next()?;
            matches.next().is_none().then_some(candidate)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(
        path: &str,
        hash: &str,
        id: Option<(u64, u128)>,
        available: bool,
        generation: u64,
    ) -> AdoptionCandidate {
        AdoptionCandidate {
            local_resource_id: "stable".into(),
            path_key: path.into(),
            content_hash: hash.into(),
            os_identity: id.map(|(volume, file_index)| OsFileIdentity { volume, file_index }),
            available,
            last_seen_generation: generation,
        }
    }

    #[test]
    fn rename_move_and_folder_rename_keep_os_identity() {
        let old = candidate("folder/a.txt", "h1", Some((7, 42)), true, 1);
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
        let candidates = [candidate("a.txt", "old", Some((7, 42)), false, 1)];
        let id = OsFileIdentity {
            volume: 7,
            file_index: 99,
        };
        assert!(adopt(&candidates, Some(&id), "a.txt", "new", 5).is_none());
    }

    #[test]
    fn edit_in_place_keeps_path_identity_when_os_identity_is_unavailable() {
        let candidates = [candidate("a.txt", "old", None, true, 1)];
        assert!(adopt(&candidates, None, "a.txt", "new", 5).is_some());
    }

    #[test]
    fn move_while_offline_adopts_by_recent_hash() {
        let candidates = [candidate("old/a.txt", "same", None, false, 8)];
        assert!(adopt(&candidates, None, "new/a.txt", "same", 10).is_some());
        assert!(adopt(&candidates, None, "new/a.txt", "same", 20).is_none());
    }

    #[test]
    fn copy_of_an_available_file_is_not_adopted_as_a_move() {
        let original = candidate("Physics/GQMC.docx", "same", Some((7, 1)), true, 8);
        let candidates = [original];
        let copy = OsFileIdentity {
            volume: 7,
            file_index: 99,
        };
        assert!(
            adopt(
                &candidates,
                Some(&copy),
                "Spectra/P8V1-D3-collab.docx",
                "same",
                10
            )
            .is_none()
        );
    }

    #[test]
    fn ambiguous_hash_continuity_refuses_to_guess() {
        let candidates = [
            candidate("old/a.txt", "same", None, false, 8),
            candidate("old/copy.txt", "same", None, false, 9),
        ];
        assert!(adopt(&candidates, None, "new/a.txt", "same", 10).is_none());
    }
}
