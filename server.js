const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const { nanoid } = require('nanoid');
const multer = require('multer');
const fs = require('fs');

const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 3000;

// Initialize database
db.initializeDatabase();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

app.use(session({
  secret: 'collaborative-notepad-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${nanoid(10)}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Store active connections per notepad
const activeUsers = {};

// API Routes

// Create new notepad
app.post('/api/notepad/create', async (req, res) => {
  try {
    const { password, altPassword } = req.body;
    const notepadId = nanoid(10);
    
    const result = await db.createNotepad(notepadId, password, altPassword || password + '-alt');
    
    res.json({ 
      success: true, 
      notepadId, 
      users: result.users,
      url: `/notepad/${notepadId}` 
    });
  } catch (error) {
    console.error('Error creating notepad:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Authenticate user
app.post('/api/notepad/:id/auth', async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password } = req.body;

    const notepad = await db.getNotepad(id);
    if (!notepad) {
      return res.status(404).json({ success: false, error: 'Notepad not found' });
    }

    const result = await db.verifyUser(id, username, password);
    
    if (result.valid) {
      req.session.notepadId = id;
      req.session.username = username;
      req.session.isAlternate = result.isAlternate;
      
      res.json({ 
        success: true, 
        isAlternate: result.isAlternate,
        username: result.username
      });
    } else {
      // Wrong password - return success but with blank flag
      res.json({ 
        success: true, 
        blank: true 
      });
    }
  } catch (error) {
    console.error('Error authenticating:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get notepad content
app.get('/api/notepad/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const notepad = await db.getNotepad(id);
    
    if (!notepad) {
      return res.status(404).json({ success: false, error: 'Notepad not found' });
    }

    const feedback = await db.getFeedback(id);
    const files = await db.getFiles(id);

    res.json({ 
      success: true, 
      notepad,
      feedback,
      files
    });
  } catch (error) {
    console.error('Error getting notepad:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export notepad in different formats
app.get('/api/notepad/:id/export/:format', async (req, res) => {
  try {
    const { id, format } = req.params;
    const notepad = await db.getNotepad(id);
    
    if (!notepad) {
      return res.status(404).json({ success: false, error: 'Notepad not found' });
    }

    const content = notepad.content;

    switch (format) {
      case 'raw':
        res.setHeader('Content-Type', 'text/plain');
        res.send(content);
        break;
      case 'markdown':
        res.setHeader('Content-Type', 'text/markdown');
        res.setHeader('Content-Disposition', `attachment; filename="notepad-${id}.md"`);
        res.send(content);
        break;
      case 'code':
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="notepad-${id}.txt"`);
        res.send('```\n' + content + '\n```');
        break;
      default:
        res.status(400).json({ success: false, error: 'Invalid format' });
    }
  } catch (error) {
    console.error('Error exporting notepad:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add feedback
app.post('/api/notepad/:id/feedback', async (req, res) => {
  try {
    const { id } = req.params;
    const { lineNumber, reaction, comment } = req.body;
    const username = req.session.username || 'Anonymous';

    const result = await db.addFeedback(id, lineNumber, reaction, comment, username);
    
    // Broadcast to all connected clients
    io.to(id).emit('feedback-added', {
      id: result.id,
      lineNumber,
      reaction,
      comment,
      username,
      created_at: new Date().toISOString()
    });

    res.json({ success: true, feedbackId: result.id });
  } catch (error) {
    console.error('Error adding feedback:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload text file
app.post('/api/upload/txt', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const content = fs.readFileSync(req.file.path, 'utf-8');
    const notepadId = req.body.notepadId;

    if (notepadId) {
      await db.addFile(notepadId, req.file.originalname, req.file.path, req.file.mimetype, req.file.size);
    }

    res.json({ 
      success: true, 
      content,
      filename: req.file.originalname
    });
  } catch (error) {
    console.error('Error uploading text file:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload any file (image, etc.)
app.post('/api/upload/file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const notepadId = req.body.notepadId;
    
    if (notepadId) {
      await db.addFile(notepadId, req.file.originalname, req.file.path, req.file.mimetype, req.file.size);
    }

    res.json({ 
      success: true,
      file: {
        filename: req.file.originalname,
        url: `/uploads/${req.file.filename}`,
        mimetype: req.file.mimetype,
        size: req.file.size
      }
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve notepad page
app.get('/notepad/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'notepad.html'));
});

// Socket.IO for real-time collaboration
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-notepad', (notepadId) => {
    socket.join(notepadId);
    
    if (!activeUsers[notepadId]) {
      activeUsers[notepadId] = new Set();
    }
    activeUsers[notepadId].add(socket.id);

    // Broadcast active user count
    io.to(notepadId).emit('active-users', activeUsers[notepadId].size);
    
    console.log(`User ${socket.id} joined notepad ${notepadId}`);
  });

  socket.on('content-change', async (data) => {
    const { notepadId, content, username } = data;
    
    try {
      await db.updateNotepad(notepadId, content, username);
      
      // Broadcast to all other users in the same notepad
      socket.to(notepadId).emit('content-update', {
        content,
        editor: username,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error updating content:', error);
    }
  });

  socket.on('cursor-position', (data) => {
    const { notepadId, position, username } = data;
    socket.to(notepadId).emit('cursor-update', { position, username });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Remove from all notepads
    for (const notepadId in activeUsers) {
      if (activeUsers[notepadId].has(socket.id)) {
        activeUsers[notepadId].delete(socket.id);
        io.to(notepadId).emit('active-users', activeUsers[notepadId].size);
        
        if (activeUsers[notepadId].size === 0) {
          delete activeUsers[notepadId];
        }
      }
    }
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
