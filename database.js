const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const DB_PATH = path.join(__dirname, 'notepad.db');
const db = new sqlite3.Database(DB_PATH);

// Initialize database tables
function initializeDatabase() {
  db.serialize(() => {
    // Notepads table
    db.run(`
      CREATE TABLE IF NOT EXISTS notepads (
        id TEXT PRIMARY KEY,
        content TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_editor TEXT
      )
    `);

    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notepad_id TEXT,
        username TEXT,
        password_hash TEXT,
        is_alternate BOOLEAN DEFAULT 0,
        FOREIGN KEY (notepad_id) REFERENCES notepads(id),
        UNIQUE(notepad_id, username)
      )
    `);

    // Feedback table
    db.run(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notepad_id TEXT,
        line_number INTEGER,
        reaction TEXT,
        comment TEXT,
        username TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (notepad_id) REFERENCES notepads(id)
      )
    `);

    // Files table
    db.run(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notepad_id TEXT,
        filename TEXT,
        filepath TEXT,
        mimetype TEXT,
        size INTEGER,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (notepad_id) REFERENCES notepads(id)
      )
    `);

    console.log('Database initialized successfully');
    
    // Initialize main notepad with fixed credentials if it doesn't exist
    initializeMainNotepad();
  });
}

// Initialize the main notepad with fixed credentials
async function initializeMainNotepad() {
  try {
    // Check if main notepad already exists
    const existing = await getNotepad('main');
    if (existing) {
      console.log('Main notepad already exists');
      return;
    }

    // Create main notepad
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO notepads (id, content) VALUES (?, ?)',
        ['main', ''],
        (err) => (err ? reject(err) : resolve())
      );
    });

    // Hash passwords
    const mainPasswordHash = await bcrypt.hash('idk', 10);
    const separatePasswordHash = await bcrypt.hash('tes', 10);

    // Create fixed users for main notepad
    const users = [
      { username: 'sabs', hash: mainPasswordHash, isAlt: 0 },
      { username: 'separate', hash: separatePasswordHash, isAlt: 1 }
    ];

    for (const user of users) {
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO users (notepad_id, username, password_hash, is_alternate) VALUES (?, ?, ?, ?)',
          ['main', user.username, user.hash, user.isAlt],
          (err) => (err ? reject(err) : resolve())
        );
      });
    }

    console.log('Main notepad initialized with fixed credentials');
  } catch (err) {
    console.error('Error initializing main notepad:', err);
  }
}

// Create a new notepad with 4 default users
async function createNotepad(notepadId, password, altPassword) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO notepads (id, content) VALUES (?, ?)',
      [notepadId, ''],
      async (err) => {
        if (err) return reject(err);

        try {
          const passwordHash = await bcrypt.hash(password, 10);
          const altPasswordHash = await bcrypt.hash(altPassword, 10);

          // Create 4 default users
          const users = [
            { username: 'user1', hash: passwordHash, isAlt: 0 },
            { username: 'user2', hash: passwordHash, isAlt: 0 },
            { username: 'demo1', hash: altPasswordHash, isAlt: 1 },
            { username: 'demo2', hash: altPasswordHash, isAlt: 1 }
          ];

          for (const user of users) {
            await new Promise((res, rej) => {
              db.run(
                'INSERT INTO users (notepad_id, username, password_hash, is_alternate) VALUES (?, ?, ?, ?)',
                [notepadId, user.username, user.hash, user.isAlt],
                (err) => (err ? rej(err) : res())
              );
            });
          }

          resolve({ id: notepadId, users: users.map(u => u.username) });
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

// Get notepad by ID
function getNotepad(notepadId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM notepads WHERE id = ?', [notepadId], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

// Update notepad content
function updateNotepad(notepadId, content, editor) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE notepads SET content = ?, updated_at = CURRENT_TIMESTAMP, last_editor = ? WHERE id = ?',
      [content, editor, notepadId],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

// Verify user credentials
async function verifyUser(notepadId, username, password) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM users WHERE notepad_id = ? AND username = ?',
      [notepadId, username],
      async (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve({ valid: false, isAlternate: false });

        const valid = await bcrypt.compare(password, row.password_hash);
        resolve({ 
          valid, 
          isAlternate: row.is_alternate === 1,
          username: row.username 
        });
      }
    );
  });
}

// Add feedback to a line
function addFeedback(notepadId, lineNumber, reaction, comment, username) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO feedback (notepad_id, line_number, reaction, comment, username) VALUES (?, ?, ?, ?, ?)',
      [notepadId, lineNumber, reaction, comment, username],
      function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID });
      }
    );
  });
}

// Get feedback for a notepad
function getFeedback(notepadId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM feedback WHERE notepad_id = ? ORDER BY line_number, created_at',
      [notepadId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });
}

// Add file metadata
function addFile(notepadId, filename, filepath, mimetype, size) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO files (notepad_id, filename, filepath, mimetype, size) VALUES (?, ?, ?, ?, ?)',
      [notepadId, filename, filepath, mimetype, size],
      function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID });
      }
    );
  });
}

// Get files for a notepad
function getFiles(notepadId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM files WHERE notepad_id = ? ORDER BY uploaded_at DESC',
      [notepadId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });
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
  getFiles,
  db
};
