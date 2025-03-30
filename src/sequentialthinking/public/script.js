// Connect to the Socket.io server
const socket = io();

// DOM elements
const thoughtContainer = document.getElementById('thought-container');
const totalThoughtsElement = document.getElementById('total-thoughts');
const totalBranchesElement = document.getElementById('total-branches');

// Store current state
let thoughts = [];
let branches = {};

// Initialize the UI
socket.on('init', (data) => {
  // Remove loading message
  thoughtContainer.innerHTML = '';
  
  // Store data
  thoughts = data.thoughts;
  branches = data.branches;
  
  // Render thoughts
  renderThoughts();
  updateStats();
});

// Update when new thoughts arrive
socket.on('update', (data) => {
  thoughts = data.thoughts;
  branches = data.branches;
  
  renderThoughts();
  updateStats();
});

// Render all thoughts
function renderThoughts() {
  // Clear container
  thoughtContainer.innerHTML = '';
  
  // Render each thought
  thoughts.forEach((thought, index) => {
    const thoughtCard = createThoughtCard(thought, index === 0);
    thoughtContainer.appendChild(thoughtCard);
  });
}

// Create a thought card element
function createThoughtCard(thought, isFirst) {
  const card = document.createElement('div');
  card.className = `thought-card ${isFirst ? 'first-thought' : ''}`;
  
  // Determine type of thought
  if (thought.isRevision) {
    card.classList.add('revision');
  } else if (thought.branchFromThought) {
    card.classList.add('branch');
  } else {
    card.classList.add('main-thought');
  }
  
  // Create header with thought number and type
  const header = document.createElement('div');
  header.className = 'thought-header';
  
  const thoughtNumber = document.createElement('div');
  thoughtNumber.className = 'thought-number';
  thoughtNumber.textContent = `Thought ${thought.thoughtNumber}/${thought.totalThoughts}`;
  
  const thoughtType = document.createElement('div');
  thoughtType.className = 'thought-type';
  
  if (thought.isRevision) {
    thoughtType.textContent = 'Revision';
    thoughtType.classList.add('revision');
  } else if (thought.branchFromThought) {
    thoughtType.textContent = 'Branch';
    thoughtType.classList.add('branch');
  } else {
    thoughtType.textContent = 'Main';
    thoughtType.classList.add('main');
  }
  
  header.appendChild(thoughtNumber);
  header.appendChild(thoughtType);
  
  // Create body with thought content
  const body = document.createElement('div');
  body.className = 'thought-body';
  body.textContent = thought.thought;
  
  // Add metadata if available
  const meta = document.createElement('div');
  meta.className = 'thought-meta';
  
  if (thought.isRevision && thought.revisesThought) {
    meta.textContent = `Revises thought #${thought.revisesThought}`;
  } else if (thought.branchFromThought) {
    meta.textContent = `Branches from thought #${thought.branchFromThought}`;
    if (thought.branchId) {
      meta.textContent += ` (Branch ID: ${thought.branchId})`;
    }
  }
  
  // Add continuation status
  if (!thought.nextThoughtNeeded) {
    meta.textContent += meta.textContent ? ' • ' : '';
    meta.textContent += 'Final thought';
  }
  
  // Assemble card
  card.appendChild(header);
  card.appendChild(body);
  
  if (meta.textContent) {
    card.appendChild(meta);
  }
  
  return card;
}

// Update statistics
function updateStats() {
  totalThoughtsElement.textContent = thoughts.length;
  totalBranchesElement.textContent = Object.keys(branches).length;
}

// Handle connection status
socket.on('connect', () => {
  console.log('Connected to the server');
});

socket.on('disconnect', () => {
  console.log('Disconnected from the server');
  
  // Show reconnection message
  thoughtContainer.innerHTML = '<div class="loading">Connection lost. Reconnecting...</div>';
});