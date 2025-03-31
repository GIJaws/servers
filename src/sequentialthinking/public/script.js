// Connect to the Socket.io server
const socket = io();

// DOM elements
const thoughtContainer = document.getElementById('thought-container');
const totalThoughtsElement = document.getElementById('total-thoughts');
const totalBranchesElement = document.getElementById('total-branches');

// Vis.js Datasets and Network instance
let network = null;
const nodes = new vis.DataSet([]);
const edges = new vis.DataSet([]);

// Initialize vis.js network on page load
function initializeNetwork() {
  if (network) return; // Already initialized

  console.log('Initializing vis.js network...');
  const data = { nodes, edges };
  const options = {
    layout: {
      hierarchical: {
        enabled: true,
        direction: "UD", // Up-Down layout
        sortMethod: "directed", // Sort based on edge direction
        shakeTowards: "roots", // Arrange nodes starting from the root(s)
        levelSeparation: 150, // Increase vertical distance between levels
        nodeSpacing: 150, // Increase horizontal distance between nodes
      }
    },
    edges: {
      smooth: {
          enabled: true,
          type: 'cubicBezier', // Smoother curves
          forceDirection: 'vertical', // Prefer vertical curve for hierarchical
          roundness: 0.5
      },
      arrows: 'to',
      color: {
          color: '#848484', // Default edge color
          highlight: '#848484',
          hover: '#848484',
      }
    },
    nodes: {
        shape: 'box', // Box shape for nodes
        margin: 10, // Padding inside the node
        widthConstraint: {
            maximum: 250 // Max width before text wraps
        },
        font: {
            size: 12, // Font size
            face: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif'
        },
        borderWidth: 1,
    },
    groups: {
        // Define appearance for different node groups
        main: { color: { background: '#e7f0ff', border: '#4e7ae2'}, font: { color: '#333'} },
        revision: { color: { background: '#fff8e1', border: '#ffc107'}, font: { color: '#333'} },
        branch: { color: { background: '#d4edda', border: '#28a745'}, font: { color: '#333'} }
    },
    physics: {
        enabled: true, // Keep physics enabled for hierarchical layout adjustments
        hierarchicalRepulsion: {
            centralGravity: 0.0,
            springLength: 100,
            springConstant: 0.01,
            nodeDistance: 150, // Controls spacing in hierarchical layout
            damping: 0.09
        },
        maxVelocity: 50,
        minVelocity: 0.1,
        solver: 'hierarchicalRepulsion', // Use solver suitable for hierarchical layout
        timestep: 0.5,
        stabilization: { enabled: true, iterations: 1000 } // Stabilize layout
    },
    interaction: {
        dragNodes: true,
        dragView: true,
        hover: true,
        zoomView: true,
        tooltipDelay: 300, // Show tooltips quicker
    }
  };
  network = new vis.Network(thoughtContainer, data, options);
  console.log('vis.js network initialized.');

    // Optional: Fit the view after stabilization
    network.once("stabilizationIterationsDone", function () {
        console.log("Layout stabilized, fitting view.");
        network.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
    });
}

// Update statistics display
function updateStats() {
  const nodeCount = nodes.length;
  // Estimate branches by counting unique sources of green edges (branch starts)
  const branchEdges = edges.get({ filter: (edge) => edge.color?.color === '#28a745' });
  const branchStartNodes = new Set(branchEdges.map(edge => edge.from));
  const branchCount = branchStartNodes.size;

  totalThoughtsElement.textContent = nodeCount;
  totalBranchesElement.textContent = branchCount;
}

// --- Socket Event Handlers ---

socket.on('connect', () => {
  console.log('Connected to the server');
  thoughtContainer.innerHTML = '<div class="loading">Connected. Waiting for thoughts...</div>'; // Clear any previous error
});

socket.on('disconnect', () => {
  console.error('Disconnected from the server');
  thoughtContainer.innerHTML = '<div class="loading error">Connection lost. Attempting to reconnect...</div>';
});

socket.on('init', (data) => {
  console.log('Received initial graph state:', data);
  if (!network) {
    initializeNetwork(); // Ensure network is initialized
  }

  // Clear existing data
  nodes.clear();
  edges.clear();

  // Add initial data
  if (data.nodes && data.nodes.length > 0) {
     thoughtContainer.innerHTML = ''; // Clear loading message
     nodes.add(data.nodes);
  } else {
      thoughtContainer.innerHTML = '<div class="loading">No thoughts yet. Start the process!</div>';
  }
  if (data.edges) {
    edges.add(data.edges);
  }

  updateStats();
  // No need to call fit here, stabilization event will handle it if physics are enabled
  // If physics are disabled, you might call network.fit() here.
});

socket.on('thoughtAdded', (data) => {
  console.log('Received thought update:', data);
   if (thoughtContainer.querySelector('.loading')) {
       thoughtContainer.innerHTML = ''; // Clear loading/placeholder message
   }
  if (!network) {
    console.warn('Network not initialized yet, skipping update.');
    return; // Should ideally not happen if init is received first
  }

  if (data.newNode) {
    // Check if node already exists (e.g., due to reconnection race condition)
    if (!nodes.get(data.newNode.id)) {
      nodes.add(data.newNode);
    } else {
      console.warn(`Node ${data.newNode.id} already exists, updating instead.`);
      nodes.update(data.newNode); // Or just ignore if update isn't needed
    }
  }
  if (data.newEdges && data.newEdges.length > 0) {
      const edgesToAdd = data.newEdges.filter(edge => !edges.get(edge.id)); // Prevent duplicates based on ID
      if (edgesToAdd.length > 0) {
          edges.add(edgesToAdd);
      }
  }
  updateStats();
});

// Initialize network on script load
initializeNetwork();