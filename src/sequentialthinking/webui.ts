import express from "express";
import http from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

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

// Structure for vis.js nodes and edges
interface VisNode {
  id: number | string; // Use thoughtNumber or a composite ID if needed
  label: string;
  title: string;
  group: 'main' | 'revision' | 'branch';
}

interface VisEdge {
  from: number | string;
  to: number | string;
  arrows?: string;
  dashes?: boolean;
  color?: { color: string };
  id?: string; // Added for easier deduplication if needed
}


export class WebUIServer {
  private app: express.Application;
  private server: http.Server;
  private io: SocketIOServer;
  private port: number;
  // Store the original thought data to reconstruct state for new clients
  private thoughts: ThoughtData[] = [];
  // We don't strictly need branches state here if history is enough, but keeping it for now
  private branches: Record<string, ThoughtData[]> = {};

  constructor(port: number = 3000) {
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new SocketIOServer(this.server);

    // Set up static file serving from the public directory
    const publicPath = path.join(__dirname, "public");
    console.error(chalk.blue(`Serving static files from: ${publicPath}`)); // Log path
    this.app.use(express.static(publicPath));


    // Default route serves index.html
    this.app.get("/", (req, res) => {
      res.sendFile(path.join(publicPath, "index.html"));
    });

    // Set up socket.io connection handler
    this.io.on("connection", (socket: Socket) => {
      console.error(chalk.green("Web UI client connected:"), socket.id);

      // Send current state to the newly connected client
      this.sendCurrentState(socket);

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

  // Helper to create a node object for vis.js
  private createVisNode(thought: ThoughtData): VisNode {
    let group: VisNode['group'] = 'main';
    if (thought.isRevision) group = 'revision';
    else if (thought.branchFromThought) group = 'branch';

    // Use thoughtNumber as ID - assumes uniqueness for now.
    // If branching causes duplicate numbers, a composite ID like `${thought.branchId}-${thought.thoughtNumber}` might be needed.
    const nodeId = thought.thoughtNumber;

    return {
      id: nodeId,
      label: thought.thought.substring(0, 50) + (thought.thought.length > 50 ? '...' : ''), // Truncated label
      title: `Thought ${thought.thoughtNumber}/${thought.totalThoughts}\nType: ${group}\nRevise: ${thought.revisesThought ?? 'N/A'}\nBranch From: ${thought.branchFromThought ?? 'N/A'}\nBranch ID: ${thought.branchId ?? 'N/A'}\n\n${thought.thought}`, // Tooltip
      group: group,
    };
  }

  // Helper to calculate edges connecting to a *new* thought
  private calculateNewEdges(newThought: ThoughtData, history: ThoughtData[]): VisEdge[] {
    const edges: VisEdge[] = [];
    const currentId = newThought.thoughtNumber; // Assuming ID = thoughtNumber

    // 1. Standard Linear Connection (if not a branch start)
    if (newThought.thoughtNumber > 1 && !newThought.branchFromThought) {
      // Find the immediately preceding thought number *in the full history*
      // This simplified approach works if thoughtNumbers are globally sequential *except* for branches.
      const previousThoughtExists = history.find(t => t.thoughtNumber === newThought.thoughtNumber - 1);
      if (previousThoughtExists) {
        const edgeId = `${newThought.thoughtNumber - 1}-${currentId}-linear`;
        edges.push({ id: edgeId, from: newThought.thoughtNumber - 1, to: currentId, arrows: 'to' });
      }
      // Note: More complex logic might be needed if branches restart numbering or interleave heavily.
      // E.g., find the highest thought number less than currentId within the same branchId (or no branchId).
    }

    // 2. Branch Connection
    if (newThought.branchFromThought) {
      const edgeId = `${newThought.branchFromThought}-${currentId}-branch`;
      edges.push({ id: edgeId, from: newThought.branchFromThought, to: currentId, arrows: 'to', color: { color: '#28a745' } }); // Green for branch
    }

    // 3. Revision Connection
    if (newThought.isRevision && newThought.revisesThought) {
      const edgeId = `${currentId}-${newThought.revisesThought}-revision`;
      edges.push({ id: edgeId, from: currentId, to: newThought.revisesThought, arrows: 'to', dashes: true, color: { color: '#ffc107' } }); // Yellow/Orange for revision
    }

    return edges;
  }

  public updateThought(thoughtData: ThoughtData): void {
    // Store the original thought data
    this.thoughts.push(thoughtData);

    // Update branches record (might still be useful for stats or complex logic later)
    if (thoughtData.branchFromThought && thoughtData.branchId) {
      if (!this.branches[thoughtData.branchId]) {
        this.branches[thoughtData.branchId] = [];
      }
      this.branches[thoughtData.branchId].push(thoughtData);
    }

    // Create the vis.js representation for the *new* thought
    const newNode = this.createVisNode(thoughtData);
    // Calculate edges connecting *to* this new thought based on history
    const newEdges = this.calculateNewEdges(thoughtData, this.thoughts);

    // Broadcast only the delta (new node and edges)
    this.io.emit('thoughtAdded', { newNode, newEdges });
  }

  private sendCurrentState(socket: Socket): void {
    // Generate full graph state from the stored thoughts history
    const allNodes: VisNode[] = [];
    const allEdgesMap = new Map<string, VisEdge>(); // Use Map for deduplication

    this.thoughts.forEach((thought) => {
      // Add node
      allNodes.push(this.createVisNode(thought));

      // Calculate and add edges for this thought
      const edges = this.calculateNewEdges(thought, this.thoughts);
      edges.forEach(edge => {
        // Use a consistent ID format for deduplication
        const edgeKey = edge.id || `${edge.from}-${edge.to}-${edge.dashes}-${edge.color?.color}`;
        if (!allEdgesMap.has(edgeKey)) {
          allEdgesMap.set(edgeKey, edge);
        }
      });
    });

    const allEdges = Array.from(allEdgesMap.values());

    console.error(chalk.blue(`Sending initial state to ${socket.id}: ${allNodes.length} nodes, ${allEdges.length} edges`));
    socket.emit('init', { nodes: allNodes, edges: allEdges });
  }

  public close(): void {
    this.io.close(); // Close socket connections
    this.server.close(); // Close HTTP server
    console.error(chalk.red("Web UI server closed."));
  }
}