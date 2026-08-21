use std::path::PathBuf;

use rusqlite::{Connection, params};

fn main() -> anyhow::Result<()> {
    let journal_path = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or_else(|| {
            anyhow::anyhow!("usage: prepare_isolated_journal <bridge.sqlite> <mount>")
        })?;
    let mount_path = std::env::args_os()
        .nth(2)
        .map(PathBuf::from)
        .ok_or_else(|| {
            anyhow::anyhow!("usage: prepare_isolated_journal <bridge.sqlite> <mount>")
        })?;
    anyhow::ensure!(journal_path.is_absolute(), "journal path must be absolute");
    anyhow::ensure!(mount_path.is_absolute(), "mount path must be absolute");
    anyhow::ensure!(journal_path.is_file(), "journal does not exist");
    anyhow::ensure!(mount_path.is_dir(), "mount does not exist");

    let mount_path = mount_path.canonicalize()?;
    let mount_value = serde_json::json!({
        "label": "N4 controlled fixture",
        "path": mount_path.to_string_lossy(),
    })
    .to_string();
    let mut connection = Connection::open(&journal_path)?;
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM config WHERE key LIKE 'mount:%'", [])?;
    transaction.execute("DELETE FROM config WHERE key LIKE 'mount_status:%'", [])?;
    transaction.execute("DELETE FROM config WHERE key LIKE 'cloud_mount:%'", [])?;
    transaction.execute("DELETE FROM resources", [])?;
    transaction.execute("DELETE FROM ops", [])?;
    transaction.execute("DELETE FROM queue", [])?;
    transaction.execute("DELETE FROM checkpoints", [])?;
    transaction.execute(
        "INSERT OR REPLACE INTO config(key,value) VALUES(?,?)",
        params!["mount:grant_deadbeef", mount_value],
    )?;
    transaction.commit()?;
    connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;

    let identity: i64 = connection.query_row(
        "SELECT COUNT(*) FROM config WHERE key IN ('device_id','browser_origin','browser_session_token')",
        [],
        |row| row.get(0),
    )?;
    let mounts: i64 = connection.query_row(
        "SELECT COUNT(*) FROM config WHERE key LIKE 'mount:%'",
        [],
        |row| row.get(0),
    )?;
    let resources: i64 =
        connection.query_row("SELECT COUNT(*) FROM resources", [], |row| row.get(0))?;
    anyhow::ensure!(identity == 3, "paired identity was not retained");
    anyhow::ensure!(
        mounts == 1,
        "isolated journal must contain exactly one mount"
    );
    anyhow::ensure!(resources == 0, "isolated journal retained resource rows");
    println!("identity={identity} mounts={mounts} resources={resources}");
    Ok(())
}
