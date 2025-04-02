// Connect to the Socket.io server
const socket = io();

// --- D3 Setup ---
let svg, container, simulation, gLinks, gNodes, zoom;
let nodesData = [];
let linksData = [];
const nodeMap = new Map(); // For quick node lookup by ID

const NODE_RADIUS = 15; // Radius of the node circles

// DOM Elements for stats and debug
const totalNodesElement = document.getElementById("total-nodes");
const totalLinksElement = document.getElementById("total-links");
const simStatusElement = document.getElementById("sim-status");
const lastEventElement = document.getElementById("last-event");
const loadingDiv = document.querySelector(".loading");

/**
 * Initializes the D3 force-directed graph.
 * Creates SVG, groups for links/nodes, sets up zoom, and starts the simulation.
 */
function initializeGraph() {
  console.log("Initializing D3 graph...");
  updateLastEvent("Initializing D3");

  container = d3.select("#thought-container");
  if (container.empty()) {
    console.error("D3 container #thought-container not found.");
    updateLastEvent("Error: Container not found");
    if (loadingDiv) loadingDiv.textContent = "Error: Container div missing.";
    return;
  }

  // Clear loading message only if it exists
  const existingLoadingDiv = container.select(".loading");
  if (!existingLoadingDiv.empty()) {
    existingLoadingDiv.remove();
  }


  // Get dimensions from the container element
  const containerRect = container.node().getBoundingClientRect();
  const width = containerRect.width || 800; // Fallback width
  const height = containerRect.height || 600; // Fallback height

  // Create SVG element if it doesn't exist
  svg = container.select("svg");
  if (svg.empty()) {
    svg = container.append("svg")
      .attr("width", width)
      .attr("height", height)
      // Set viewBox to center origin (0,0) which helps with zoom/pan
      .attr("viewBox", [-width / 2, -height / 2, width, height])
      .style("max-width", "100%")
      .style("height", "auto"); // Make SVG responsive

    // Define marker definitions for arrows (if needed later)
    svg.append("defs").append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "-0 -5 10 10")
      .attr("refX", NODE_RADIUS + 5) // Adjust based on node size + desired distance
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("xoverflow", "visible")
      .append("svg:path")
      .attr("d", "M 0,-5 L 10 ,0 L 0,5")
      .attr("fill", "#999") // Arrow color
      .style("stroke", "none");

    // Add groups for links and nodes (order matters for z-index)
    gLinks = svg.append("g").attr("class", "links");
    gNodes = svg.append("g").attr("class", "nodes");

    // Setup zoom behavior *after* SVG and groups are created
    zoom = d3.zoom()
      .scaleExtent([0.1, 4]) // Min/max zoom levels
      .on("zoom", (event) => {
        // Apply zoom transform to the main groups
        gLinks.attr("transform", event.transform);
        gNodes.attr("transform", event.transform);
      });
    svg.call(zoom); // Apply zoom to the SVG element

  } else {
    // If SVG exists (e.g., on reconnect), ensure groups are selected correctly
    gLinks = svg.select("g.links");
    gNodes = svg.select("g.nodes");
    // Clear previous elements if re-initializing fully
    // gLinks.selectAll("*").remove();
    // gNodes.selectAll("*").remove();
    console.log("Re-using existing SVG element.");
  }

  // Setup D3 force simulation
  simulation = d3.forceSimulation(nodesData)
    // Link force: pulls linked nodes together
    .force("link", d3.forceLink(linksData)
      .id(d => d.id) // Tell forceLink how to get node IDs from link data
      .distance(d => d.type === 'revision' ? 120 : 80) // Longer distance for revision links?
      .strength(0.8)) // Adjust link strength
    // Charge force: repulsion between nodes
    .force("charge", d3.forceManyBody().strength(-200)) // Increased repulsion
    // Center force: pulls graph towards the center of the viewBox
    .force("center", d3.forceCenter(0, 0))
    // Collision force: prevents nodes from overlapping
    .force("collide", d3.forceCollide(NODE_RADIUS * 1.5)) // Prevent overlap based on radius
    // Update node/link positions on each simulation 'tick'
    .on("tick", ticked)
    // Log when simulation cools down
    .on("end", () => updateSimStatus("Stopped"));

  updateSimStatus("Ready");
  console.log("D3 Graph Initialized");
  updateLastEvent("D3 Initialized");

  // Call updateGraph initially to render the current state (might be empty)
  updateGraph();
}

/**
 * Called on each tick of the D3 simulation.
 * Updates the positions of SVG elements (lines and node groups).
 */
function ticked() {
  // Update link line endpoints
  gLinks.selectAll("line")
    .attr("x1", d => d.source.x)
    .attr("y1", d => d.source.y)
    .attr("x2", d => d.target.x)
    .attr("y2", d => d.target.y);

  // Update node group positions using transform
  gNodes.selectAll(".node")
    .attr("transform", d => `translate(${d.x || 0},${d.y || 0})`); // Handle potential undefined x/y briefly

  // No need to call updateSimStatus("Running") here, it's implicit
  // Can be added if frequent status updates are desired
}

/**
 * Updates the D3 graph based on the current nodesData and linksData arrays.
 * Uses D3's data join pattern (enter, update, exit).
 */
function updateGraph() {
  // Ensure simulation and SVG groups are initialized
  if (!simulation || !svg || !gNodes || !gLinks) {
    console.warn("Attempted to update graph before full initialization.");
    initializeGraph(); // Try to initialize if not ready
    if (!simulation) return; // Exit if initialization failed
  }
  console.log(`Updating graph visualization. Nodes: ${nodesData.length}, Links: ${linksData.length}`);
  updateLastEvent(`Updating graph (${nodesData.length}N, ${linksData.length}L)`);

  // --- Links Data Join ---
  // Bind linksData to line elements, keyed by a unique link identifier
  const link = gLinks.selectAll("line")
    .data(linksData, d => d.id || `${d.source.id || d.source}-${d.target.id || d.target}`); // Use link ID or generate source-target

  // Enter selection: Create new line elements for new links
  link.enter().append("line")
    .attr("class", d => `link link-${d.type}`) // Apply class based on link type
    .attr("marker-end", d => d.type !== 'revision' ? "url(#arrowhead)" : null) // Add arrowhead except for revisions
    .merge(link) // Apply below attributes to both new and updating links
    .attr("stroke-width", 2); // Set default stroke width

  // Exit selection: Remove line elements for removed links
  link.exit().remove();

  // --- Nodes Data Join ---
  // Bind nodesData to 'g' elements (node groups), keyed by node ID
  const node = gNodes.selectAll(".node")
    .data(nodesData, d => d.id);

  // Enter selection: Create new 'g' elements for new nodes
  const nodeEnter = node.enter().append("g")
    .attr("class", d => `node node-${d.group}`) // Apply class based on node group
    .call(drag(simulation)); // Enable dragging for new nodes

  // Append visual elements (circle, text) to the entering group
  nodeEnter.append("circle")
    .attr("r", NODE_RADIUS)
    .on("mouseover", (event, d) => {
      // Example: Highlight connected nodes/links on hover
      link.style('stroke-opacity', l => (l.source === d || l.target === d) ? 1 : 0.2);
      link.style('stroke-width', l => (l.source === d || l.target === d) ? 3 : 2);
      node.style('opacity', n => (isConnected(d, n) || n === d) ? 1 : 0.3);
      d3.select(event.currentTarget).attr("r", NODE_RADIUS * 1.2); // Enlarge circle
    })
    .on("mouseout", (event, d) => {
      link.style('stroke-opacity', 0.6);
      link.style('stroke-width', 2);
      node.style('opacity', 1);
      d3.select(event.currentTarget).attr("r", NODE_RADIUS); // Restore size
    });


  nodeEnter.append("text")
    .attr("dy", "0.3em") // Vertical centering adjustment
    .text(d => d.label); // Display the short label

  // Add a <title> element for native browser tooltips
  nodeEnter.append("title")
    .text(d => d.title); // Set tooltip content to the full thought

  // Merge enter and update selections to apply changes to all existing nodes
  const nodeUpdate = nodeEnter.merge(node);

  // Update class and styles based on data (in case group changes)
  nodeUpdate.attr("class", d => `node node-${d.group}`); // Ensure class is correct
  nodeUpdate.select("circle") // Example: Update fill if needed, though CSS handles it now
    .style("fill", d => getNodeColor(d.group));
  nodeUpdate.select("text")
    .text(d => d.label); // Update label if it changes
  nodeUpdate.select("title")
    .text(d => d.title); // Update tooltip if it changes


  // Exit selection: Remove 'g' elements for removed nodes
  node.exit().remove();

  // --- Update Simulation ---
  // Update the simulation with the latest nodes and links data
  simulation.nodes(nodesData);
  // Important: Tell the link force how to find nodes from link data
  simulation.force("link").links(linksData);

  // Give the simulation a 'kick' to rearrange nodes with new data
  simulation.alpha(0.5).restart();
  updateSimStatus("Running"); // Indicate simulation is active

  // Update the statistics displayed in the sidebar
  updateStatsDisplay();
}

/**
 * Helper function to get node color based on group.
 * @param {string} group - The node group ('main', 'revision', 'branch').
 * @returns {string} - The corresponding fill color.
 */
function getNodeColor(group) {
  switch (group) {
    case 'revision': return 'var(--node-revision-fill)';
    case 'branch': return 'var(--node-branch-fill)';
    case 'main':
    default: return 'var(--node-main-fill)';
  }
}

/**
 * Helper function to check node connectivity for hover effect.
 */
let linkedByIndex = {};
function isConnected(a, b) {
  // Rebuild index on demand (could optimize if graph is large)
  linkedByIndex = {};
  linksData.forEach(d => {
    linkedByIndex[`${d.source.id || d.source}-${d.target.id || d.target}`] = 1;
  });
  return linkedByIndex[`${a.id}-${b.id}`] || linkedByIndex[`${b.id}-${a.id}`] || a.id === b.id;
}


/**
 * Creates and returns the D3 drag behavior handler.
 * @param {object} simulation - The D3 force simulation instance.
 */
function drag(simulation) {
  function dragstarted(event, d) {
    // Check if simulation is active, increase alpha target to 'wake up' simulation during drag
    if (!event.active) simulation.alphaTarget(0.3).restart();
    // Set fixed position (fx, fy) to current position so node stops moving naturally
    d.fx = d.x;
    d.fy = d.y;
    updateLastEvent(`Drag Start: ${d.id}`);
    d3.select(this).raise(); // Bring dragged node to front
  }

  function dragged(event, d) {
    // Update fixed position to follow the mouse pointer
    d.fx = event.x;
    d.fy = event.y;
    // updateLastEvent(`Dragging: ${d.id}`); // Can be noisy, uncomment if needed
  }

  function dragended(event, d) {
    // If simulation is not active, reset alpha target
    if (!event.active) simulation.alphaTarget(0);
    // Release the fixed position, allowing the simulation to position the node again
    d.fx = null;
    d.fy = null;
    updateLastEvent(`Drag End: ${d.id}`);
  }

  // Create and configure the drag behavior
  return d3.drag()
    .on("start", dragstarted)
    .on("drag", dragged)
    .on("end", dragended);
}


// --- Socket Event Handlers ---
socket.on("connect", () => {
  console.log("Socket connected");
  updateLastEvent("Socket Connected");
  // Initialize graph only if SVG isn't already there or if data is empty
  if (!svg || nodesData.length === 0) {
    initializeGraph();
  } else {
    // Request latest state if reconnected and graph exists
    // NOTE: Backend needs to implement handling for 'requestState'
    // socket.emit("requestState");
    console.log("Reconnected. Graph exists.");
    updateLastEvent("Socket Reconnected");
  }
});

socket.on("disconnect", () => {
  console.error("Socket disconnected");
  updateLastEvent("Socket Disconnected");
  updateSimStatus("Disconnected");
  // Maybe add a visual indicator like graying out the graph
});

socket.on("init", ({ nodes, links }) => {
  console.log(`Socket received INIT: ${nodes.length} nodes, ${links.length} links`);
  updateLastEvent(`Received Init (${nodes.length}N, ${links.length}L)`);

  // Ensure graph is initialized before processing data
  if (!simulation) {
    console.warn("Received init before simulation was ready. Initializing graph.");
    initializeGraph();
    if (!simulation) { // Check again if init failed
      console.error("Graph initialization failed. Cannot process init data.");
      updateLastEvent("Error: Graph init failed");
      return;
    }
  }

  // --- Replace Data ---
  // Clear existing data structures
  nodesData = [];
  linksData = [];
  nodeMap.clear();

  // Process received nodes
  nodes.forEach(n => {
    if (!nodeMap.has(n.id)) {
      // D3 simulation adds x, y etc. Don't overwrite if they exist from server (though unlikely)
      nodesData.push({ ...n });
      nodeMap.set(n.id, nodesData[nodesData.length - 1]);
    }
  });

  // Process received links - IMPORTANT: D3 needs source/target to be node *IDs* initially
  // The simulation.force("link").links(linksData) call will resolve these IDs to object references.
  links.forEach(l => {
    // Ensure source and target exist in our node map before adding link
    if (nodeMap.has(l.source) && nodeMap.has(l.target)) {
      linksData.push({ ...l }); // Store raw link data
    } else {
      console.warn(`Skipping link, source or target node not found: ${l.source} -> ${l.target}`);
    }
  });


  console.log(`Processed INIT. Nodes: ${nodesData.length}, Links: ${linksData.length}`);
  updateGraph(); // Update D3 visualization with the new data
});

socket.on("thoughtAdded", ({ newNode, newLinks }) => {
  console.log("Socket received thoughtAdded:", newNode, newLinks);
  updateLastEvent(`Received Thought ${newNode?.label || 'Unknown'}`);

  if (!simulation) {
    console.warn("Received thoughtAdded before simulation was ready.");
    // Could potentially queue this update if needed
    return;
  }

  let graphChanged = false;

  // Add new node if it doesn't already exist in our data
  if (newNode && !nodeMap.has(newNode.id)) {
    nodesData.push({ ...newNode }); // Add copy to data array
    nodeMap.set(newNode.id, nodesData[nodesData.length - 1]); // Add to map
    graphChanged = true;
    console.log(`Added node ${newNode.id}`);
  } else if (newNode) {
    console.warn(`Node ${newNode.id} already exists. Update if necessary.`);
    // Optional: Find existing node and update its properties if they can change
    // const existingNode = nodesData.find(n => n.id === newNode.id);
    // if (existingNode) { /* update properties */ }
  }

  // Add new links if source and target nodes exist
  if (newLinks && Array.isArray(newLinks)) {
    newLinks.forEach(link => {
      const linkIdentifier = link.id || `${link.source}-${link.target}`; // Use ID or generate one
      const linkExists = linksData.some(l => (l.id || `${l.source.id || l.source}-${l.target.id || l.target}`) === linkIdentifier);

      if (!linkExists && nodeMap.has(link.source) && nodeMap.has(link.target)) {
        linksData.push({ ...link }); // Add copy of link data
        graphChanged = true;
        console.log(`Added link ${link.source} -> ${link.target}`);
      } else if (linkExists) {
        // console.warn(`Link ${linkIdentifier} already exists.`);
      } else {
        console.warn(`Skipping link ${linkIdentifier}, source or target node missing.`);
      }
    });
  }

  // Only update the graph if something actually changed
  if (graphChanged) {
    updateGraph();
  }
});


// --- UI Update Functions ---
/** Updates the statistics display in the sidebar. */
function updateStatsDisplay() {
  if (totalNodesElement) totalNodesElement.textContent = nodesData.length;
  if (totalLinksElement) totalLinksElement.textContent = linksData.length;
}

/** Updates the simulation status message in the debug panel. */
function updateSimStatus(status) {
  if (simStatusElement) simStatusElement.textContent = status;
}

/** Updates the last event message in the debug panel and logs to console. */
function updateLastEvent(message) {
  if (lastEventElement) lastEventElement.textContent = message;
  console.log("UI Event:", message);
}


// --- Debug Controls ---
let testNodeCounter = 0; // Counter for unique test node IDs

/** Handler for the 'Restart Simulation' button. */
document.getElementById("btn-restart-sim")?.addEventListener("click", () => {
  if (simulation) {
    simulation.alpha(1).restart(); // Reset alpha to reheat the simulation
    updateLastEvent("Simulation Restarted");
    updateSimStatus("Running");
  } else {
    updateLastEvent("Simulation not ready");
  }
});

/** Handler for the 'Add Test Node' button. */
document.getElementById("btn-add-test-node")?.addEventListener("click", () => {
  if (!simulation) {
    updateLastEvent("Simulation not ready");
    return;
  }
  testNodeCounter++;
  const newNodeId = `test-${testNodeCounter}`;
  const groups = ['main', 'revision', 'branch'];
  const newNode = {
    id: newNodeId,
    thoughtNumber: 9000 + testNodeCounter, // Arbitrary high number
    group: groups[testNodeCounter % groups.length], // Cycle through groups
    label: `Test ${testNodeCounter}`,
    title: `Test Node ${testNodeCounter}\nGroup: ${groups[testNodeCounter % groups.length]}`
    // x, y, fx, fy will be handled by simulation initially
  };

  // Add node to data structures
  nodesData.push(newNode);
  nodeMap.set(newNodeId, newNode);

  // Link to previous test node if it exists
  if (testNodeCounter > 1) {
    const prevId = `test-${testNodeCounter - 1}`;
    if (nodeMap.has(prevId)) {
      // Add link to data structures
      linksData.push({ source: prevId, target: newNodeId, type: 'linear' });
    }
  }
  updateLastEvent(`Added Test Node ${testNodeCounter}`);
  updateGraph(); // Trigger D3 update
});


// --- Initial Page Load ---
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM fully loaded. Waiting for socket connection to initialize graph.");
  updateLastEvent("DOM Ready");
  // Graph initialization is now triggered by the 'connect' socket event
  // or the 'init' event if connect happens before DOMContentLoaded.
  if (loadingDiv) loadingDiv.textContent = "Waiting for server connection...";
});