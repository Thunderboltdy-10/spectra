async (page) => {
  const inspected = await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const names = databases.map((entry) => entry.name);
    const open = indexedDB.open("spectra-yjs-room-v1", 2);
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const records = [];
    if (db.objectStoreNames.contains("work-updates")) {
      const tx = db.transaction("work-updates", "readonly");
      const store = tx.objectStore("work-updates");
      const all = await new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      for (const record of all) {
        const key = String(record.key ?? "");
        records.push({
          key,
          bytes: record.bytes ?? record.update?.byteLength ?? 0,
          pendingRemoteSync: record.pendingRemoteSync ?? false,
          card9: key.includes("wx76fh3p6w3x5qd06gxewprs0h8djr5d"),
        });
      }
    }
    db.close();
    return { names, records };
  });
  return inspected;
}
