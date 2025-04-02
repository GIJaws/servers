import express from "express";
import http from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
// Removed import * as d3 - not used in backend

// Get current directory for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Interface matching the structure expected by the MCP server part
export interface ThoughtData {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
  nextThoughtNeeded: boolean;
}

// --- D3 Data Structures (Sent to Frontend) ---
interface D3Node {
  id: string; // Use a composite ID for uniqueness: e.g., "main-1", "branchA-5"
  thoughtNumber: number;
  group: "main" | "revision" | "branch";
  label: string; // Short label for display
  title: string; // Full text for tooltip
  // D3 simulation manages x, y, vx, vy. fx, fy can be used for fixed positions.
  fx?: number | null;
  fy?: number | null;
}

interface D3Link {
  source: string; // Source node ID (string)
  target: string; // Target node ID (string)
  type: "linear" | "revision" | "branch";
  id?: string; // Optional unique ID for the link itself
}
// --- End D3 Data Structures ---

export class WebUIServer {
  private app: express.Application;
  private server: http.Server;
  private io: SocketIOServer;
  private port: number;
  // Store the original thought data
  private thoughts: ThoughtData[] = [];
  // Store the D3 formatted data for sending initial state
  private nodes: D3Node[] = [];
  private links: D3Link[] = [];
  // Map for quick node lookup by composite ID
  private nodeMap: Map<string, D3Node> = new Map();

  constructor(port: number = 3000) {
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new SocketIOServer(this.server);

    // Set up static file serving from the public directory
    const publicPath = path.join(__dirname, "public");
    console.error(chalk.blue(`Serving static files from: ${publicPath}`));
    this.app.use(express.static(publicPath));

    // Default route serves index.html
    this.app.get("/", (req, res) => {
      res.sendFile(path.join(publicPath, "index.html"));
    });

    // Set up socket.io connection handler
    this.io.on("connection", (socket: Socket) => {
      console.error(chalk.green("Web UI client connected:"), socket.id);
      this.sendCurrentState(socket); // Send current graph state
      socket.on("disconnect", () => {
        console.error(chalk.yellow("Web UI client disconnected:"), socket.id);
      });
    });
  }

  public start(): void {
    this.server.listen(this.port, () => {
      console.error(chalk.green(`Web UI server running at http://localhost:${this.port}`));
    });
  }

  // Helper to generate a unique node ID
  private getNodeId(thought: ThoughtData): string {
    // If branchId exists and is not empty, use it as prefix, otherwise use 'main'
    const prefix = thought.branchId ? `B${thought.branchId}` : 'main';
    return `${prefix}-T${thought.thoughtNumber}`;
  }

  // Helper to create a D3 node object
  private createD3Node(thought: ThoughtData): D3Node {
    let group: D3Node["group"] = "main";
    if (thought.isRevision) group = "revision";
    else if (thought.branchFromThought) group = "branch";

    const nodeId = this.getNodeId(thought);

    return {
      id: nodeId,
      thoughtNumber: thought.thoughtNumber,
      group: group,
      label: `T${thought.thoughtNumber}` + (thought.branchId ? ` (${thought.branchId.substring(0, 3)})` : ""), // Shorter Label
      title: `Thought ${thought.thoughtNumber}/${thought.totalThoughts}\nBranch: ${thought.branchId ?? "main"
        }\nType: ${group}\nRevises: ${thought.revisesThought ?? "N/A"}\nFrom: ${thought.branchFromThought ?? "N/A"}\n\n${thought.thought
        }`, // Tooltip
      // fx/fy are null initially, let simulation place them
      fx: null,
      fy: null,
    };
  }

  // Helper to calculate D3 links connecting to a *new* thought
  private calculateNewD3Links(newThought: ThoughtData): D3Link[] {
    const linksToAdd: D3Link[] = [];
    const targetNodeId = this.getNodeId(newThought); // e.g., main-T5 or BbranchA-T3

    // Ensure the target node itself exists in our map before creating links *to* it
    if (!this.nodeMap.has(targetNodeId)) {
      console.warn(`Target node ${targetNodeId} not found in map when calculating links for it.`);
      return []; // Cannot create links to a non-existent node
    }

    // 1. Standard Linear Connection
    // Connect to the previous thought number *on the same branch* (or main)
    const linearSourceThoughtNumber = newThought.thoughtNumber - 1;
    if (linearSourceThoughtNumber > 0) {
      // Construct the expected ID of the previous node in the *same* context (branch or main)
      const sourceLinearNodeId = this.getNodeId({ ...newThought, thoughtNumber: linearSourceThoughtNumber }); // Generate ID using same context

      if (this.nodeMap.has(sourceLinearNodeId)) {
        // Ensure source and target are string IDs for the frontend map lookup
        console.assert(typeof sourceLinearNodeId === 'string', 'Linear source ID is not a string');
        console.assert(typeof targetNodeId === 'string', 'Linear target ID is not a string');
        linksToAdd.push({
          source: sourceLinearNodeId, // String ID
          target: targetNodeId,       // String ID
          type: "linear",
          id: `${sourceLinearNodeId} L> ${targetNodeId}`, // Unique link ID
        });
      }
    }

    // 2. Branch Connection
    // Connect from the thought it branched from
    if (newThought.branchFromThought) {
      // Find the *actual* source node by iterating through stored thoughts,
      // matching the thoughtNumber it branched from.
      let sourceBranchNodeId: string | null = null;
      // Search most recent thoughts first
      for (let i = this.thoughts.length - 1; i >= 0; i--) {
        const potentialSource = this.thoughts[i];
        if (potentialSource.thoughtNumber === newThought.branchFromThought) {
          // Find the *first* occurrence of this thought number when searching backwards.
          // This assumes the LLM refers to the global number of the thought it's branching from.
          sourceBranchNodeId = this.getNodeId(potentialSource);
          break;
        }
      }

      if (sourceBranchNodeId && this.nodeMap.has(sourceBranchNodeId)) {
        // Ensure source and target are string IDs
        console.assert(typeof sourceBranchNodeId === 'string', 'Branch source ID is not a string');
        console.assert(typeof targetNodeId === 'string', 'Branch target ID is not a string');
        linksToAdd.push({
          source: sourceBranchNodeId, // String ID
          target: targetNodeId,       // String ID
          type: "branch",
          id: `${sourceBranchNodeId} B> ${targetNodeId}`, // Unique link ID
        });
      } else {
        // Log if the branching source node wasn't found in history or map
        console.warn(`Could not find source node for branching: Thought Number ${newThought.branchFromThought}`);
      }
    }

    // 3. Revision Connection
    // Connect *from* the current thought *to* the thought being revised
    if (newThought.isRevision && newThought.revisesThought) {
      // Find the *actual* node being revised by iterating through history.
      let targetRevisionNodeId: string | null = null;
      for (let i = this.thoughts.length - 1; i >= 0; i--) {
        const potentialTarget = this.thoughts[i];
        if (potentialTarget.thoughtNumber === newThought.revisesThought) {
          // Similar to branching, find the first occurrence of the target number.
          targetRevisionNodeId = this.getNodeId(potentialTarget);
          break;
        }
      }

      if (targetRevisionNodeId && this.nodeMap.has(targetRevisionNodeId)) {
        // Ensure source and target are string IDs
        console.assert(typeof targetNodeId === 'string', 'Revision source ID is not a string');
        console.assert(typeof targetRevisionNodeId === 'string', 'Revision target ID is not a string');
        linksToAdd.push({
          source: targetNodeId,           // String ID (FROM revision)
          target: targetRevisionNodeId,   // String ID (TO original)
          type: "revision",
          id: `${targetNodeId} R> ${targetRevisionNodeId}`, // Unique link ID
        });
      } else {
        console.warn(`Could not find target node for revision: Thought Number ${newThought.revisesThought}`);
      }
    }

    return linksToAdd;
  }


  public updateThought(thoughtData: ThoughtData): void {
    // Store original data
    this.thoughts.push(thoughtData);

    // Create D3 representations
    const newNode = this.createD3Node(thoughtData);
    const newLinks = this.calculateNewD3Links(thoughtData); // Calculate based on current thought

    // Update internal state *before* emitting
    if (!this.nodeMap.has(newNode.id)) {
      this.nodes.push(newNode);
      this.nodeMap.set(newNode.id, newNode);
      // Add links only if the node was actually added or updated meaningfully
      this.links.push(...newLinks); // Frontend D3 data join should handle duplicates based on ID

      // Broadcast only the delta
      this.io.emit("thoughtAdded", { newNode, newLinks });
      console.error(chalk.cyan(`Emitted thoughtAdded: Node ID ${newNode.id}, ${newLinks.length} Links`));
    } else {
      // Node already exists. Currently, we don't handle updates to existing node properties.
      // If properties like 'totalThoughts' or 'thought' text change for an existing node ID,
      // these changes won't be reflected in the visualization.
      console.warn(chalk.yellow(`Node with ID ${newNode.id} already exists. Update event not emitted.`));
      // Optionally, update the node in the this.nodes array if needed internally,
      // but no 'thoughtUpdated' event is defined or emitted.
      const existingNodeIndex = this.nodes.findIndex(n => n.id === newNode.id);
      if (existingNodeIndex !== -1) {
        // Example: Update title/label if it could change, though no event is sent.
        this.nodes[existingNodeIndex].title = newNode.title;
        this.nodes[existingNodeIndex].label = newNode.label;
      }
    }
  }

  private sendCurrentState(socket: Socket): void {
    // Send the *current* snapshot of D3 nodes and links arrays directly
    // These arrays are maintained incrementally by updateThought
    console.error(
      chalk.blue(`Sending cached initial state to ${socket.id}: ${this.nodes.length} nodes, ${this.links.length} links`)
    );
    // Ensure we send copies to avoid potential mutation issues if the socket.io library holds references
    socket.emit("init", { nodes: [...this.nodes], links: [...this.links] });
  }

  public close(): void {
    this.io.close();
    this.server.close();
    console.error(chalk.red("Web UI server closed."));
  }
}