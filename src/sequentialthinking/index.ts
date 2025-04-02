#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
// Fixed chalk import for ESM
import chalk from 'chalk';
// Import yargs for command-line argument handling
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
// Import the WebUIServer class
import { WebUIServer } from './webui.js';

// Parse command-line arguments
const yargsParser = yargs(hideBin(process.argv))
  .option('web-ui', {
    alias: 'ui',
    type: 'boolean',
    description: 'Enable web UI visualization',
    default: false
  })
  .option('port', {
    alias: 'p',
    type: 'number',
    description: 'Port for the web UI server',
    default: 3000
  })
  .help();

interface ThoughtData {
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

class SequentialThinkingServer {
  private thoughtHistory: ThoughtData[] = [];
  private branches: Record<string, ThoughtData[]> = {};
  private webUIServer: WebUIServer | null = null;

  constructor(enableWebUI: boolean = false, port: number = 3000) {
    if (enableWebUI) {
      this.webUIServer = new WebUIServer(port);
      this.webUIServer.start();
    }
  }

  public setWebUIServer(webUIServer: WebUIServer): void {
    this.webUIServer = webUIServer;
  }

  private validateThoughtData(input: unknown): ThoughtData {
    const data = input as Record<string, unknown>;

    // Basic Type Checks (keep existing)
    if (!data.thought || typeof data.thought !== 'string') {
      throw new Error('Invalid thought: must be a string');
    }
    if (!data.thoughtNumber || typeof data.thoughtNumber !== 'number' || !Number.isInteger(data.thoughtNumber) || data.thoughtNumber < 1) {
      throw new Error('Invalid thoughtNumber: must be a positive integer');
    }
    if (!data.totalThoughts || typeof data.totalThoughts !== 'number' || !Number.isInteger(data.totalThoughts) || data.totalThoughts < 1) {
      throw new Error('Invalid totalThoughts: must be a positive integer');
    }
    if (typeof data.nextThoughtNeeded !== 'boolean') {
      throw new Error('Invalid nextThoughtNeeded: must be a boolean');
    }

    // Relational Constraint Checks (NEW)
    const isRevision = data.isRevision as boolean | undefined;
    const revisesThought = data.revisesThought as number | undefined;
    const branchFromThought = data.branchFromThought as number | undefined;
    const branchId = data.branchId as string | undefined;

    if (isRevision === true && (revisesThought === undefined || typeof revisesThought !== 'number' || !Number.isInteger(revisesThought) || revisesThought < 1)) {
      throw new Error('Invalid input: `isRevision` is true, but `revisesThought` is missing or not a positive integer.');
    }
    if (isRevision !== true && revisesThought !== undefined) {
      throw new Error('Invalid input: `revisesThought` is provided, but `isRevision` is not true.');
    }

    if (branchId !== undefined && (branchFromThought === undefined || typeof branchFromThought !== 'number' || !Number.isInteger(branchFromThought) || branchFromThought < 1)) {
      throw new Error('Invalid input: `branchId` is provided, but `branchFromThought` is missing or not a positive integer.');
    }
    // Optional: Add check if branchFromThought requires branchId, although a branch might conceptually start without an ID initially.
    // if (branchFromThought !== undefined && branchId === undefined) {
    //   console.warn('Warning: `branchFromThought` provided without `branchId`.'); // Or throw error if ID is mandatory for branching.
    // }

    // Optional type checks for optional fields if they are present
    if (data.isRevision !== undefined && typeof data.isRevision !== 'boolean') {
      throw new Error('Invalid isRevision: must be a boolean if provided');
    }
    if (data.revisesThought !== undefined && (typeof data.revisesThought !== 'number' || !Number.isInteger(data.revisesThought) || data.revisesThought < 1)) {
      throw new Error('Invalid revisesThought: must be a positive integer if provided');
    }
    if (data.branchFromThought !== undefined && (typeof data.branchFromThought !== 'number' || !Number.isInteger(data.branchFromThought) || data.branchFromThought < 1)) {
      throw new Error('Invalid branchFromThought: must be a positive integer if provided');
    }
    if (data.branchId !== undefined && typeof data.branchId !== 'string') {
      throw new Error('Invalid branchId: must be a string if provided');
    }
    if (data.needsMoreThoughts !== undefined && typeof data.needsMoreThoughts !== 'boolean') {
      throw new Error('Invalid needsMoreThoughts: must be a boolean if provided');
    }


    // Return validated data (keep existing)
    return {
      thought: data.thought,
      thoughtNumber: data.thoughtNumber,
      totalThoughts: data.totalThoughts,
      nextThoughtNeeded: data.nextThoughtNeeded,
      isRevision: isRevision,
      revisesThought: revisesThought,
      branchFromThought: branchFromThought,
      branchId: branchId,
      needsMoreThoughts: data.needsMoreThoughts as boolean | undefined,
    };
  }

  private formatThought(thoughtData: ThoughtData): string {
    const { thoughtNumber, totalThoughts, thought, isRevision, revisesThought, branchFromThought, branchId } = thoughtData;

    let prefix = '';
    let context = '';

    if (isRevision) {
      prefix = chalk.yellow('🔄 Revision');
      context = ` (revising thought ${revisesThought})`;
    } else if (branchFromThought) {
      prefix = chalk.green('🌿 Branch');
      context = ` (from thought ${branchFromThought}, ID: ${branchId})`;
    } else {
      prefix = chalk.blue('💭 Thought');
      context = '';
    }

    const header = `${prefix} ${thoughtNumber}/${totalThoughts}${context}`;
    const border = '─'.repeat(Math.max(header.length, thought.length) + 4);

    return `
┌${border}┐
│ ${header} │
├${border}┤
│ ${thought.padEnd(border.length - 2)} │
└${border}┘`;
  }

  public processThought(input: unknown): { content: Array<{ type: string; text: string }>; isError?: boolean } {
    try {
      const validatedInput = this.validateThoughtData(input);

      if (validatedInput.thoughtNumber > validatedInput.totalThoughts) {
        validatedInput.totalThoughts = validatedInput.thoughtNumber;
      }

      this.thoughtHistory.push(validatedInput);

      if (validatedInput.branchFromThought && validatedInput.branchId) {
        if (!this.branches[validatedInput.branchId]) {
          this.branches[validatedInput.branchId] = [];
        }
        this.branches[validatedInput.branchId].push(validatedInput);
      }

      const formattedThought = this.formatThought(validatedInput);
      console.error(formattedThought);

      // Update web UI if enabled
      if (this.webUIServer) {
        this.webUIServer.updateThought(validatedInput);
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            thoughtNumber: validatedInput.thoughtNumber,
            totalThoughts: validatedInput.totalThoughts,
            nextThoughtNeeded: validatedInput.nextThoughtNeeded,
            branches: Object.keys(this.branches),
            thoughtHistoryLength: this.thoughtHistory.length
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            status: 'failed'
          }, null, 2)
        }],
        isError: true
      };
    }
  }
}

const SEQUENTIAL_THINKING_TOOL: Tool = {
  name: "sequentialthinking",
  description: `A detailed tool for dynamic and reflective problem-solving through thoughts.
This tool helps analyze problems through a flexible thinking process that can adapt and evolve.
Each thought can build on, question, or revise previous insights as understanding deepens.

When to use this tool:
- Breaking down complex problems into steps
- Planning and design with room for revision
- Analysis that might need course correction
- Problems where the full scope might not be clear initially
- Problems that require a multi-step solution
- Tasks that need to maintain context over multiple steps
- Situations where irrelevant information needs to be filtered out

Key features:
- You can adjust total_thoughts up or down as you progress
- You can question or revise previous thoughts
- You can add more thoughts even after reaching what seemed like the end
- You can express uncertainty and explore alternative approaches
- Not every thought needs to build linearly - you can branch or backtrack
- Generates a solution hypothesis
- Verifies the hypothesis based on the Chain of Thought steps
- Repeats the process until satisfied
- Provides a correct answer

Parameters explained:
- thought: Your current thinking step, which can include:
* Regular analytical steps
* Revisions of previous thoughts
* Questions about previous decisions
* Realizations about needing more analysis
* Changes in approach
* Hypothesis generation
* Hypothesis verification
- next_thought_needed: True if you need more thinking, even if at what seemed like the end
- thought_number: Current number in sequence (can go beyond initial total if needed)
- total_thoughts: Current estimate of thoughts needed (can be adjusted up/down)
- is_revision: A boolean indicating if this thought revises previous thinking
- revises_thought: If is_revision is true, which thought number is being reconsidered
- branch_from_thought: If branching, which thought number is the branching point
- branch_id: Identifier for the current branch (if any)
- needs_more_thoughts: If reaching end but realizing more thoughts needed

You should:
1. Start with an initial estimate of needed thoughts, but be ready to adjust
2. Feel free to question or revise previous thoughts
3. Don't hesitate to add more thoughts if needed, even at the "end"
4. Express uncertainty when present
5. Mark thoughts that revise previous thinking or branch into new paths
6. Ignore information that is irrelevant to the current step
7. Generate a solution hypothesis when appropriate
8. Verify the hypothesis based on the Chain of Thought steps
9. Repeat the process until satisfied with the solution
10. Provide a single, ideally correct answer as the final output
11. Only set next_thought_needed to false when truly done and a satisfactory answer is reached`,
  inputSchema: {
    type: "object",
    properties: {
      thought: {
        type: "string",
        description: "Your current thinking step"
      },
      nextThoughtNeeded: {
        type: "boolean",
        description: "Whether another thought step is needed"
      },
      thoughtNumber: {
        type: "integer",
        description: "Current thought number",
        minimum: 1
      },
      totalThoughts: {
        type: "integer",
        description: "Estimated total thoughts needed",
        minimum: 1
      },
      isRevision: {
        type: "boolean",
        description: "Whether this revises previous thinking"
      },
      revisesThought: {
        type: "integer",
        description: "Which thought is being reconsidered",
        minimum: 1
      },
      branchFromThought: {
        type: "integer",
        description: "Branching point thought number",
        minimum: 1
      },
      branchId: {
        type: "string",
        description: "Branch identifier"
      },
      needsMoreThoughts: {
        type: "boolean",
        description: "If more thoughts are needed"
      }
    },
    required: ["thought", "nextThoughtNeeded", "thoughtNumber", "totalThoughts"]
  }
};

const server = new Server(
  {
    name: "sequential-thinking-server",
    version: "0.2.0", // Note: Version updated in package.json, maybe update here too?
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Will be initialized in runServer

async function initServer(parsedArgs: any) {
  // Initialize the SequentialThinkingServer with web UI if enabled
  const thinkingServer = new SequentialThinkingServer(
    parsedArgs['web-ui'],
    parsedArgs.port
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [SEQUENTIAL_THINKING_TOOL],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "sequentialthinking") {
      return thinkingServer.processThought(request.params.arguments);
    }

    return {
      content: [{
        type: "text",
        text: `Unknown tool: ${request.params.name}`
      }],
      isError: true
    };
  });

  return thinkingServer;
}

async function runServer() {
  try {
    // Parse command-line arguments
    const parsedArgs = await yargsParser.parseAsync();

    // Initialize server with parsed arguments
    const thinkingServer = await initServer(parsedArgs);

    // Set up transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // Log startup message
    if (parsedArgs['web-ui']) {
      console.error(`Sequential Thinking MCP Server running on stdio with Web UI at http://localhost:${parsedArgs.port}`);
    } else {
      console.error("Sequential Thinking MCP Server running on stdio");
    }
  } catch (error) {
    console.error("Error during server initialization:", error);
    process.exit(1);
  }
}

// Start the server
runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});