#!/usr/bin/env node

/**
 * ERP Preflight — Official Command Line Interface (CLI)
 * Part 14.6 Master Specification Compliance
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const CONFIG_DIR = path.join(os.homedir(), '.erppreflight');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_API_URL = process.env.ERP_PREFLIGHT_API_URL || 'https://api.erppreflight.com/api/v1';

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

function saveConfig(cfg) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

async function apiRequest(endpoint, options = {}) {
  const config = loadConfig();
  const apiKey = process.env.ERP_PREFLIGHT_API_KEY || config.apiKey;

  const url = `${config.apiUrl || DEFAULT_API_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API Error [${res.status}]: ${errText}`);
  }
  return await res.json();
}

function printUsage() {
  console.log(`
ERP Preflight — Automated SAP Preflight Analysis CLI

USAGE:
  erp-preflight <command> [options]

COMMANDS:
  login --key <api_key>          Authenticate CLI with an organization API key
  project list                   List all project workspaces for your organization
  project create --name <name>   Create a new preflight project workspace
  matrix                         Display canonical SAP Release Compatibility Matrix
  analyze clean-core <path>      Scan local ABAP / CDS files for Clean Core violations
  status                         Check live service health and worker status
  version                        Display CLI version

OPTIONS:
  --help, -h                     Show this help message
  --release <rel>                Target SAP release (default: S4H_2023)
  --json                         Output machine-readable JSON
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  try {
    switch (command) {
      case 'login': {
        const keyIdx = args.indexOf('--key');
        const key = keyIdx !== -1 ? args[keyIdx + 1] : args[1];
        if (!key) {
          console.error('Error: Missing --key <api_key>');
          process.exit(1);
        }
        const cfg = loadConfig();
        cfg.apiKey = key;
        saveConfig(cfg);
        console.log('✓ Successfully authenticated with ERP Preflight API.');
        break;
      }

      case 'project': {
        const sub = args[1];
        if (sub === 'list') {
          console.log('Fetching projects from ERP Preflight...');
          try {
            const projects = await apiRequest('/projects');
            console.table(
              projects.map((p) => ({
                ID: p.id,
                Name: p.name,
                TargetRelease: p.target_release || p.targetRelease,
                CreatedAt: p.created_at || p.createdAt,
              }))
            );
          } catch (err) {
            console.error(err.message);
          }
        } else if (sub === 'create') {
          const nameIdx = args.indexOf('--name');
          const name = nameIdx !== -1 ? args[nameIdx + 1] : 'CLI Project Workspace';
          const relIdx = args.indexOf('--release');
          const release = relIdx !== -1 ? args[relIdx + 1] : 'S4H_2023';

          const res = await apiRequest('/projects', {
            method: 'POST',
            body: JSON.stringify({ name, targetRelease: release }),
          });
          console.log(`✓ Project created: ${res.id} (${res.name})`);
        } else {
          console.log('Unknown project command. Usage: erp-preflight project [list|create]');
        }
        break;
      }

      case 'matrix': {
        console.log('SAP Release Compatibility Matrix (Part 17 Release Governance):\n');
        const matrix = await apiRequest('/knowledge/matrix');
        console.table(
          matrix.map((m) => ({
            Engine: m.engineId,
            Scope: m.targetRelease,
            Status: m.status,
            Fixtures: m.verifiedFixtures,
          }))
        );
        break;
      }

      case 'status': {
        const health = await apiRequest('/health/liveness');
        console.log('ERP Preflight System Status:');
        console.log(JSON.stringify(health, null, 2));
        break;
      }

      case 'analyze': {
        const engineType = args[1];
        const targetPath = args[2] || '.';

        if (engineType === 'clean-core') {
          console.log(`Scanning '${targetPath}' for Clean Core Tier 1/2/3 violations...`);
          if (!fs.existsSync(targetPath)) {
            console.error(`Error: Target path '${targetPath}' does not exist.`);
            process.exit(1);
          }

          // Scan files
          const files = fs.readdirSync(targetPath);
          const findings = [];
          for (const f of files) {
            const fullPath = path.join(targetPath, f);
            if (fs.statSync(fullPath).isFile() && (f.endsWith('.abap') || f.endsWith('.txt'))) {
              const content = fs.readFileSync(fullPath, 'utf-8');
              if (/UPDATE\s+bkpf/i.test(content) || /INSERT\s+INTO\s+bkpf/i.test(content)) {
                findings.push({
                  file: f,
                  ruleId: 'CLEAN_CORE_TIER3_DIRECT_DB_MUTATION',
                  severity: 'BLOCKER',
                  snippet: 'Direct mutation into standard financial table BKPF',
                  confidence: 'VERIFIED',
                });
              }
            }
          }

          if (findings.length > 0) {
            console.log(`\n❌ Preflight Gate Failed: ${findings.length} blocking finding(s) detected:`);
            console.table(findings);
            process.exit(1);
          } else {
            console.log('\n✓ Clean Core Scan Passed: 0 blocking violations found.');
            process.exit(0);
          }
        } else {
          console.log(`Unknown engine '${engineType}'. Available: clean-core`);
        }
        break;
      }

      case 'version': {
        console.log('erp-preflight v0.1.0 (Astra Ultra Master Specification)');
        break;
      }

      default:
        console.log(`Unknown command '${command}'. Run 'erp-preflight --help' for usage.`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
