const SCHEMA_VERSION = 1;
const COLLECTIONS = [
  "sources", "intents", "captureDrafts", "protectedBlocks", "requests", "commitments",
  "plans", "changeSets", "approvals", "operations", "drafts", "checkpoints", "materials", "quietSessions",
];
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export class WorkspaceError extends Error {
  constructor(status, code, message, revision) {
    super(message);
    this.status = status;
    this.code = code;
    this.revision = revision;
  }
}

function invalid(message) { throw new WorkspaceError(400, "INVALID_WORKSPACE", message); }
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

function validateState(state) {
  if (!record(state)) invalid("state must be an object");
  if (state.dataMode !== "live") invalid("Only live data can be stored in the account workspace");
  if (!Number.isSafeInteger(state.schemaVersion) || state.schemaVersion < 1) invalid("Invalid domain schemaVersion");
  if (!Number.isSafeInteger(state.globalRevision) || state.globalRevision < 0) invalid("Invalid globalRevision");
  for (const key of COLLECTIONS) {
    if (!record(state[key])) invalid(`${key} must be an entity collection`);
    for (const [id, entity] of Object.entries(state[key])) {
      if (!id || id.length > 200 || RESERVED_KEYS.has(id) || !record(entity) || entity.id !== id || entity.dataMode !== "live" ||
        !Number.isSafeInteger(entity.revision) || entity.revision < 1) invalid(`Invalid entity in ${key}`);
    }
  }
  if (!record(state.ruleset) || !record(state.attention) || !record(state.attention.items) || !record(state.attention.budget) ||
    !Array.isArray(state.ledger) || !Array.isArray(state.events)) invalid("Missing workspace governance records");
  // This boundary stores the domain document, including unknown additive fields.
  // It does not execute provider actions or confer external authorization.
}

/** Shares the auth connection so deleting a user and cascading their data are atomic. */
export function createWorkspaceStore(db, { now = Date.now } = {}) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS workspace_schema_migrations (
      version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
    )`);
    const latest = db.prepare("SELECT MAX(version) AS version FROM workspace_schema_migrations").get().version ?? 0;
    if (latest > SCHEMA_VERSION) throw new Error("Workspace database schema is newer than this server");
    if (latest < 1) {
      db.exec(`CREATE TABLE workspaces (
        owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        domain_schema_version INTEGER NOT NULL,
        state_json TEXT NOT NULL CHECK (json_valid(state_json)),
        updated_at TEXT NOT NULL
      )`);
      db.prepare("INSERT INTO workspace_schema_migrations(version, applied_at) VALUES (?, ?)").run(1, new Date(now()).toISOString());
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  function read(ownerId) {
    const row = db.prepare("SELECT revision, state_json, updated_at FROM workspaces WHERE owner_id = ?").get(ownerId);
    return row ? { revision: row.revision, state: JSON.parse(row.state_json), updatedAt: row.updated_at } :
      { revision: 0, state: null, updatedAt: null };
  }

  function save(ownerId, { state, expectedRevision } = {}) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) invalid("expectedRevision must be a nonnegative integer");
    validateState(state);
    const raw = JSON.stringify(state);
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new WorkspaceError(413, "WORKSPACE_TOO_LARGE", "Workspace exceeds 2 MiB");
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = read(ownerId);
      if (current.revision !== expectedRevision) {
        throw new WorkspaceError(409, "REVISION_CONFLICT", "Workspace changed; reload before saving", current.revision);
      }
      if (current.state && state.schemaVersion < current.state.schemaVersion) invalid("Domain schema downgrade is not allowed");
      if (current.state && state.globalRevision <= current.state.globalRevision) invalid("globalRevision must advance");
      const revision = current.revision + 1;
      const updatedAt = new Date(now()).toISOString();
      db.prepare(`INSERT INTO workspaces(owner_id, revision, domain_schema_version, state_json, updated_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET
        revision = excluded.revision, domain_schema_version = excluded.domain_schema_version,
        state_json = excluded.state_json, updated_at = excluded.updated_at`).run(ownerId, revision, state.schemaVersion, raw, updatedAt);
      db.exec("COMMIT");
      return { revision, state, updatedAt };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function count(ownerId) {
    const { state } = read(ownerId);
    if (!state) return 0;
    return COLLECTIONS.reduce((total, key) => total + Object.keys(state[key]).length, 0) + Object.keys(state.attention.items).length;
  }

  return { read, save, count };
}
