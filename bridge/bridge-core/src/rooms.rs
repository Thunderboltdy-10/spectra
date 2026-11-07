//! Live rooms for work kept on this computer.
//!
//! The app and the AI already talk to collaboration rooms in the Hocuspocus wire
//! protocol, so a room here speaks the same one. Editing, presence and the AI's
//! edits then work the way they do in a cloud room, without those clients
//! knowing much about where the room lives.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use anyhow::{Context, anyhow};
use axum::extract::ws::{Message, WebSocket};
use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::sync::mpsc;
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{Doc, ReadTxn, StateVector, Transact, Update};

use crate::works::{Projection, WorkStore};

pub const FRAME_PROTOCOL: &str = "spectra-fragments-v1";
pub const FRAME_BYTES: usize = 512 * 1024;
pub const MAX_ASSEMBLED_BYTES: usize = 256 * 1024 * 1024;
const FRAME_HEADER: usize = 16;
const FRAME_MAGIC: u32 = 0x5339_4631;

const SYNC: u64 = 0;
const AWARENESS: u64 = 1;
const AUTH: u64 = 2;
const QUERY_AWARENESS: u64 = 3;
const STATELESS: u64 = 5;
const CLOSE: u64 = 7;
const SYNC_STATUS: u64 = 8;
const PING: u8 = 9;
const PONG: u8 = 10;

/// How much of the log builds up before it's folded into the saved state.
const COMPACT_AFTER: u32 = 200;
/// A long editing session still leaves saved points to go back to.
const VERSION_EVERY: Duration = Duration::from_secs(10 * 60);
/// The other side gives up on a silent connection after 30 seconds.
const PING_EVERY: Duration = Duration::from_secs(15);

pub type Authorize = Arc<dyn Fn(&str) -> bool + Send + Sync>;
type Outgoing = mpsc::UnboundedSender<Vec<u8>>;

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }

    fn var_uint(&mut self) -> anyhow::Result<u64> {
        let mut value = 0u64;
        let mut shift = 0u32;
        loop {
            let byte = *self.bytes.get(self.at).ok_or_else(|| anyhow!("message ended early"))?;
            self.at += 1;
            value |= u64::from(byte & 0x7f)
                .checked_shl(shift)
                .ok_or_else(|| anyhow!("number too long"))?;
            if byte & 0x80 == 0 {
                return Ok(value);
            }
            shift += 7;
            anyhow::ensure!(shift < 64, "number too long");
        }
    }

    fn bytes(&mut self) -> anyhow::Result<&'a [u8]> {
        let length = usize::try_from(self.var_uint()?)?;
        let end = self.at.checked_add(length).ok_or_else(|| anyhow!("length too long"))?;
        let slice = self.bytes.get(self.at..end).ok_or_else(|| anyhow!("message ended early"))?;
        self.at = end;
        Ok(slice)
    }

    fn string(&mut self) -> anyhow::Result<&'a str> {
        Ok(std::str::from_utf8(self.bytes()?)?)
    }
}

fn put_var_uint(out: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        out.push((value as u8 & 0x7f) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn put_bytes(out: &mut Vec<u8>, bytes: &[u8]) {
    put_var_uint(out, bytes.len() as u64);
    out.extend_from_slice(bytes);
}

/// A message for one document on a connection, under the name it used.
fn addressed(raw_key: &str, body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(raw_key.len() + body.len() + 4);
    put_bytes(&mut out, raw_key.as_bytes());
    out.extend_from_slice(body);
    out
}

fn sync_body(step: u64, payload: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(payload.len() + 6);
    put_var_uint(&mut body, SYNC);
    put_var_uint(&mut body, step);
    put_bytes(&mut body, payload);
    body
}

fn stateless_body(value: &Value) -> Vec<u8> {
    let mut body = Vec::new();
    put_var_uint(&mut body, STATELESS);
    put_bytes(&mut body, value.to_string().as_bytes());
    body
}

fn auth_body(sub: u64, text: &str) -> Vec<u8> {
    let mut body = Vec::new();
    put_var_uint(&mut body, AUTH);
    put_var_uint(&mut body, sub);
    put_bytes(&mut body, text.as_bytes());
    body
}

fn awareness_body(update: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(update.len() + 4);
    put_var_uint(&mut body, AWARENESS);
    put_bytes(&mut body, update);
    body
}

fn base64_of(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn from_base64(text: &str) -> anyhow::Result<Vec<u8>> {
    Ok(base64::engine::general_purpose::STANDARD.decode(text)?)
}

/// Long messages travel in pieces, the same ones `collaboration-framing` makes.
pub fn frames(message: Vec<u8>) -> Vec<Vec<u8>> {
    if message.len() <= FRAME_BYTES {
        return vec![message];
    }
    message
        .chunks(FRAME_BYTES - FRAME_HEADER)
        .scan(0usize, |offset, body| {
            let mut frame = Vec::with_capacity(FRAME_HEADER + body.len());
            frame.extend_from_slice(&FRAME_MAGIC.to_be_bytes());
            frame.extend_from_slice(&(message.len() as u32).to_be_bytes());
            frame.extend_from_slice(&(*offset as u32).to_be_bytes());
            frame.extend_from_slice(&(body.len() as u32).to_be_bytes());
            frame.extend_from_slice(body);
            *offset += body.len();
            Some(frame)
        })
        .collect()
}

#[derive(Default)]
pub struct Assembler {
    pending: Option<(Vec<u8>, usize)>,
}

impl Assembler {
    /// The whole message, once its last piece has arrived.
    pub fn accept(&mut self, data: Vec<u8>) -> anyhow::Result<Option<Vec<u8>>> {
        let framed = data.len() >= FRAME_HEADER && data[..4] == FRAME_MAGIC.to_be_bytes();
        if !framed {
            anyhow::ensure!(self.pending.is_none(), "a long message was cut off");
            return Ok(Some(data));
        }
        let field = |at: usize| u32::from_be_bytes([data[at], data[at + 1], data[at + 2], data[at + 3]]) as usize;
        let (total, at, length) = (field(4), field(8), field(12));
        anyhow::ensure!(
            total > FRAME_BYTES
                && total <= MAX_ASSEMBLED_BYTES
                && data.len() <= FRAME_BYTES
                && length == data.len() - FRAME_HEADER
                && length > 0
                && at + length <= total,
            "a long message was malformed"
        );
        let (mut body, offset) = self.pending.take().unwrap_or_else(|| (Vec::with_capacity(total), 0));
        anyhow::ensure!(at == offset && (offset == 0 || body.capacity() >= total), "a long message arrived out of order");
        body.extend_from_slice(&data[FRAME_HEADER..]);
        if body.len() == total {
            return Ok(Some(body));
        }
        self.pending = Some((body, at + length));
        Ok(None)
    }
}

/// The work a document name refers to.
pub fn artifact_of_document(name: &str) -> Option<&str> {
    let id = name.strip_prefix("artifact:")?.split(':').next()?;
    (!id.is_empty()).then_some(id)
}

/// Folds a saved state and the updates after it into one state.
pub fn merge_state(state: Option<&[u8]>, updates: &[Vec<u8>]) -> anyhow::Result<Vec<u8>> {
    let doc = Doc::new();
    {
        let mut txn = doc.transact_mut();
        if let Some(state) = state.filter(|state| !state.is_empty()) {
            txn.apply_update(Update::decode_v1(state)?)?;
        }
        for update in updates {
            txn.apply_update(Update::decode_v1(update)?)?;
        }
    }
    let txn = doc.transact();
    Ok(txn.encode_state_as_update_v1(&StateVector::default()))
}

struct Peer {
    raw_key: String,
    out: Outgoing,
    clients: HashSet<u64>,
}

struct Room {
    artifact_id: String,
    doc: Doc,
    peers: HashMap<u64, Peer>,
    awareness: BTreeMap<u64, (u64, String)>,
    logged: u32,
    /// Changed since the last saved point.
    changed: bool,
    last_version: Instant,
}

impl Room {
    fn state(&self) -> Vec<u8> {
        self.doc.transact().encode_state_as_update_v1(&StateVector::default())
    }

    fn state_vector(&self) -> Vec<u8> {
        self.doc.transact().state_vector().encode_v1()
    }

    fn send_to_others(&self, from: u64, body: &[u8]) {
        for (id, peer) in &self.peers {
            if *id != from {
                let _ = peer.out.send(addressed(&peer.raw_key, body));
            }
        }
    }

    fn awareness_update(&self) -> Option<Vec<u8>> {
        if self.awareness.is_empty() {
            return None;
        }
        let mut update = Vec::new();
        put_var_uint(&mut update, self.awareness.len() as u64);
        for (client, (clock, state)) in &self.awareness {
            put_var_uint(&mut update, *client);
            put_var_uint(&mut update, *clock);
            put_bytes(&mut update, state.as_bytes());
        }
        Some(update)
    }

    /// Writes the edit down before saying it's safe.
    fn apply(&mut self, store: &WorkStore, update: &[u8]) -> anyhow::Result<Option<i64>> {
        // An empty update is how a side says it has nothing the other lacks.
        if update.len() <= 2 {
            return Ok(None);
        }
        let decoded = Update::decode_v1(update).context("reading an edit")?;
        let sequence = store.append_update(&self.artifact_id, update)?;
        self.doc.transact_mut().apply_update(decoded).context("applying an edit")?;
        self.changed = true;
        self.logged += 1;
        if self.logged >= COMPACT_AFTER {
            store.compact(&self.artifact_id, &self.state())?;
            self.logged = 0;
        }
        if self.last_version.elapsed() >= VERSION_EVERY {
            self.checkpoint(store, "edit", None, None, None)?;
        }
        Ok(Some(sequence))
    }

    fn checkpoint(
        &mut self,
        store: &WorkStore,
        source: &str,
        summary: Option<&str>,
        actor: Option<&str>,
        run_id: Option<&str>,
    ) -> anyhow::Result<i64> {
        let id = store.add_version(&self.artifact_id, source, summary, actor, run_id, &self.state())?;
        self.changed = false;
        self.last_version = Instant::now();
        Ok(id)
    }

    fn finish(&mut self, store: &WorkStore) -> anyhow::Result<()> {
        if self.logged > 0 {
            store.compact(&self.artifact_id, &self.state())?;
            self.logged = 0;
        }
        if self.changed {
            self.checkpoint(store, "edit", None, None, None)?;
        }
        Ok(())
    }
}

pub struct Rooms {
    store: Arc<WorkStore>,
    open: Mutex<HashMap<String, Arc<Mutex<Room>>>>,
    next_peer: AtomicU64,
}

fn locked<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// This computer's rooms, opened the first time they're needed.
pub fn shared() -> Option<&'static Arc<Rooms>> {
    static ROOMS: OnceLock<Option<Arc<Rooms>>> = OnceLock::new();
    ROOMS
        .get_or_init(|| {
            let path = crate::works::default_store_path()?;
            match WorkStore::open(&path) {
                Ok(store) => Some(Rooms::new(Arc::new(store))),
                Err(error) => {
                    eprintln!("[works] {error:#}");
                    None
                }
            }
        })
        .as_ref()
}

impl Rooms {
    pub fn new(store: Arc<WorkStore>) -> Arc<Self> {
        Arc::new(Self { store, open: Mutex::new(HashMap::new()), next_peer: AtomicU64::new(1) })
    }

    pub fn store(&self) -> &WorkStore {
        &self.store
    }

    fn join(&self, artifact_id: &str, raw_key: &str, out: &Outgoing) -> anyhow::Result<(Arc<Mutex<Room>>, u64)> {
        let peer = self.next_peer.fetch_add(1, Ordering::Relaxed);
        let mut open = locked(&self.open);
        let room = match open.get(artifact_id) {
            Some(room) => room.clone(),
            None => {
                let (state, updates) = self.store.load(artifact_id)?;
                let doc = Doc::new();
                {
                    let mut txn = doc.transact_mut();
                    if let Some(state) = state.as_deref().filter(|state| !state.is_empty()) {
                        txn.apply_update(Update::decode_v1(state)?)?;
                    }
                    for update in &updates {
                        txn.apply_update(Update::decode_v1(update)?)?;
                    }
                }
                let room = Arc::new(Mutex::new(Room {
                    artifact_id: artifact_id.to_string(),
                    doc,
                    peers: HashMap::new(),
                    awareness: BTreeMap::new(),
                    logged: updates.len() as u32,
                    changed: !updates.is_empty(),
                    last_version: Instant::now(),
                }));
                open.insert(artifact_id.to_string(), room.clone());
                room
            }
        };
        locked(&room).peers.insert(
            peer,
            Peer { raw_key: raw_key.to_string(), out: out.clone(), clients: HashSet::new() },
        );
        Ok((room, peer))
    }

    fn leave(&self, artifact_id: &str, room: &Arc<Mutex<Room>>, peer: u64) {
        let mut open = locked(&self.open);
        let mut guard = locked(room);
        let Some(left) = guard.peers.remove(&peer) else {
            return;
        };
        if !left.clients.is_empty() {
            let mut update = Vec::new();
            put_var_uint(&mut update, left.clients.len() as u64);
            for client in &left.clients {
                let clock = guard.awareness.remove(client).map_or(0, |(clock, _)| clock);
                put_var_uint(&mut update, *client);
                put_var_uint(&mut update, clock + 1);
                put_bytes(&mut update, b"null");
            }
            guard.send_to_others(peer, &awareness_body(&update));
        }
        if guard.peers.is_empty() {
            if let Err(error) = guard.finish(&self.store) {
                eprintln!("[works] saving {artifact_id}: {error:#}");
            }
            if open.get(artifact_id).is_some_and(|current| Arc::ptr_eq(current, room)) {
                open.remove(artifact_id);
            }
        }
    }

    /// The whole document as it is now, whether or not anyone has it open.
    pub fn state(&self, artifact_id: &str) -> anyhow::Result<Vec<u8>> {
        if let Some(room) = locked(&self.open).get(artifact_id) {
            return Ok(locked(room).state());
        }
        let (state, updates) = self.store.load(artifact_id)?;
        if updates.is_empty() {
            if let Some(state) = state {
                return Ok(state);
            }
        }
        merge_state(state.as_deref(), &updates)
    }

    /// One request about stored work, from the app or the AI.
    pub fn call(&self, method: &str, params: &Value) -> anyhow::Result<Value> {
        let text = |key: &str| {
            params[key].as_str().map(str::to_string).ok_or_else(|| anyhow!("{key} is missing"))
        };
        Ok(match method {
            "get" => self.store.work(&text("artifactId")?)?.unwrap_or(Value::Null),
            "getMany" => {
                let ids: Vec<String> = serde_json::from_value(params["artifactIds"].clone())?;
                Value::Array(self.store.works(&ids)?)
            }
            "search" => Value::Array(self.store.search(
                &text("query")?,
                params["owner"].as_str(),
                params["limit"].as_i64().unwrap_or(10),
            )?),
            "save" => {
                let projection: Projection = serde_json::from_value(params["projection"].clone())?;
                self.store.save_projection(&text("artifactId")?, &projection)?;
                json!({ "ok": true })
            }
            "import" => {
                let artifact_id = text("artifactId")?;
                let projection: Projection = serde_json::from_value(params["projection"].clone())?;
                let state = from_base64(&text("stateBase64")?)?;
                Update::decode_v1(&state).context("reading the work to take in")?;
                anyhow::ensure!(
                    !locked(&self.open).contains_key(&artifact_id),
                    "This work is open here already."
                );
                self.store.import(&artifact_id, &projection, &state)?;
                json!({ "ok": true })
            }
            // The first to arrive sets a new work's starting point; anyone after joins it.
            "seed" => {
                let artifact_id = text("artifactId")?;
                let state = from_base64(&text("stateBase64")?)?;
                Update::decode_v1(&state).context("reading the work's starting point")?;
                let open = locked(&self.open);
                if let Some(room) = open.get(&artifact_id) {
                    let mut room = locked(room);
                    if room.state_vector() != StateVector::default().encode_v1() {
                        return Ok(json!({ "seeded": false }));
                    }
                    if room.apply(&self.store, &state)?.is_some() {
                        room.send_to_others(0, &sync_body(2, &state));
                    }
                    return Ok(json!({ "seeded": true }));
                }
                let (saved, updates) = self.store.load(&artifact_id)?;
                if saved.is_some_and(|saved| !saved.is_empty()) || !updates.is_empty() {
                    return Ok(json!({ "seeded": false }));
                }
                let projection: Projection = serde_json::from_value(params["projection"].clone()).unwrap_or_default();
                self.store.import(&artifact_id, &projection, &state)?;
                json!({ "seeded": true })
            }
            "state" => json!({ "stateBase64": base64_of(&self.state(&text("artifactId")?)?) }),
            "remove" => {
                let artifact_id = text("artifactId")?;
                locked(&self.open).remove(&artifact_id);
                self.store.remove(&artifact_id)?;
                json!({ "ok": true })
            }
            "versions" => Value::Array(
                self.store.versions(&text("artifactId")?, params["limit"].as_i64().unwrap_or(50))?,
            ),
            "version" => self
                .store
                .version(&text("artifactId")?, params["id"].as_i64().ok_or_else(|| anyhow!("id is missing"))?)?
                .unwrap_or(Value::Null),
            "summary" => self.store.summary()?,
            "backup" => {
                let (bundle, works) = self.store.backup_bundle(params["full"].as_bool().unwrap_or(false))?;
                json!({ "bundleBase64": base64_of(&bundle), "works": works, "bytes": bundle.len() })
            }
            "backedUp" => {
                self.store.mark_backed_up(params["at"].as_i64().ok_or_else(|| anyhow!("at is missing"))?)?;
                json!({ "ok": true })
            }
            "restore" => json!({ "restored": self.store.restore_bundle(&from_base64(&text("bundleBase64")?)?)? }),
            _ => anyhow::bail!("Unknown request"),
        })
    }
}

struct Joined {
    artifact_id: String,
    room: Arc<Mutex<Room>>,
    peer: u64,
}

/// One socket, which may hold several documents.
pub struct Connection {
    rooms: Arc<Rooms>,
    authorize: Authorize,
    out: Outgoing,
    joined: HashMap<String, Joined>,
}

impl Connection {
    pub fn new(rooms: Arc<Rooms>, authorize: Authorize, out: Outgoing) -> Self {
        Self { rooms, authorize, out, joined: HashMap::new() }
    }

    fn send(&self, raw_key: &str, body: &[u8]) {
        let _ = self.out.send(addressed(raw_key, body));
    }

    pub fn handle(&mut self, message: &[u8]) -> anyhow::Result<()> {
        if message == [PING] {
            let _ = self.out.send(vec![PONG]);
            return Ok(());
        }
        if message == [PONG] {
            return Ok(());
        }
        let mut reader = Reader::new(message);
        let raw_key = reader.string()?.to_string();
        match reader.var_uint()? {
            AUTH => self.authenticate(&raw_key, &mut reader),
            SYNC => self.sync(&raw_key, &mut reader),
            AWARENESS => self.awareness(&raw_key, &mut reader),
            QUERY_AWARENESS => {
                if let Some(joined) = self.joined.get(&raw_key) {
                    if let Some(update) = locked(&joined.room).awareness_update() {
                        self.send(&raw_key, &awareness_body(&update));
                    }
                }
                Ok(())
            }
            STATELESS => self.stateless(&raw_key, reader.string()?),
            CLOSE => {
                if let Some(joined) = self.joined.remove(&raw_key) {
                    self.rooms.leave(&joined.artifact_id, &joined.room, joined.peer);
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn authenticate(&mut self, raw_key: &str, reader: &mut Reader<'_>) -> anyhow::Result<()> {
        if reader.var_uint()? != 0 {
            return Ok(());
        }
        let token = reader.string()?;
        let document = raw_key.split('\0').next().unwrap_or(raw_key);
        let Some(artifact_id) = artifact_of_document(document).map(str::to_string) else {
            self.send(raw_key, &auth_body(1, "This work can't be opened here."));
            return Ok(());
        };
        if !(self.authorize)(token) {
            self.send(raw_key, &auth_body(1, "Spectra Bridge didn't recognise this browser."));
            return Ok(());
        }
        if !self.joined.contains_key(raw_key) {
            let (room, peer) = self.rooms.join(&artifact_id, raw_key, &self.out)?;
            self.joined.insert(raw_key.to_string(), Joined { artifact_id, room, peer });
        }
        self.send(raw_key, &auth_body(2, "read-write"));
        if let Some(update) = locked(&self.joined[raw_key].room).awareness_update() {
            self.send(raw_key, &awareness_body(&update));
        }
        Ok(())
    }

    fn sync(&mut self, raw_key: &str, reader: &mut Reader<'_>) -> anyhow::Result<()> {
        let Some(joined) = self.joined.get(raw_key) else {
            return Ok(());
        };
        let step = reader.var_uint()?;
        let payload = reader.bytes()?;
        let mut room = locked(&joined.room);
        if step == 0 {
            let vector = StateVector::decode_v1(payload).context("reading a state vector")?;
            let diff = room.doc.transact().encode_diff_v1(&vector);
            let own = room.state_vector();
            self.send(raw_key, &sync_body(1, &diff));
            self.send(raw_key, &sync_body(0, &own));
            return Ok(());
        }
        match room.apply(&self.rooms.store, payload) {
            Ok(Some(sequence)) => {
                room.send_to_others(joined.peer, &sync_body(2, payload));
                let id = format!("{}:{sequence}", joined.artifact_id);
                let vector = base64_of(&room.state_vector());
                self.send(raw_key, &stateless_body(&json!({ "type": "spectra.durable_pending", "updateIds": [id] })));
                self.send(raw_key, &stateless_body(&json!({ "type": "spectra.durable_ack", "updateIds": [id] })));
                self.send(raw_key, &stateless_body(&json!({ "type": "spectra.durable_frontier", "deviceStateVector": vector })));
            }
            Ok(None) => {}
            Err(error) => {
                eprintln!("[works] {}: {error:#}", joined.artifact_id);
                self.send(raw_key, &stateless_body(&json!({
                    "type": "spectra.durable_failed",
                    "message": "This edit couldn't be saved on this computer. Your draft is still here.",
                })));
                return Ok(());
            }
        }
        let mut status = Vec::new();
        put_var_uint(&mut status, SYNC_STATUS);
        put_var_uint(&mut status, 1);
        self.send(raw_key, &status);
        Ok(())
    }

    fn awareness(&mut self, raw_key: &str, reader: &mut Reader<'_>) -> anyhow::Result<()> {
        let Some(joined) = self.joined.get(raw_key) else {
            return Ok(());
        };
        let update = reader.bytes()?;
        let mut room = locked(&joined.room);
        let mut parts = Reader::new(update);
        let peer = joined.peer;
        for _ in 0..parts.var_uint()? {
            let client = parts.var_uint()?;
            let clock = parts.var_uint()?;
            let state = parts.string()?;
            if state == "null" {
                room.awareness.remove(&client);
                if let Some(entry) = room.peers.get_mut(&peer) {
                    entry.clients.remove(&client);
                }
            } else {
                room.awareness.insert(client, (clock, state.to_string()));
                if let Some(entry) = room.peers.get_mut(&peer) {
                    entry.clients.insert(client);
                }
            }
        }
        room.send_to_others(peer, &awareness_body(update));
        Ok(())
    }

    fn stateless(&mut self, raw_key: &str, payload: &str) -> anyhow::Result<()> {
        let Some(joined) = self.joined.get(raw_key) else {
            return Ok(());
        };
        let Ok(message) = serde_json::from_str::<Value>(payload) else {
            return Ok(());
        };
        let confirmation = message["confirmationId"].clone();
        match message["type"].as_str().unwrap_or_default() {
            // Messages on a socket arrive in order, so this answers for every edit before it.
            "spectra.durable_confirm" => {
                let vector = base64_of(&locked(&joined.room).state_vector());
                self.send(raw_key, &stateless_body(&json!({
                    "type": "spectra.durable_ack",
                    "confirmationId": confirmation,
                    "deviceStateVector": vector,
                })));
            }
            "spectra.recovery_request" => {
                let vector = base64_of(&locked(&joined.room).state_vector());
                self.send(raw_key, &stateless_body(&json!({
                    "type": "spectra.recovery_vector",
                    "admitted": true,
                    "confirmationId": confirmation,
                    "stateVector": vector,
                })));
            }
            "spectra.device_projection" => {
                let projection: Projection = serde_json::from_value(message["projection"].clone())?;
                self.rooms.store.save_projection(&joined.artifact_id, &projection)?;
            }
            "spectra.device_checkpoint" => {
                let mut room = locked(&joined.room);
                let id = room.checkpoint(
                    &self.rooms.store,
                    message["source"].as_str().unwrap_or("edit"),
                    message["summary"].as_str(),
                    message["actor"].as_str(),
                    message["runId"].as_str(),
                )?;
                self.send(raw_key, &stateless_body(&json!({
                    "type": "spectra.device_checkpoint_saved",
                    "confirmationId": confirmation,
                    "versionId": id,
                })));
            }
            _ => {}
        }
        Ok(())
    }

    pub fn close(&mut self) {
        for (_, joined) in self.joined.drain() {
            self.rooms.leave(&joined.artifact_id, &joined.room, joined.peer);
        }
    }
}

/// Runs a connection until its other side goes.
async fn drive(rooms: Arc<Rooms>, authorize: Authorize, mut inbound: mpsc::Receiver<Vec<u8>>, out: Outgoing) {
    let connection = Arc::new(Mutex::new(Connection::new(rooms, authorize, out.clone())));
    let mut assembler = Assembler::default();
    let mut ping = tokio::time::interval(PING_EVERY);
    ping.tick().await;
    loop {
        tokio::select! {
            message = inbound.recv() => {
                let Some(message) = message else { break };
                let whole = match assembler.accept(message) {
                    Ok(Some(whole)) => whole,
                    Ok(None) => continue,
                    Err(error) => {
                        eprintln!("[works] {error:#}");
                        break;
                    }
                };
                let handling = connection.clone();
                // Saving touches the disk; keep it off the threads serving other requests.
                let result = tokio::task::spawn_blocking(move || locked(&handling).handle(&whole)).await;
                if let Ok(Err(error)) = result {
                    eprintln!("[works] {error:#}");
                }
            }
            _ = ping.tick() => {
                if out.send(vec![PING]).is_err() {
                    break;
                }
            }
        }
    }
    let closing = connection.clone();
    let _ = tokio::task::spawn_blocking(move || locked(&closing).close()).await;
}

/// A browser's socket to the rooms.
pub async fn serve_browser(socket: WebSocket, rooms: Arc<Rooms>, authorize: Authorize) {
    let (mut sink, mut stream) = socket.split();
    let (out, mut outgoing) = mpsc::unbounded_channel::<Vec<u8>>();
    let (to_room, inbound) = mpsc::channel::<Vec<u8>>(256);
    let writer = tokio::spawn(async move {
        while let Some(message) = outgoing.recv().await {
            for frame in frames(message) {
                if sink.send(Message::Binary(frame.into())).await.is_err() {
                    return;
                }
            }
        }
    });
    let reader = tokio::spawn(async move {
        while let Some(Ok(message)) = stream.next().await {
            match message {
                Message::Binary(bytes) => {
                    if to_room.send(bytes.to_vec()).await.is_err() {
                        return;
                    }
                }
                Message::Close(_) => return,
                _ => {}
            }
        }
    });
    drive(rooms, authorize, inbound, out).await;
    reader.abort();
    writer.abort();
}

/// The server's socket for one request after another about stored work.
pub async fn serve_store_requests<S, R, E>(mut sink: S, mut stream: R, rooms: Arc<Rooms>)
where
    S: futures_util::Sink<String> + Unpin,
    R: futures_util::Stream<Item = Result<String, E>> + Unpin,
{
    while let Some(Ok(text)) = stream.next().await {
        let reply = answer_store_request(rooms.clone(), text).await;
        if sink.send(reply).await.is_err() {
            return;
        }
    }
}

/// Reads `{id, method, params}` and answers `{id, result}` or `{id, error}`.
pub async fn answer_store_request(rooms: Arc<Rooms>, text: String) -> String {
    let answered = tokio::task::spawn_blocking(move || {
        let request: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        let id = request["id"].clone();
        let method = request["method"].as_str().unwrap_or_default().to_string();
        match rooms.call(&method, &request["params"]) {
            Ok(result) => json!({ "id": id, "result": result }),
            Err(error) => json!({ "id": id, "error": format!("{error:#}") }),
        }
    })
    .await;
    answered.unwrap_or_else(|_| json!({ "error": "The request stopped unexpectedly." })).to_string()
}

/// A connection arriving through the hub, already vouched for by it.
pub async fn serve_pipe<S, R, E>(mut sink: S, mut stream: R, rooms: Arc<Rooms>)
where
    S: futures_util::Sink<Vec<u8>> + Unpin + Send + 'static,
    R: futures_util::Stream<Item = Result<Vec<u8>, E>> + Unpin + Send + 'static,
    E: Send + 'static,
{
    let (out, mut outgoing) = mpsc::unbounded_channel::<Vec<u8>>();
    let (to_room, inbound) = mpsc::channel::<Vec<u8>>(256);
    let writer = tokio::spawn(async move {
        while let Some(message) = outgoing.recv().await {
            for frame in frames(message) {
                if sink.send(frame).await.is_err() {
                    return;
                }
            }
        }
    });
    let reader = tokio::spawn(async move {
        while let Some(Ok(message)) = stream.next().await {
            if to_room.send(message).await.is_err() {
                return;
            }
        }
    });
    drive(rooms, Arc::new(|_| true), inbound, out).await;
    reader.abort();
    writer.abort();
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{GetString, Text};

    const DOCUMENT: &str = "artifact:work1:cm9vdA:ZG9jdW1lbnQ";

    struct Client {
        connection: Connection,
        incoming: mpsc::UnboundedReceiver<Vec<u8>>,
    }

    impl Client {
        fn new(rooms: &Arc<Rooms>) -> Self {
            let (out, incoming) = mpsc::unbounded_channel();
            Self { connection: Connection::new(rooms.clone(), Arc::new(|token| token == "good"), out), incoming }
        }

        fn drain(&mut self) -> Vec<Vec<u8>> {
            let mut messages = Vec::new();
            while let Ok(message) = self.incoming.try_recv() {
                messages.push(message);
            }
            messages
        }

        fn sign_in(&mut self, token: &str) -> Vec<Vec<u8>> {
            let mut body = Vec::new();
            put_var_uint(&mut body, AUTH);
            put_var_uint(&mut body, 0);
            put_bytes(&mut body, token.as_bytes());
            put_bytes(&mut body, b"4.4.0");
            self.connection.handle(&addressed(DOCUMENT, &body)).unwrap();
            self.drain()
        }

        fn send_update(&mut self, update: &[u8]) -> Vec<Vec<u8>> {
            self.connection.handle(&addressed(DOCUMENT, &sync_body(2, update))).unwrap();
            self.drain()
        }

        fn stateless(&mut self, value: Value) -> Vec<Vec<u8>> {
            self.connection.handle(&addressed(DOCUMENT, &stateless_body(&value))).unwrap();
            self.drain()
        }
    }

    fn rooms() -> Arc<Rooms> {
        Rooms::new(Arc::new(WorkStore::in_memory().unwrap()))
    }

    fn edit(text: &str) -> Vec<u8> {
        let doc = Doc::new();
        let content = doc.get_or_insert_text("content");
        let mut txn = doc.transact_mut();
        content.insert(&mut txn, 0, text);
        txn.encode_state_as_update_v1(&StateVector::default())
    }

    fn body_of(message: &[u8]) -> (u64, Vec<u8>) {
        let mut reader = Reader::new(message);
        reader.string().unwrap();
        let kind = reader.var_uint().unwrap();
        (kind, message[reader.at..].to_vec())
    }

    fn statelesses(messages: &[Vec<u8>]) -> Vec<Value> {
        messages
            .iter()
            .filter_map(|message| {
                let (kind, body) = body_of(message);
                (kind == STATELESS).then(|| serde_json::from_str(Reader::new(&body).string().unwrap()).unwrap())
            })
            .collect()
    }

    fn text_of(state: &[u8]) -> String {
        let doc = Doc::new();
        let content = doc.get_or_insert_text("content");
        doc.transact_mut().apply_update(Update::decode_v1(state).unwrap()).unwrap();
        let txn = doc.transact();
        content.get_string(&txn)
    }

    #[test]
    fn a_stranger_is_refused_and_a_paired_browser_gets_in() {
        let rooms = rooms();
        let mut stranger = Client::new(&rooms);
        let replies = stranger.sign_in("bad");
        let (kind, body) = body_of(&replies[0]);
        assert_eq!((kind, body[0]), (AUTH, 1));
        assert!(stranger.connection.joined.is_empty());
        stranger.send_update(&edit("sneaky"));
        assert_eq!(text_of(&rooms.state("work1").unwrap()), "");

        let mut browser = Client::new(&rooms);
        let replies = browser.sign_in("good");
        let (kind, body) = body_of(&replies[0]);
        assert_eq!((kind, body[0]), (AUTH, 2));
    }

    #[test]
    fn a_new_arrival_gets_the_document_and_its_own_vector_back() {
        let rooms = rooms();
        let mut first = Client::new(&rooms);
        first.sign_in("good");
        first.send_update(&edit("hello"));

        let mut second = Client::new(&rooms);
        second.sign_in("good");
        second
            .connection
            .handle(&addressed(DOCUMENT, &sync_body(0, &StateVector::default().encode_v1())))
            .unwrap();
        let replies = second.drain();
        let (kind, body) = body_of(&replies[0]);
        assert_eq!(kind, SYNC);
        let mut reader = Reader::new(&body);
        assert_eq!(reader.var_uint().unwrap(), 1);
        assert_eq!(text_of(reader.bytes().unwrap()), "hello");
        let (kind, body) = body_of(&replies[1]);
        assert_eq!(kind, SYNC);
        assert_eq!(body[0], 0);
    }

    #[test]
    fn an_edit_reaches_the_others_and_is_acknowledged_only_to_its_author() {
        let rooms = rooms();
        let mut author = Client::new(&rooms);
        let mut other = Client::new(&rooms);
        author.sign_in("good");
        other.sign_in("good");
        let replies = author.send_update(&edit("hi"));
        let messages = statelesses(&replies);
        assert_eq!(messages[0]["type"], "spectra.durable_pending");
        assert_eq!(messages[1]["type"], "spectra.durable_ack");
        assert_eq!(messages[0]["updateIds"], messages[1]["updateIds"]);
        assert_eq!(messages[2]["type"], "spectra.durable_frontier");
        assert_eq!(body_of(replies.last().unwrap()), (SYNC_STATUS, vec![1]));

        let delivered = other.drain();
        assert_eq!(delivered.len(), 1);
        let (kind, body) = body_of(&delivered[0]);
        assert_eq!(kind, SYNC);
        assert_eq!(body[0], 2);
    }

    #[test]
    fn work_survives_everyone_leaving_and_leaves_a_saved_point() {
        let rooms = rooms();
        let mut client = Client::new(&rooms);
        client.sign_in("good");
        client.send_update(&edit("kept"));
        client.connection.close();
        assert!(locked(&rooms.open).is_empty());
        assert_eq!(rooms.store.load("work1").unwrap().1.len(), 0);
        assert_eq!(rooms.store.versions("work1", 5).unwrap().len(), 1);

        let mut back = Client::new(&rooms);
        back.sign_in("good");
        assert_eq!(text_of(&rooms.state("work1").unwrap()), "kept");
        back.connection.close();
        assert_eq!(rooms.store.versions("work1", 5).unwrap().len(), 1);
    }

    #[test]
    fn work_interrupted_before_the_room_closed_still_loads() {
        let rooms = rooms();
        rooms.store.append_update("work1", &edit("not lost")).unwrap();
        assert_eq!(text_of(&rooms.state("work1").unwrap()), "not lost");
        let mut client = Client::new(&rooms);
        client.sign_in("good");
        assert_eq!(text_of(&locked(&client.connection.joined[DOCUMENT].room).state()), "not lost");
    }

    #[test]
    fn a_long_log_folds_into_the_saved_state() {
        let rooms = rooms();
        let mut client = Client::new(&rooms);
        client.sign_in("good");
        for _ in 0..COMPACT_AFTER {
            client.send_update(&edit("x"));
        }
        let (state, updates) = rooms.store.load("work1").unwrap();
        assert!(state.is_some());
        assert!(updates.is_empty());
    }

    #[test]
    fn a_broken_edit_is_reported_and_keeps_the_room_working() {
        let rooms = rooms();
        let mut client = Client::new(&rooms);
        client.sign_in("good");
        let replies = client.send_update(&[9, 9, 9, 9, 9]);
        assert_eq!(statelesses(&replies)[0]["type"], "spectra.durable_failed");
        assert!(rooms.store.load("work1").unwrap().1.is_empty());
        let replies = client.send_update(&edit("fine"));
        assert_eq!(statelesses(&replies)[1]["type"], "spectra.durable_ack");
    }

    #[test]
    fn confirmation_answers_with_what_this_computer_holds() {
        let rooms = rooms();
        let mut client = Client::new(&rooms);
        client.sign_in("good");
        client.send_update(&edit("hi"));
        let replies = client.stateless(json!({ "type": "spectra.durable_confirm", "confirmationId": "recovery:1" }));
        let message = &statelesses(&replies)[0];
        assert_eq!(message["confirmationId"], "recovery:1");
        let vector = from_base64(message["deviceStateVector"].as_str().unwrap()).unwrap();
        assert_eq!(StateVector::decode_v1(&vector).unwrap().len(), 1);

        let replies = client.stateless(json!({ "type": "spectra.recovery_request", "confirmationId": "recovery:2" }));
        let message = &statelesses(&replies)[0];
        assert_eq!(message["type"], "spectra.recovery_vector");
        assert_eq!(message["admitted"], true);
    }

    #[test]
    fn what_the_app_says_about_a_work_is_stored_and_searchable() {
        let rooms = rooms();
        let mut client = Client::new(&rooms);
        client.sign_in("good");
        client.stateless(json!({
            "type": "spectra.device_projection",
            "projection": { "title": "Essay", "text": "Macbeth and ambition", "content": { "blocks": 1 } },
        }));
        let work = rooms.call("get", &json!({ "artifactId": "work1" })).unwrap();
        assert_eq!(work["title"], "Essay");
        let found = rooms.call("search", &json!({ "query": "ambition" })).unwrap();
        assert_eq!(found[0]["artifactId"], "work1");
    }

    #[test]
    fn a_checkpoint_is_a_point_to_return_to() {
        let rooms = rooms();
        let mut client = Client::new(&rooms);
        client.sign_in("good");
        client.send_update(&edit("one"));
        let replies = client.stateless(json!({ "type": "spectra.device_checkpoint", "source": "ai", "summary": "Added a page", "runId": "run1" }));
        let id = statelesses(&replies)[0]["versionId"].as_i64().unwrap();
        let version = rooms.call("version", &json!({ "artifactId": "work1", "id": id })).unwrap();
        assert_eq!(version["source"], "ai");
        assert_eq!(text_of(&from_base64(version["stateBase64"].as_str().unwrap()).unwrap()), "one");
        let listed = rooms.call("versions", &json!({ "artifactId": "work1" })).unwrap();
        assert_eq!(listed[0]["runId"], "run1");
    }

    #[test]
    fn presence_is_shared_kept_for_late_arrivals_and_cleared_on_leaving() {
        let rooms = rooms();
        let mut first = Client::new(&rooms);
        let mut second = Client::new(&rooms);
        first.sign_in("good");
        second.sign_in("good");
        let mut update = Vec::new();
        put_var_uint(&mut update, 1);
        put_var_uint(&mut update, 777);
        put_var_uint(&mut update, 1);
        put_bytes(&mut update, br#"{"user":"A"}"#);
        first.connection.handle(&addressed(DOCUMENT, &awareness_body(&update))).unwrap();
        assert_eq!(body_of(&second.drain()[0]).0, AWARENESS);

        let mut late = Client::new(&rooms);
        let replies = late.sign_in("good");
        assert_eq!(body_of(&replies[1]).0, AWARENESS);

        first.connection.close();
        let delivered = second.drain();
        let (kind, body) = body_of(&delivered[0]);
        assert_eq!(kind, AWARENESS);
        let mut outer = Reader::new(&body);
        let mut parts = Reader::new(outer.bytes().unwrap());
        assert_eq!(parts.var_uint().unwrap(), 1);
        assert_eq!(parts.var_uint().unwrap(), 777);
        assert_eq!(parts.var_uint().unwrap(), 2);
        assert_eq!(parts.string().unwrap(), "null");
    }

    #[test]
    fn a_session_suffixed_name_is_answered_under_that_name() {
        let rooms = rooms();
        let (out, mut incoming) = mpsc::unbounded_channel();
        let mut connection = Connection::new(rooms.clone(), Arc::new(|_| true), out);
        let raw_key = format!("{DOCUMENT}\0session");
        let mut body = Vec::new();
        put_var_uint(&mut body, AUTH);
        put_var_uint(&mut body, 0);
        put_bytes(&mut body, b"t");
        connection.handle(&addressed(&raw_key, &body)).unwrap();
        let reply = incoming.try_recv().unwrap();
        assert_eq!(Reader::new(&reply).string().unwrap(), raw_key);
        assert!(locked(&rooms.open).contains_key("work1"));
    }

    #[test]
    fn ping_is_answered_with_a_single_byte() {
        let rooms = rooms();
        let mut client = Client::new(&rooms);
        client.connection.handle(&[PING]).unwrap();
        assert_eq!(client.drain(), vec![vec![PONG]]);
    }

    #[test]
    fn long_messages_come_apart_and_back_together() {
        let message: Vec<u8> = (0..(FRAME_BYTES * 2 + 77)).map(|index| (index % 251) as u8).collect();
        let pieces = frames(message.clone());
        assert!(pieces.len() >= 3);
        assert!(pieces.iter().all(|piece| piece.len() <= FRAME_BYTES));
        let mut assembler = Assembler::default();
        let mut whole = None;
        for piece in pieces {
            whole = assembler.accept(piece).unwrap();
        }
        assert_eq!(whole.unwrap(), message);
        assert_eq!(assembler.accept(vec![1, 2, 3]).unwrap().unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn pieces_out_of_order_are_refused() {
        let message = vec![7u8; FRAME_BYTES * 2 + 1];
        let pieces = frames(message);
        let mut assembler = Assembler::default();
        assert!(assembler.accept(pieces[1].clone()).is_err());
        let mut assembler = Assembler::default();
        assembler.accept(pieces[0].clone()).unwrap();
        assert!(assembler.accept(vec![1, 2, 3]).is_err());
    }

    #[test]
    fn only_the_first_to_arrive_sets_a_works_starting_point() {
        let rooms = rooms();
        let first = base64_of(&edit("first"));
        let second = base64_of(&edit("second"));
        let seed = |state: &str| rooms.call("seed", &json!({ "artifactId": "work1", "stateBase64": state })).unwrap();
        assert_eq!(seed(&first)["seeded"], true);
        assert_eq!(seed(&second)["seeded"], false);
        assert_eq!(text_of(&rooms.state("work1").unwrap()), "first");
    }

    #[test]
    fn a_starting_point_reaches_a_room_already_open_and_empty() {
        let rooms = rooms();
        let mut waiting = Client::new(&rooms);
        waiting.sign_in("good");
        rooms.call("seed", &json!({ "artifactId": "work1", "stateBase64": base64_of(&edit("start")) })).unwrap();
        let delivered = waiting.drain();
        assert_eq!(body_of(&delivered[0]).0, SYNC);
        assert_eq!(text_of(&rooms.state("work1").unwrap()), "start");
        let again = rooms.call("seed", &json!({ "artifactId": "work1", "stateBase64": base64_of(&edit("late")) })).unwrap();
        assert_eq!(again["seeded"], false);
    }

    #[test]
    fn document_names_give_up_their_work() {
        assert_eq!(artifact_of_document(DOCUMENT), Some("work1"));
        assert_eq!(artifact_of_document("other:work1"), None);
        assert_eq!(artifact_of_document("artifact:"), None);
    }

    #[test]
    fn numbers_and_strings_read_back_as_written() {
        for value in [0u64, 1, 127, 128, 300, 4_294_967_295, 9_007_199_254_740_991] {
            let mut out = Vec::new();
            put_var_uint(&mut out, value);
            assert_eq!(Reader::new(&out).var_uint().unwrap(), value);
        }
        assert!(Reader::new(&[0x80]).var_uint().is_err());
        assert!(Reader::new(&[5, 1]).bytes().is_err());
    }
}
