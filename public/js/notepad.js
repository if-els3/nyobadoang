// Get notepad ID from URL
const notepadId = window.location.pathname.split('/').pop();

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.body.className = `${savedTheme}-theme notepad-page`;
}

function toggleTheme() {
  const currentTheme = document.body.classList.contains('light-theme') ? 'light' : 'dark';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.body.className = `${newTheme}-theme notepad-page`;
  localStorage.setItem('theme', newTheme);
}

initTheme();

// DOM Elements
const authModal = document.getElementById('authModal');
const authForm = document.getElementById('authForm');
const authError = document.getElementById('authError');
const notepadContainer = document.getElementById('notepadContainer');
const editor = document.getElementById('editor');
const themeToggle = document.getElementById('themeToggle');
const lineNumbers = document.getElementById('lineNumbers');
const wordCount = document.getElementById('wordCount');
const charCount = document.getElementById('charCount');
const lineCount = document.getElementById('lineCount');
const userCount = document.getElementById('userCount');
const timestamp = document.getElementById('timestamp');
const uploadedFiles = document.getElementById('uploadedFiles');

// Socket.IO connection
let socket;
let currentUsername = '';
let isAuthenticated = false;
let isBlankMode = false;

// Authentication
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  try {
    const response = await fetch(`/api/notepad/${notepadId}/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (data.success) {
      if (data.blank) {
        // Wrong password - show blank notepad
        isBlankMode = true;
        showNotepad();
        authModal.classList.remove('active');
      } else {
        // Correct credentials
        currentUsername = data.username;
        isAuthenticated = true;
        isBlankMode = false;
        showNotepad();
        authModal.classList.remove('active');
        initializeSocket();
        loadNotepad();
      }
    } else {
      authError.textContent = 'Authentication failed. Please try again.';
      authError.classList.add('active');
    }
  } catch (error) {
    console.error('Auth error:', error);
    authError.textContent = 'Connection error. Please try again.';
    authError.classList.add('active');
  }
});

function showNotepad() {
  notepadContainer.style.display = 'flex';
  if (isBlankMode) {
    editor.contentEditable = 'false';
    editor.innerHTML = '';
    editor.setAttribute('data-placeholder', 'This notepad is locked. Wrong password provided.');
  }
}

// Initialize Socket.IO
function initializeSocket() {
  socket = io();

  socket.emit('join-notepad', notepadId);

  socket.on('active-users', (count) => {
    userCount.textContent = count;
  });

  socket.on('content-update', (data) => {
    if (data.editor !== currentUsername) {
      editor.innerHTML = escapeHtml(data.content);
      updateStats();
      updateLineNumbers();
      updateTimestamp(data.timestamp);
    }
  });

  socket.on('feedback-added', (feedback) => {
    displayFeedback(feedback);
  });
}

// Load notepad content
async function loadNotepad() {
  try {
    const response = await fetch(`/api/notepad/${notepadId}`);
    const data = await response.json();

    if (data.success) {
      editor.innerHTML = escapeHtml(data.notepad.content);
      updateStats();
      updateLineNumbers();
      
      if (data.notepad.updated_at) {
        updateTimestamp(data.notepad.updated_at);
      }

      // Load feedback
      data.feedback.forEach(displayFeedback);

      // Load files
      data.files.forEach(displayFile);
    }
  } catch (error) {
    console.error('Error loading notepad:', error);
  }
}

// Editor input handler with debounce
let saveTimeout;
editor.addEventListener('input', () => {
  updateStats();
  updateLineNumbers();

  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveContent();
  }, 1000); // Save after 1 second of no typing
});

// Save content with status indicator
function saveContent() {
  const content = editor.innerHTML; // Use innerHTML to preserve media elements
  
  // Show saving status
  showSaveStatus('saving');

  if (socket && !isBlankMode) {
    socket.emit('content-change', {
      notepadId,
      content,
      username: currentUsername
    }, (response) => {
      // Show saved status on acknowledgment
      if (response && response.success) {
        showSaveStatus('saved');
      } else {
        showSaveStatus('error');
      }
    });
  }
}

// Show save status indicator
function showSaveStatus(status) {
  const statusEl = document.getElementById('saveStatus') || createSaveStatusElement();
  
  if (status === 'saving') {
    statusEl.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="spinning">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 6v6l4 2"/>
      </svg>
      Saving...
    `;
    statusEl.className = 'save-status saving';
  } else if (status === 'saved') {
    statusEl.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
      </svg>
      Saved ✓
    `;
    statusEl.className = 'save-status saved';
    
    // Hide after 2 seconds
    setTimeout(() => {
      statusEl.className = 'save-status hidden';
    }, 2000);
  } else if (status === 'error') {
    statusEl.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
      </svg>
      Failed ✗
    `;
    statusEl.className = 'save-status error';
  }
}

function createSaveStatusElement() {
  const statusEl = document.createElement('div');
  statusEl.id = 'saveStatus';
  statusEl.className = 'save-status hidden';
  document.querySelector('.notepad-footer').appendChild(statusEl);
  return statusEl;
}

// Update statistics
function updateStats() {
  const text = editor.innerText;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  const lines = text.split('\n').length;

  wordCount.textContent = words;
  charCount.textContent = chars;
  lineCount.textContent = lines;
}

// Update line numbers
function updateLineNumbers() {
  const text = editor.innerText;
  const lines = text.split('\n').length;
  
  let lineNumbersHtml = '';
  for (let i = 1; i <= lines; i++) {
    lineNumbersHtml += `${i}\n`;
  }
  
  lineNumbers.textContent = lineNumbersHtml;
}

// Update timestamp - Full date/time format
function updateTimestamp(isoString) {
  const date = new Date(isoString);
  
  // Format: "Jan 27, 2026, 10:54 AM"
  const options = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  
  const formatted = date.toLocaleDateString('en-US', options);
  timestamp.textContent = formatted;
}

// File Upload Handlers
document.getElementById('uploadTxtBtn').addEventListener('click', () => {
  document.getElementById('txtFileInput').click();
});

document.getElementById('uploadFileBtn').addEventListener('click', () => {
  document.getElementById('fileInput').click();
});

document.getElementById('txtFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('notepadId', notepadId);

  try {
    const response = await fetch('/api/upload/txt', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.success) {
      editor.innerText = data.content;
      updateStats();
      updateLineNumbers();
      saveContent();
    }
  } catch (error) {
    console.error('Upload error:', error);
    alert('Failed to upload file');
  }

  e.target.value = ''; // Reset input
});

document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('notepadId', notepadId);

  try {
    const response = await fetch('/api/upload/file', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.success) {
      displayFile(data.file);
      
      // If it's an image, insert into editor
      if (data.file.mimetype.startsWith('image/')) {
        const imgTag = `\n![${data.file.filename}](${data.file.url})\n`;
        editor.innerText += imgTag;
        saveContent();
      }
    }
  } catch (error) {
    console.error('Upload error:', error);
    alert('Failed to upload file');
  }

  e.target.value = ''; // Reset input
});

// Display uploaded file
function displayFile(file) {
  const fileChip = document.createElement('div');
  fileChip.className = 'file-chip';
  fileChip.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
      <path fill-rule="evenodd" d="M8 4a3 3 0 00-3 3v4a5 5 0 0010 0V7a1 1 0 112 0v4a7 7 0 11-14 0V7a5 5 0 0110 0v4a3 3 0 11-6 0V7a1 1 0 012 0v4a1 1 0 102 0V7a3 3 0 00-3-3z" clip-rule="evenodd"/>
    </svg>
    <span>${file.filename}</span>
  `;
  
  fileChip.addEventListener('click', () => {
    window.open(file.url, '_blank');
  });
  
  uploadedFiles.appendChild(fileChip);
}

// Export handlers
document.getElementById('exportRawBtn').addEventListener('click', () => {
  window.open(`/api/notepad/${notepadId}/export/raw`, '_blank');
});

document.getElementById('exportMdBtn').addEventListener('click', () => {
  window.location.href = `/api/notepad/${notepadId}/export/markdown`;
});

document.getElementById('exportCodeBtn').addEventListener('click', () => {
  window.location.href = `/api/notepad/${notepadId}/export/code`;
});

// Feedback System
const feedbackModal = document.getElementById('feedbackModal');
const feedbackLineNum = document.getElementById('feedbackLineNum');
const feedbackComment = document.getElementById('feedbackComment');
const closeFeedbackBtn = document.getElementById('closeFeedbackBtn');
const submitFeedbackBtn = document.getElementById('submitFeedbackBtn');

let currentFeedbackLine = 0;
let selectedReaction = '';

// Add feedback buttons to lines (on hover)
editor.addEventListener('mouseover', (e) => {
  if (isBlankMode) return;
  
  // This is a simplified version - you could enhance this
  // by adding feedback icons that appear on hover
});

// Double-click on a line to add feedback
editor.addEventListener('dblclick', (e) => {
  if (isBlankMode) return;
  
  const selection = window.getSelection();
  const range = selection.getRangeAt(0);
  const textBeforeSelection = editor.innerText.substring(0, range.startOffset);
  const lineNumber = textBeforeSelection.split('\n').length;
  
  openFeedbackModal(lineNumber);
});

function openFeedbackModal(lineNumber) {
  currentFeedbackLine = lineNumber;
  feedbackLineNum.textContent = lineNumber;
  feedbackComment.value = '';
  selectedReaction = '';
  
  document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.classList.remove('selected');
  });
  
  feedbackModal.classList.add('active');
}

// Reaction selection
document.querySelectorAll('.reaction-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.reaction-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedReaction = btn.dataset.reaction;
  });
});

closeFeedbackBtn.addEventListener('click', () => {
  feedbackModal.classList.remove('active');
});

submitFeedbackBtn.addEventListener('click', async () => {
  if (!selectedReaction && !feedbackComment.value.trim()) {
    alert('Please select a reaction or add a comment');
    return;
  }

  try {
    const response = await fetch(`/api/notepad/${notepadId}/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        lineNumber: currentFeedbackLine,
        reaction: selectedReaction,
        comment: feedbackComment.value.trim()
      })
    });

    const data = await response.json();

    if (data.success) {
      feedbackModal.classList.remove('active');
    }
  } catch (error) {
    console.error('Feedback error:', error);
    alert('Failed to add feedback');
  }
});

// Display feedback
function displayFeedback(feedback) {
  // This is a simplified version
  // In a full implementation, you'd position feedback indicators next to the appropriate lines
  console.log('Feedback received:', feedback);
}

// Theme toggle
if (themeToggle) {
  themeToggle.addEventListener('click', toggleTheme);
}

// Utility function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Close modals on outside click
feedbackModal.addEventListener('click', (e) => {
  if (e.target === feedbackModal) {
    feedbackModal.classList.remove('active');
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + S to save
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveContent();
  }
  
  // Ctrl/Cmd + / for feedback
  if ((e.ctrlKey || e.metaKey) && e.key === '/') {
    e.preventDefault();
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const textBeforeSelection = editor.innerText.substring(0, range.startOffset);
      const lineNumber = textBeforeSelection.split('\n').length;
      openFeedbackModal(lineNumber);
    }
  }
});

// Initialize stats and line numbers
updateStats();
updateLineNumbers();

// ==================== ENHANCED FEATURES ====================

// Screenshot Paste Handler
editor.addEventListener('paste', async (e) => {
  const items = e.clipboardData.items;
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    
    // Handle pasted images (screenshots)
    if (item.type.indexOf('image') !== -1) {
      e.preventDefault();
      const blob = item.getAsFile();
      
      // Upload the screenshot
      const formData = new FormData();
      formData.append('file', blob, `screenshot-${Date.now()}.png`);
      formData.append('notepadId', notepadId);
      
      try {
        showSaveStatus('saving');
        const response = await fetch('/api/upload/file', {
          method: 'POST',
          body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
          // Insert image directly into editor
          const img = document.createElement('img');
          img.src = data.file.url;
          img.style.maxWidth = '100%';
          img.style.display = 'block';
          img.style.margin = '10px 0';
          img.alt = data.file.filename;
          
          // Insert at cursor position
          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(img);
            range.collapse(false);
          } else {
            editor.appendChild(img);
          }
          
          saveContent();
          showSaveStatus('saved');
        }
      } catch (error) {
        console.error('Screenshot upload error:', error);
        showSaveStatus('error');
      }
    }
    
    // Handle pasted URLs - auto-detect and embed media
    if (item.type === 'text/plain') {
      item.getAsString(async (text) => {
        if (isMediaURL(text)) {
          e.preventDefault();
          insertMediaElement(text);
        }
      });
    }
  }
});

// Check if URL is a media link
function isMediaURL(url) {
  const videoFormats = /\.(mp4|webm|ogg|mov)$/i;
  const audioFormats = /\.(mp3|wav|ogg|m4a)$/i;
  const imageFormats = /\.(jpg|jpeg|png|gif|webp|svg)$/i;
  const youtubeRegex = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/;
  
  return videoFormats.test(url) || audioFormats.test(url) || 
         imageFormats.test(url) || youtubeRegex.test(url);
}

// Insert media element based on URL type
function insertMediaElement(url) {
  let mediaEl;
  
  // Image
  if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url)) {
    mediaEl = document.createElement('img');
    mediaEl.src = url;
    mediaEl.style.maxWidth = '100%';
    mediaEl.style.display = 'block';
    mediaEl.style.margin = '10px 0';
    mediaEl.alt = 'Pasted image';
  }
  
  // Video
  else if (/\.(mp4|webm|ogg|mov)$/i.test(url)) {
    mediaEl = document.createElement('video');
    mediaEl.src = url;
    mediaEl.controls = true;
    mediaEl.style.maxWidth = '100%';
    mediaEl.style.display = 'block';
    mediaEl.style.margin = '10px 0';
  }
  
  // Audio
  else if (/\.(mp3|wav|ogg|m4a)$/i.test(url)) {
    mediaEl = document.createElement('audio');
    mediaEl.src = url;
    mediaEl.controls = true;
    mediaEl.style.display = 'block';
    mediaEl.style.margin = '10px 0';
  }
  
  // YouTube
  else if (/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/.test(url)) {
    const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)[1];
    mediaEl = document.createElement('iframe');
    mediaEl.src = `https://www.youtube.com/embed/${videoId}`;
    mediaEl.width = '560';
    mediaEl.height = '315';
    mediaEl.frameBorder = '0';
    mediaEl.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    mediaEl.allowFullscreen = true;
    mediaEl.style.display = 'block';
    mediaEl.style.margin = '10px 0';
  }
  
  if (mediaEl) {
    // Insert at cursor position
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(mediaEl);
      
      // Add line break after media
      const br = document.createElement('br');
      mediaEl.after(br);
      range.setStartAfter(br);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      editor.appendChild(mediaEl);
    }
    
    saveContent();
  }
}

// Voice Note Recorder
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

// Add voice recorder button to toolbar
function addVoiceRecorderButton() {
  const voiceBtn = document.createElement('button');
  voiceBtn.className = 'toolbar-btn';
  voiceBtn.id = 'voiceRecordBtn';
  voiceBtn.title = 'Record voice note';
  voiceBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      <path fill-rule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clip-rule="evenodd"/>
    </svg>
    Record Voice
  `;
  
  voiceBtn.addEventListener('click', toggleVoiceRecording);
  
  const toolbar = document.querySelector('.toolbar-group');
  toolbar.insertBefore(voiceBtn, toolbar.firstChild);
}

async function toggleVoiceRecording() {
  const voiceBtn = document.getElementById('voiceRecordBtn');
  
  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      
      mediaRecorder.addEventListener('dataavailable', (event) => {
        audioChunks.push(event.data);
      });
      
      mediaRecorder.addEventListener('stop', async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        
        // Upload voice note
        const formData = new FormData();
        formData.append('file', audioBlob, `voice-${Date.now()}.webm`);
        formData.append('notepadId', notepadId);
        
        try {
          showSaveStatus('saving');
          const response = await fetch('/api/upload/file', {
            method: 'POST',
            body: formData
          });
          
          const data = await response.json();
          
          if (data.success) {
            // Insert audio player
            const audio = document.createElement('audio');
            audio.src = data.file.url;
            audio.controls = true;
            audio.style.display = 'block';
            audio.style.margin = '10px 0';
            
            editor.appendChild(audio);
            editor.appendChild(document.createElement('br'));
            
            saveContent();
            showSaveStatus('saved');
          }
        } catch (error) {
          console.error('Voice note upload error:', error);
          showSaveStatus('error');
        }
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      });
      
      mediaRecorder.start();
      isRecording = true;
      
      voiceBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 20 20" fill="red">
          <rect x="6" y="6" width="8" height="8" rx="1"/>
        </svg>
        Stop Recording
      `;
      voiceBtn.style.background = 'rgba(239, 68, 68, 0.1)';
    } catch (error) {
      console.error('Microphone access error:', error);
      alert('Could not access microphone. Please grant permission.');
    }
  } else {
    mediaRecorder.stop();
    isRecording = false;
    
    voiceBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clip-rule="evenodd"/>
      </svg>
      Record Voice
    `;
    voiceBtn.style.background = '';
  }
}

// Initialize voice recorder button
if (document.querySelector('.toolbar')) {
  addVoiceRecorderButton();
}

