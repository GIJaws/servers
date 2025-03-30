import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

// Get current directory for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

export class WebUIServer {
  private app: express.Application;
  private server: http.Server;
  private io: SocketIOServer;
  private port: number;
  private thoughts: ThoughtData[] = [];
  private branches: Record<string, ThoughtData[]> = {};

  constructor(port: number = 3000) {
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new SocketIOServer(this.server);

    // Set up static file serving from the public directory
    this.app.use(express.static(path.join(__dirname, 'public')));

    // Default route serves index.html
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // Set up socket.io connection handler
    this.io.on('connection', (socket) => {
      console.error(chalk.green('Web UI client connected'));

      // Send current state to new clients
      this.sendCurrentState(socket);

      socket.on('disconnect', () => {
        console.error(chalk.yellow('Web UI client disconnected'));
      });
    });
  }

  public start(): void {
    this.server.listen(this.port, () => {
      console.error(chalk.green(`Web UI server running at http://localhost:${this.port}`));
    });
  }

  public updateThought(thoughtData: ThoughtData): void {
    // Store the thought
    this.thoughts.push(thoughtData);

    // Update branches if needed
    if (thoughtData.branchFromThought && thoughtData.branchId) {
      if (!this.branches[thoughtData.branchId]) {
        this.branches[thoughtData.branchId] = [];
      }
      this.branches[thoughtData.branchId].push(thoughtData);
    }

    // Broadcast the update to all connected clients
    this.broadcastUpdate();
  }

  private sendCurrentState(socket: any): void {
    socket.emit('init', {
      thoughts: this.thoughts,
      branches: this.branches
    });
  }

  private broadcastUpdate(): void {
    this.io.emit('update', {
      thoughts: this.thoughts,
      branches: this.branches
    });
  }

  public close(): void {
    this.server.close();
  }
}