use std::path::PathBuf;

use rusqlite::Connection;

fn main() -> anyhow::Result<()> {
    let journal_path = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("usage: inspect_journal <bridge.sqlite>"))?;
    anyhow::ensure!(journal_path.is_absolute(), "journal path must be absolute");
    anyhow::ensure!(journal_path.is_file(), "journal does not exist");

    let connection = Connection::open(journal_path)?;
    for table in ["config", "resources", "ops", "queue"] {
        println!("[{table}]");
        let mut statement = connection.prepare(&format!("SELECT * FROM {table}"))?;
        let column_count = statement.column_count();
        let names = statement
            .column_names()
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let rows = statement.query_map([], |row| {
            let values = (0..column_count)
                .map(|index| {
                    let value = row.get_ref(index)?;
                    Ok(format!("{}={value:?}", names[index]))
                })
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(values.join(" "))
        })?;
        for row in rows {
            println!("{}", row?);
        }
    }
    Ok(())
}
