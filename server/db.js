'use strict';
const { DatabaseSync } = require('node:sqlite');

function open(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      pass_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS progress (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      unit_id INTEGER NOT NULL,
      level TEXT NOT NULL,
      best INTEGER NOT NULL DEFAULT 0,
      last INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, unit_id, level)
    );
    CREATE TABLE IF NOT EXISTS unit_flags (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      unit_id INTEGER NOT NULL,
      bookmarked INTEGER NOT NULL DEFAULT 0,
      important INTEGER NOT NULL DEFAULT 0,
      visited_at INTEGER,
      PRIMARY KEY (user_id, unit_id)
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      unit_id INTEGER,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT 'yellow',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notes_user ON notes(user_id, unit_id);
    CREATE TABLE IF NOT EXISTS saved (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      unit_id INTEGER,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      extra TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS saved_user ON saved(user_id);
    CREATE TABLE IF NOT EXISTS mistakes (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      qid TEXT NOT NULL,
      unit_id INTEGER NOT NULL,
      wrong INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      due_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, qid)
    );
    CREATE TABLE IF NOT EXISTS activity (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      answered INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );
    CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New chat',
      remembered INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS threads_user ON threads(user_id, scope, updated_at);
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      reasoning TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id, id);
    CREATE TABLE IF NOT EXISTS memory (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope TEXT NOT NULL,
      text TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, scope)
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      unit_id INTEGER,
      kind TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      detail TEXT NOT NULL DEFAULT '[]',
      feedback TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS attempts_user ON attempts(user_id, unit_id, created_at);
    CREATE TABLE IF NOT EXISTS canvases (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      unit_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, unit_id)
    );
    CREATE TABLE IF NOT EXISTS ai_cache (
      key TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

module.exports = { open };
