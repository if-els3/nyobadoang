// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.body.className = `${savedTheme}-theme`;
}

function toggleTheme() {
  const currentTheme = document.body.classList.contains('light-theme') ? 'light' : 'dark';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.body.className = `${newTheme}-theme`;
  localStorage.setItem('theme', newTheme);
}

// Initialize theme on load
initTheme();

// Theme toggle button
const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
  themeToggle.addEventListener('click', toggleTheme);
}

// Create Notepad Form
const createForm = document.getElementById('createForm');
const successModal = document.getElementById('successModal');
const copyUrlBtn = document.getElementById('copyUrlBtn');
const goToNotepadBtn = document.getElementById('goToNotepad');

let createdNotepadUrl = '';

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const mainPassword = document.getElementById('mainPassword').value;
  const altPassword = document.getElementById('altPassword').value;

  try {
    const response = await fetch('/api/notepad/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        password: mainPassword,
        altPassword: altPassword
      })
    });

    const data = await response.json();

    if (data.success) {
      // Show success modal
      createdNotepadUrl = window.location.origin + data.url;
      document.getElementById('notepadUrl').value = createdNotepadUrl;
      document.getElementById('mainPassDisplay').textContent = mainPassword;
      document.getElementById('altPassDisplay').textContent = altPassword;
      
      successModal.classList.add('active');
      
      // Reset form
      createForm.reset();
    } else {
      alert('Error creating notepad: ' + data.error);
    }
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to create notepad. Please try again.');
  }
});

// Copy URL button
copyUrlBtn.addEventListener('click', async () => {
  const urlInput = document.getElementById('notepadUrl');
  
  try {
    await navigator.clipboard.writeText(urlInput.value);
    
    // Visual feedback
    const originalText = copyUrlBtn.innerHTML;
    copyUrlBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
      </svg>
      Copied!
    `;
    
    setTimeout(() => {
      copyUrlBtn.innerHTML = originalText;
    }, 2000);
  } catch (error) {
    // Fallback for older browsers
    urlInput.select();
    document.execCommand('copy');
    alert('URL copied to clipboard!');
  }
});

// Go to notepad button
goToNotepadBtn.addEventListener('click', () => {
  window.location.href = createdNotepadUrl;
});

// Close modal on outside click
successModal.addEventListener('click', (e) => {
  if (e.target === successModal) {
    successModal.classList.remove('active');
  }
});
