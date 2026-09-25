#!/usr/bin/env node

/**
 * ERP Preflight — Model Context Protocol (MCP) Stdio Server
 * Part 16.14 & Part 19 Master Specification Compliance
 *
 * Implements JSON-RPC 2.0 over standard I/O (stdio) to allow
 * AI agents (Claude Desktop, Cursor, Goose, Joule, etc.) to safely
 * preflight SAP changes, query Clean Core rules, and run simulations.
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const CONFIG_DIR = path.join(os.homedir(), '.erppreflight');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_API_URL = process.env.ERP_PREFLIGHT_API_URL || 'http://localhost:3001/api/v1';

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

async function apiRequest(endpoint, options = {}) {
  const config = loadConfig();
  const apiKey = process.env.ERP_PREFLIGHT_API_KEY || config.apiKey;
  const baseUrl = config.apiUrl || DEFAULT_API_URL;

  const url = `${baseUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ERP Preflight API Error [${res.status}]: ${errText}`);
  }
  return await res.json();
}

const MCP_TOOLS = [
  {
    name: 'erppreflight_list_projects',
    description: 'List all SAP preflight project workspaces available for your organization.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'erppreflight_get_findings',
    description: 'Retrieve preflight findings for an SAP project with optional severity filter.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project UUID' },
        severity: {
          type: 'string',
          enum: ['BLOCKER', 'CRITICAL', 'MAJOR', 'MEDIUM', 'MINOR'],
          description: 'Filter findings by severity level',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'erppreflight_explain_finding',
    description: 'Fetch deep remediation guide, affected SAP objects, and cryptographic evidence for a finding.',
    inputSchema: {
      type: 'object',
      properties: {
        findingId: { type: 'string', description: 'The finding UUID' },
      },
      required: ['findingId'],
    },
  },
  {
    name: 'erppreflight_search_knowledge',
    description: 'Search official SAP knowledge, Clean Core Tier 1/2/3 rules, successor APIs, and migration notes.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "direct insert into BKPF" or "OPD email configuration"' },
        targetRelease: { type: 'string', description: 'Target SAP release, e.g. "S4H_2023"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'erppreflight_lookup_object',
    description: 'Lookup an SAP technical object (table, view, BAPI, class, form) for Clean Core classification.',
    inputSchema: {
      type: 'object',
      properties: {
        objectName: { type: 'string', description: 'SAP object name, e.g. "MARA", "BKPF", "BAPI_PO_CREATE1"' },
      },
      required: ['objectName'],
    },
  },
  {
    name: 'erppreflight_compare_releases',
    description: 'Compare release compatibility matrix and breaking changes between two SAP releases.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceRelease: { type: 'string', description: 'e.g. "ECC_608"' },
        targetRelease: { type: 'string', description: 'e.g. "S4H_2023"' },
      },
      required: ['sourceRelease', 'targetRelease'],
    },
  },
  {
    name: 'erppreflight_propose_change',
    description: 'Submit an architectural or code change proposal to the Agentic Change Gate for What-If preflight verification.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project UUID' },
        name: { type: 'string', description: 'Descriptive title of the proposed change' },
        description: { type: 'string', description: 'Technical rationale and context' },
        targetEnvironment: { type: 'string', default: 'QA', description: 'Target SAP tier (DEV, QA, PROD)' },
        targetRelease: { type: 'string', default: 'S4H_2023' },
        proposedChanges: {
          type: 'array',
          description: 'List of changes, e.g. [{ type: "REMOVE_CUSTOM_FIELD", targetObject: "YY1_CLASS" }]',
        },
      },
      required: ['projectId', 'name', 'proposedChanges'],
    },
  },
  {
    name: 'erppreflight_simulate_changeset',
    description: 'Trigger deterministic What-If blast radius simulation for a proposed ChangeSet.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project UUID' },
        changesetId: { type: 'string', description: 'The ChangeSet UUID' },
      },
      required: ['projectId', 'changesetId'],
    },
  },
  {
    name: 'erppreflight_generate_test',
    description: 'Generate an automated preflight regression test case for a verified finding.',
    inputSchema: {
      type: 'object',
      properties: {
        findingId: { type: 'string', description: 'The finding UUID' },
      },
      required: ['findingId'],
    },
  },
  {
    name: 'erppreflight_get_status',
    description: 'Check live operational status of ERP Preflight engines, queues, and security gates.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

async function handleToolCall(name, args) {
  switch (name) {
    case 'erppreflight_list_projects': {
      const projects = await apiRequest('/projects');
      return projects.map((p) => ({
        id: p.id,
        name: p.name,
        targetRelease: p.target_release || p.targetRelease,
        createdAt: p.created_at || p.createdAt,
      }));
    }

    case 'erppreflight_get_findings': {
      let query = `?projectId=${encodeURIComponent(args.projectId)}`;
      if (args.severity) query += `&severity=${encodeURIComponent(args.severity)}`;
      const res = await apiRequest(`/findings${query}`);
      return res.items || res;
    }

    case 'erppreflight_explain_finding': {
      return await apiRequest(`/findings/${encodeURIComponent(args.findingId)}`);
    }

    case 'erppreflight_search_knowledge': {
      return await apiRequest('/knowledge/search', {
        method: 'POST',
        body: JSON.stringify({ query: args.query, targetRelease: args.targetRelease || 'S4H_2023' }),
      });
    }

    case 'erppreflight_lookup_object': {
      return await apiRequest(`/knowledge/object/${encodeURIComponent(args.objectName)}`);
    }

    case 'erppreflight_compare_releases': {
      return await apiRequest('/knowledge/compare', {
        method: 'POST',
        body: JSON.stringify({
          sourceRelease: args.sourceRelease,
          targetRelease: args.targetRelease,
        }),
      });
    }

    case 'erppreflight_propose_change': {
      return await apiRequest(`/projects/${encodeURIComponent(args.projectId)}/changesets`, {
        method: 'POST',
        body: JSON.stringify({
          name: args.name,
          description: args.description || '',
          targetEnvironment: args.targetEnvironment || 'QA',
          targetRelease: args.targetRelease || 'S4H_2023',
          proposedChanges: args.proposedChanges,
        }),
      });
    }

    case 'erppreflight_simulate_changeset': {
      return await apiRequest(
        `/projects/${encodeURIComponent(args.projectId)}/changesets/${encodeURIComponent(args.changesetId)}/simulate`,
        { method: 'POST' }
      );
    }

    case 'erppreflight_generate_test': {
      return await apiRequest('/mcp/call', {
        method: 'POST',
        body: JSON.stringify({
          name: 'generate_test',
          arguments: { findingId: args.findingId },
        }),
      });
    }

    case 'erppreflight_get_status': {
      return await apiRequest('/health/liveness');
    }

    default:
      throw new Error(`Unknown ERP Preflight tool: ${name}`);
  }
}

function sendResponse(id, result, error = null) {
  const response = {
    jsonrpc: '2.0',
    id,
    ...(error ? { error } : { result }),
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    if (!line.trim()) return;

    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      sendResponse(null, null, { code: -32700, message: 'Parse error: Invalid JSON' });
      return;
    }

    const { id, method, params } = message;

    // Handle JSON-RPC Notifications
    if (id === undefined || id === null) {
      if (method === 'notifications/initialized') {
        // Client confirmed initialization
      }
      return;
    }

    try {
      switch (method) {
        case 'initialize': {
          sendResponse(id, {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'erp-preflight-mcp',
              version: '1.0.0',
            },
          });
          break;
        }

        case 'tools/list': {
          sendResponse(id, {
            tools: MCP_TOOLS,
          });
          break;
        }

        case 'tools/call': {
          const toolName = params?.name;
          const toolArgs = params?.arguments || {};

          try {
            const data = await handleToolCall(toolName, toolArgs);
            sendResponse(id, {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(data, null, 2),
                },
              ],
            });
          } catch (toolErr) {
            sendResponse(id, {
              content: [
                {
                  type: 'text',
                  text: `Tool Execution Error: ${toolErr.message}`,
                },
              ],
              isError: true,
            });
          }
          break;
        }

        case 'ping': {
          sendResponse(id, {});
          break;
        }

        default: {
          sendResponse(id, null, {
            code: -32601,
            message: `Method not found: ${method}`,
          });
          break;
        }
      }
    } catch (err) {
      sendResponse(id, null, {
        code: -32603,
        message: `Internal server error: ${err.message}`,
      });
    }
  });

  // Handle process signals
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

if (require.main === module) {
  main();
}

module.exports = { MCP_TOOLS, handleToolCall };
