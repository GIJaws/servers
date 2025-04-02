import express from "express";
import http from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import * as d3 from 'd3';
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

// --- D3 Data Structures ---
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
  source: string; // Source node ID
  target: string; // Target node ID
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
    return thought.branchId ? `${thought.branchId}-${thought.thoughtNumber}` : `main-${thought.thoughtNumber}`;
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
      label: `T${thought.thoughtNumber}` + (thought.branchId ? ` (${thought.branchId.substring(0, 3)})` : ''), // Shorter Label
      title: `Thought ${thought.thoughtNumber}/${thought.totalThoughts}\nBranch: ${thought.branchId ?? "main"}\nType: ${group}\nRevises: ${thought.revisesThought ?? "N/A"}\nFrom: ${thought.branchFromThought ?? "N/A"}\n\n${thought.thought}`, // Tooltip
      // fx/fy are null initially, let simulation place them
      fx: null,
      fy: null,
    };
  }

  // Helper to calculate D3 links connecting to a *new* thought
  private calculateNewD3Links(newThought: ThoughtData): D3Link[] {
    const linksToAdd: D3Link[] = [];
    const targetNodeId = this.getNodeId(newThought);

    // 1. Standard Linear Connection
    // Connect to the previous thought number *on the same branch* (or main)
    const sourceLinearNodeId = newThought.branchId
      ? `${newThought.branchId}-${newThought.thoughtNumber - 1}`
      : `main-${newThought.thoughtNumber - 1}`;
    if (newThought.thoughtNumber > 1 && this.nodeMap.has(sourceLinearNodeId)) {
      linksToAdd.push({
        source: sourceLinearNodeId,
        target: targetNodeId,
        type: "linear",
        id: `${sourceLinearNodeId} L> ${targetNodeId}`
      });
    }

    // 2. Branch Connection
    // Connect from the thought it branched from (which might be on 'main' or another branch)
    if (newThought.branchFromThought) {
      // Find the actual node ID of the source thought
      const sourceBranchNode = this.thoughts.find(t => t.thoughtNumber === newThought.branchFromThought && !t.branchId); // Simplification: assumes branches always come from main
      const sourceBranchNodeId = sourceBranchNode ? this.getNodeId(sourceBranchNode) : `main-${newThought.branchFromThought}`; // Fallback ID structure
      if (this.nodeMap.has(sourceBranchNodeId)) {
        linksToAdd.push({
          source: sourceBranchNodeId,
          target: targetNodeId,
          type: "branch",
          id: `${sourceBranchNodeId} B> ${targetNodeId}`
        });
      } else {
        console.warn(`Could not find source node ID ${sourceBranchNodeId} for branching`);
      }
    }

    // 3. Revision Connection
    // Connect *from* the current thought *to* the thought being revised
    if (newThought.isRevision && newThought.revisesThought) {
      // Find the actual node ID of the target thought being revised
      const targetRevisionNode = this.thoughts.find(t => t.thoughtNumber === newThought.revisesThought); // Assume revised node exists
      const targetRevisionNodeId = targetRevisionNode ? this.getNodeId(targetRevisionNode) : `main-${newThought.revisesThought}`; // Fallback ID structure
      if (this.nodeMap.has(targetRevisionNodeId)) {
        linksToAdd.push({
          source: targetNodeId, // Link goes FROM the revision node
          target: targetRevisionNodeId, // TO the node being revised
          type: "revision",
          id: `${targetNodeId} R> ${targetRevisionNodeId}`
        });
      } else {
        console.warn(`Could not find target node ID ${targetRevisionNodeId} for revision`);
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
      this.links.push(...newLinks); // Assumes links are unique enough or frontend handles duplicates

      // Broadcast only the delta
      this.io.emit("thoughtAdded", { newNode, newLinks });
      console.error(chalk.cyan(`Emitted thoughtAdded: Node ID ${newNode.id}, ${newLinks.length} Links`));
    } else {
      console.warn(`Node with ID ${newNode.id} already exists. Update logic not fully implemented yet.`);
      // Implement node update logic if needed (e.g., changing label/tooltip)
      // Find existing node, update properties, emit 'thoughtUpdated' event?
    }
  }

  private sendCurrentState(socket: Socket): void {
    // Send the *current* snapshot of D3 nodes and links
    console.error(
      chalk.blue(`Sending initial state to ${socket.id}: ${this.nodes.length} nodes, ${this.links.length} links`)
    );
    socket.emit("init", { nodes: this.nodes, links: this.links });
  }

  public close(): void {
    this.io.close();
    this.server.close();
    console.error(chalk.red("Web UI server closed."));
  }
}