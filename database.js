const path = require('path');
const bcrypt = require('bcrypt');

// Database configuration
const isProduction = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL;
let db;
let query; // Unified query function

if (isProduction) {
  // PostgreSQL (Production)
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  // Wrapper for PG queries
  query = async (text, params) => {
    // Convert ? parameters to $1, $2, etc.
    let paramIndex = 1;
    const pgText = text.replace(/\?/g, () => `$${paramIndex++}`);
    const res = await pool.query(pgText, params);
    return res;
  };

  db = pool;
  console.log('Using PostgreSQL database');
} else {
  // SQLite (Development)
  const sqlite3 = require('sqlite3').verbose();
  const DB_PATH = path.join(__dirname, 'notepad.db');
  const sqliteDb = new sqlite3.Database(DB_PATH);
  
  // Wrapper for SQLite queries to match generic interface
  query = (text, params) => {
    return new Promise((resolve, reject) => {
      // Determine query type
      const method = text.trim().toUpperCase().startsWith('SELECT') ? 'all' : 'run';
      
      sqliteDb[method](text, params, function(err, rows) {
        if (err) return reject(err);
        if (this.lastID) rows = { id: this.lastID }; // Simulate INSERT return
        resolve({ rows: rows || [], rowCount: this.changes || 0 });
      });
    });
  };

  db = sqliteDb;
  console.log('Using SQLite database');
}

// Initialize database tables
async function initializeDatabase() {
  const schema = [
    // Notepads table
    `CREATE TABLE IF NOT EXISTS notepads (
      id TEXT PRIMARY KEY,
      content TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_editor TEXT
    )`,
    
    // Users table
    `CREATE TABLE IF NOT EXISTS users (
      id ${isProduction ? 'SERIAL' : 'INTEGER'} PRIMARY KEY,
      notepad_id TEXT,
      username TEXT,
      password_hash TEXT,
      is_alternate ${isProduction ? 'BOOLEAN DEFAULT FALSE' : 'BOOLEAN DEFAULT 0'},
      FOREIGN KEY (notepad_id) REFERENCES notepads(id),
      UNIQUE(notepad_id, username)
    )`,

    // Feedback table
    `CREATE TABLE IF NOT EXISTS feedback (
      id ${isProduction ? 'SERIAL' : 'INTEGER'} PRIMARY KEY,
      notepad_id TEXT,
      line_number INTEGER,
      reaction TEXT,
      comment TEXT,
      username TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (notepad_id) REFERENCES notepads(id)
    )`,

    // Files table
    `CREATE TABLE IF NOT EXISTS files (
      id ${isProduction ? 'SERIAL' : 'INTEGER'} PRIMARY KEY,
      notepad_id TEXT,
      filename TEXT,
      filepath TEXT,
      mimetype TEXT,
      size INTEGER,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (notepad_id) REFERENCES notepads(id)
    )`
  ];

  try {
    for (const statement of schema) {
      await query(statement);
    }
    console.log('Database initialized successfully');
    await initializeMainNotepad();
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

// Initialize the main notepad with fixed credentials
async function initializeMainNotepad() {
  try {
    const existing = await getNotepad('main');
    if (existing) {
      console.log('Main notepad already exists');
      return;
    }

    await query('INSERT INTO notepads (id, content) VALUES (?, ?)', ['main', '']);

    const mainHash = await bcrypt.hash('idk', 10);
    const altHash = await bcrypt.hash('tes', 10);

    const users = [
      { username: 'sabs', hash: mainHash, isAlt: isProduction ? false : 0 },
      { username: 'separate', hash: altHash, isAlt: isProduction ? true : 1 }
    ];

    for (const user of users) {
      await query(
        'INSERT INTO users (notepad_id, username, password_hash, is_alternate) VALUES (?, ?, ?, ?)',
        ['main', user.username, user.hash, user.isAlt]
      );
    }
    console.log('Main notepad initialized with fixed credentials');
  } catch (err) {
    console.error('Error initializing main notepad:', err);
  }
}

// Create a new notepad
async function createNotepad(notepadId, password, altPassword) {
  try {
    await query('INSERT INTO notepads (id, content) VALUES (?, ?)', [notepadId, '']);
    
    const passwordHash = await bcrypt.hash(password, 10);
    const altPasswordHash = await bcrypt.hash(altPassword, 10);

    const users = [
      { username: 'user1', hash: passwordHash, isAlt: isProduction ? false : 0 },
      { username: 'user2', hash: passwordHash, isAlt: isProduction ? false : 0 },
      { username: 'demo1', hash: altPasswordHash, isAlt: isProduction ? true : 1 },
      { username: 'demo2', hash: altPasswordHash, isAlt: isProduction ? true : 1 }
    ];

    for (const user of users) {
      await query(
        'INSERT INTO users (notepad_id, username, password_hash, is_alternate) VALUES (?, ?, ?, ?)',
        [notepadId, user.username, user.hash, user.isAlt]
      );
    }
    return { id: notepadId, users: users.map(u => u.username) };
  } catch (err) {
    throw err;
  }
}

// Get notepad by ID
async function getNotepad(notepadId) {
  const res = await query('SELECT * FROM notepads WHERE id = ?', [notepadId]);
  return res.rows[0];
}

// Update notepad content
async function updateNotepad(notepadId, content, editor) {
  // Use a hacky fix for UPDATE timestamp syntax differences if needed, but standard SQL usually works
  await query(
    'UPDATE notepads SET content = ?, updated_at = CURRENT_TIMESTAMP, last_editor = ? WHERE id = ?',
    [content, editor, notepadId]
  );
}

// Verify user credentials
async function verifyUser(notepadId, username, password) {
  const res = await query(
    'SELECT * FROM users WHERE notepad_id = ? AND username = ?',
    [notepadId, username]
  );
  
  const row = res.rows[0];
  if (!row) return { valid: false, isAlternate: false };

  const valid = await bcrypt.compare(password, row.password_hash);
  // Handle different boolean return types (Postgres returns boolean, SQLite returns 1/0)
  const isAlt = isProduction ? row.is_alternate : (row.is_alternate === 1);
  
  return { 
    valid, 
    isAlternate: isAlt,
    username: row.username 
  };
}

// Add feedback
async function addFeedback(notepadId, lineNumber, reaction, comment, username) {
  // Postgres requires RETURNING id for insert ID, SQLite uses this.lastID
  // We'll just execute standard INSERT and rely on wrapper for ID handling if essential, 
  // but for feedback ID isn't critical.
  await query(
    'INSERT INTO feedback (notepad_id, line_number, reaction, comment, username) VALUES (?, ?, ?, ?, ?)',
    [notepadId, lineNumber, reaction, comment, username]
  );
}

// Get feedback
async function getFeedback(notepadId) {
  const res = await query(
    'SELECT * FROM feedback WHERE notepad_id = ? ORDER BY line_number, created_at',
    [notepadId]
  );
  return res.rows;
}

// Add file metadata
async function addFile(notepadId, filename, filepath, mimetype, size) {
  await query(
    'INSERT INTO files (notepad_id, filename, filepath, mimetype, size) VALUES (?, ?, ?, ?, ?)',
    [notepadId, filename, filepath, mimetype, size]
  );
  // Note: we're not returning ID here to keep it simple across DBs
}

// Get files
async function getFiles(notepadId) {
  const res = await query(
    'SELECT * FROM files WHERE notepad_id = ? ORDER BY uploaded_at DESC',
    [notepadId]
  );
  return res.rows;
}

module.exports = {
  initializeDatabase,
  createNotepad,
  getNotepad,
  updateNotepad,
  verifyUser,
  addFeedback,
  getFeedback,
  addFile,
  getFiles
};
