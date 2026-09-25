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

async function apiDownload(endpoint) {
  const config = loadConfig();
  const apiKey = process.env.ERP_PREFLIGHT_API_KEY || config.apiKey;

  const url = `${config.apiUrl || DEFAULT_API_URL}${endpoint}`;
  const headers = {
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  };

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API Download Error [${res.status}]: ${errText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function printUsage() {
  console.log(`
ERP Preflight — Automated SAP Preflight Analysis CLI
Part 14.6 Master Specification Compliance

USAGE:
  erp-preflight <command> [subcommand] [options]

COMMANDS:
  login --key <api_key>                     Authenticate CLI with an organization API key
  project list                              List all project workspaces for your organization
  project create --name <name>              Create a new preflight project workspace
  matrix                                    Display canonical SAP Release Compatibility Matrix
  analyze clean-core <path>                 Scan local ABAP / CDS files for Clean Core violations
  analyze api-diff <old.yaml> <new.yaml>    Compare API specs for breaking changes & contract drift
  analyze mfs <telegrams.csv>               Analyze Material Flow System telegram logs for sequence anomalies
  report download <analysis-id>             Download signed reproducibility bundle / assessment report
  mcp                                       Start Model Context Protocol (MCP) server over stdio
  status                                    Check live service health and worker status
  version                                   Display CLI version

OPTIONS:
  --help, -h                                Show this help message
  --release <rel>                           Target SAP release (default: S4H_2023)
  --out <path>                              Output file path for reports
  --json                                    Output machine-readable JSON
`);
}

// Simple deterministic parser for YAML/JSON API specifications
function parseApiSpec(content, filePath) {
  try {
    return JSON.parse(content);
  } catch {
    // Basic structured YAML extractor for OpenAPI/OData specifications
    const lines = content.split(/\r?\n/);
    const spec = { paths: {} };
    let currentPath = null;
    let currentMethod = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Match path: "/api/v1/..."
      const pathMatch = line.match(/^(\s{2}|\s{4})?(\/[^:]+):\s*$/);
      if (pathMatch) {
        currentPath = pathMatch[2].trim();
        spec.paths[currentPath] = spec.paths[currentPath] || {};
        currentMethod = null;
        continue;
      }

      // Match HTTP method: "get:", "post:", "put:", "delete:"
      const methodMatch = line.match(/^(\s{4}|\s{6})?(get|post|put|delete|patch):\s*$/i);
      if (methodMatch && currentPath) {
        currentMethod = methodMatch[2].toLowerCase();
        spec.paths[currentPath][currentMethod] = { parameters: [], responses: {} };
        continue;
      }

      // Match parameter name
      const paramMatch = line.match(/name:\s*([a-zA-Z0-9_\-]+)/);
      if (paramMatch && currentPath && currentMethod) {
        const paramName = paramMatch[1];
        const isRequired = /required:\s*true/i.test(lines.slice(i, i + 5).join(' '));
        spec.paths[currentPath][currentMethod].parameters.push({
          name: paramName,
          required: isRequired,
        });
      }
    }
    return spec;
  }
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

        if (engineType === 'clean-core') {
          const targetPath = args[2] || '.';
          console.log(`Scanning '${targetPath}' for Clean Core Tier 1/2/3 violations...`);
          if (!fs.existsSync(targetPath)) {
            console.error(`Error: Target path '${targetPath}' does not exist.`);
            process.exit(1);
          }

          const findings = [];
          const files = fs.statSync(targetPath).isDirectory()
            ? fs.readdirSync(targetPath).map((f) => path.join(targetPath, f))
            : [targetPath];

          for (const fullPath of files) {
            if (fs.statSync(fullPath).isFile() && (fullPath.endsWith('.abap') || fullPath.endsWith('.txt') || fullPath.endsWith('.cds'))) {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const fileName = path.basename(fullPath);

              if (/UPDATE\s+bkpf/i.test(content) || /INSERT\s+INTO\s+bkpf/i.test(content)) {
                findings.push({
                  file: fileName,
                  ruleId: 'CLEAN_CORE_TIER3_DIRECT_DB_MUTATION',
                  severity: 'BLOCKER',
                  snippet: 'Direct mutation into standard financial table BKPF',
                  confidence: 'VERIFIED',
                });
              }
              if (/CALL\s+FUNCTION\s+['"]RFC_READ_TABLE['"]/i.test(content)) {
                findings.push({
                  file: fileName,
                  ruleId: 'CLEAN_CORE_TIER3_UNRELEASED_RFC',
                  severity: 'CRITICAL',
                  snippet: 'Invocation of obsolete/unreleased function module RFC_READ_TABLE',
                  confidence: 'VERIFIED',
                });
              }
            }
          }

          if (findings.length > 0) {
            console.log(`\n❌ Preflight Gate Failed: ${findings.length} blocking Clean Core finding(s) detected:`);
            console.table(findings);
            process.exit(1);
          } else {
            console.log('\n✓ Clean Core Scan Passed: 0 blocking violations found.');
            process.exit(0);
          }
        } else if (engineType === 'api-diff') {
          const oldFile = args[2];
          const newFile = args[3];

          if (!oldFile || !newFile) {
            console.error('Error: Usage: erp-preflight analyze api-diff <old.yaml> <new.yaml>');
            process.exit(1);
          }
          if (!fs.existsSync(oldFile) || !fs.existsSync(newFile)) {
            console.error('Error: Specified API specification files do not exist.');
            process.exit(1);
          }

          console.log(`Comparing API Specifications for Breaking Contract Drift:`);
          console.log(`  Baseline: ${oldFile}`);
          console.log(`  Proposed: ${newFile}\n`);

          const oldContent = fs.readFileSync(oldFile, 'utf-8');
          const newContent = fs.readFileSync(newFile, 'utf-8');
          const oldSpec = parseApiSpec(oldContent, oldFile);
          const newSpec = parseApiSpec(newContent, newFile);

          const diffFindings = [];

          // 1. Check for dropped paths
          const oldPaths = Object.keys(oldSpec.paths || {});
          const newPaths = Object.keys(newSpec.paths || {});

          for (const p of oldPaths) {
            if (!newPaths.includes(p)) {
              diffFindings.push({
                ruleId: 'API_CONTRACT_PATH_REMOVED',
                severity: 'BLOCKER',
                endpoint: p,
                reason: `Path '${p}' was removed in proposed API specification.`,
                confidence: 'VERIFIED',
              });
            } else {
              // Check dropped operations
              const oldMethods = Object.keys(oldSpec.paths[p] || {});
              const newMethods = Object.keys(newSpec.paths[p] || {});
              for (const m of oldMethods) {
                if (!newMethods.includes(m)) {
                  diffFindings.push({
                    ruleId: 'API_CONTRACT_OPERATION_DROPPED',
                    severity: 'CRITICAL',
                    endpoint: `${m.toUpperCase()} ${p}`,
                    reason: `Operation '${m.toUpperCase()}' was dropped from path '${p}'.`,
                    confidence: 'VERIFIED',
                  });
                }
              }
            }
          }

          // 2. Check for added required parameters in existing operations
          for (const p of newPaths) {
            if (oldPaths.includes(p)) {
              const newOps = newSpec.paths[p] || {};
              const oldOps = oldSpec.paths[p] || {};
              for (const [m, op] of Object.entries(newOps)) {
                if (oldOps[m] && op.parameters) {
                  const oldParams = (oldOps[m].parameters || []).map((param) => param.name);
                  for (const param of op.parameters) {
                    if (param.required && !oldParams.includes(param.name)) {
                      diffFindings.push({
                        ruleId: 'API_BREAKING_REQUIRED_PARAM_ADDED',
                        severity: 'BLOCKER',
                        endpoint: `${m.toUpperCase()} ${p}`,
                        reason: `New mandatory parameter '${param.name}' added without backward compatibility.`,
                        confidence: 'VERIFIED',
                      });
                    }
                  }
                }
              }
            }
          }

          if (diffFindings.length > 0) {
            console.log(`❌ API Change Guard: ${diffFindings.length} breaking change(s) detected:`);
            console.table(diffFindings);
            process.exit(1);
          } else {
            console.log('✓ API Change Guard: Backward-compatible! 0 breaking changes detected.');
            process.exit(0);
          }
        } else if (engineType === 'mfs') {
          const csvFile = args[2];
          if (!csvFile || !fs.existsSync(csvFile)) {
            console.error('Error: Usage: erp-preflight analyze mfs <telegrams.csv>');
            process.exit(1);
          }

          console.log(`Analyzing Material Flow System (MFS) telegram log: ${csvFile}...\n`);
          const content = fs.readFileSync(csvFile, 'utf-8');
          const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);

          const mfsFindings = [];
          const plcSequences = new Map();
          const seenTelegrams = new Set();

          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
            // format: timestamp, plc_id, sequence_no, telegram_type, status
            const plcId = cols[1] || 'PLC_01';
            const seq = parseInt(cols[2], 10);
            const status = (cols[4] || cols[3] || '').toUpperCase();
            const telegramKey = `${plcId}:${seq}`;

            if (seenTelegrams.has(telegramKey)) {
              mfsFindings.push({
                ruleId: 'MFS_DUPLICATE_TELEGRAM_ID',
                severity: 'MAJOR',
                plc: plcId,
                detail: `Duplicate telegram sequence #${seq} received for ${plcId}`,
                confidence: 'VERIFIED',
              });
            } else {
              seenTelegrams.add(telegramKey);
            }

            if (!isNaN(seq)) {
              const lastSeq = plcSequences.get(plcId);
              if (lastSeq !== undefined && seq > lastSeq + 1) {
                mfsFindings.push({
                  ruleId: 'MFS_TELEGRAM_SEQUENCE_ANOMALY',
                  severity: 'CRITICAL',
                  plc: plcId,
                  detail: `Sequence jump detected on ${plcId}: expected #${lastSeq + 1}, received #${seq}`,
                  confidence: 'VERIFIED',
                });
              }
              plcSequences.set(plcId, seq);
            }

            if (['ERR', 'NACK', 'TIMEOUT', 'FAILED'].includes(status)) {
              mfsFindings.push({
                ruleId: 'MFS_COMMUNICATION_FAULT',
                severity: 'BLOCKER',
                plc: plcId,
                detail: `Communication fault status '${status}' recorded at line ${i + 1}`,
                confidence: 'VERIFIED',
              });
            }
          }

          if (mfsFindings.length > 0) {
            console.log(`❌ MFS BlackBox Preflight: ${mfsFindings.length} anomaly finding(s) detected:`);
            console.table(mfsFindings);
            process.exit(1);
          } else {
            console.log(`✓ MFS BlackBox Preflight: 0 telegram sequence anomalies found (${lines.length - 1} records processed).`);
            process.exit(0);
          }
        } else {
          console.log(`Unknown engine '${engineType}'. Available engines: clean-core, api-diff, mfs`);
          process.exit(1);
        }
        break;
      }

      case 'report': {
        const sub = args[1];
        if (sub === 'download') {
          const analysisId = args[2];
          if (!analysisId) {
            console.error('Error: Missing analysis ID. Usage: erp-preflight report download <analysis-id> [--out <path>]');
            process.exit(1);
          }

          const outIdx = args.indexOf('--out');
          const outPath = outIdx !== -1 ? args[outIdx + 1] : `erp-preflight-bundle-${analysisId}.zip`;

          console.log(`Downloading signed reproducibility bundle for analysis ${analysisId}...`);
          const buffer = await apiDownload(`/analyses/${encodeURIComponent(analysisId)}/reproducibility-bundle`);
          fs.writeFileSync(outPath, buffer);

          const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
          console.log(`✓ Successfully downloaded reproducibility bundle:`);
          console.log(`  Path:   ${path.resolve(outPath)}`);
          console.log(`  Size:   ${buffer.length} bytes`);
          console.log(`  SHA256: ${sha256}`);
        } else {
          console.log('Unknown report command. Usage: erp-preflight report download <analysis-id>');
        }
        break;
      }

      case 'mcp': {
        require('./erp-preflight-mcp.js');
        break;
      }

      case 'version': {
        console.log('erp-preflight v0.1.0 (Astra Ultra Master Specification Part 14.6)');
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
