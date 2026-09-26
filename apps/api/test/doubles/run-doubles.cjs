#!/usr/bin/env node
/* eslint-disable */
/**
 * Starts every contract test double on a routable interface over HTTPS (with a
 * throwaway CA) for live verification of an API instance running with
 * NODE_ENV=production. Writes the endpoints + credentials to --out (JSON).
 *
 *   node apps/api/test/doubles/run-doubles.cjs --host 172.17.0.1 --base-port 3710 \
 *        --certs /tmp/erppf-certs --out /tmp/erppf-doubles.json
 *
 * Start the API with NODE_EXTRA_CA_CERTS=<certs>/ca.pem and GIT_SSL_CAINFO=<certs>/ca.pem,
 * CONNECTOR_ALLOW_PRIVATE_NETWORKS=true, WEBHOOK_ALLOW_PRIVATE_NETWORKS=true,
 * SSO_ALLOW_PRIVATE_NETWORKS=true and SSO_DNS_SERVERS=<host>:<base+9>.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const d = require('./doubles.cjs');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

(async () => {
  const host = arg('host', '127.0.0.1');
  const base = Number(arg('base-port', '3710'));
  const certDir = arg('certs', path.join(os.tmpdir(), 'erppf-doubles-certs'));
  const outFile = arg('out', path.join(os.tmpdir(), 'erppf-doubles.json'));
  const tls = d.createTestCertificates([host, 'localhost', '127.0.0.1'], certDir);
  const common = { host, publicHost: host, tls };

  const calm = await d.startCloudAlmDouble({ ...common, port: base });
  const jira = await d.startJiraDouble({ ...common, port: base + 1 });
  const ado = await d.startAzureDevOpsDouble({ ...common, port: base + 2 });
  const snow = await d.startServiceNowDouble({ ...common, port: base + 3 });
  const odata = await d.startODataDouble({ ...common, port: base + 4 });
  const idp = await d.startOidcIdp({ ...common, port: base + 5 });
  const webhook = await d.startRecorder({ ...common, port: base + 6 });
  const sentry = await d.startRecorder({ host, publicHost: host, port: base + 7 });
  const otlp = await d.startRecorder({ host, publicHost: host, port: base + 8 });
  const dns = await d.startDnsTxtServer({ host, port: base + 9 });

  // Bare abapGit repository served over git smart HTTPS
  const gitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'erppf-gitsrv-'));
  const work = path.join(gitRoot, 'work');
  fs.mkdirSync(path.join(work, 'src'), { recursive: true });
  fs.writeFileSync(path.join(work, '.abapgit.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><STARTING_FOLDER>/src/</STARTING_FOLDER></DATA></asx:values></asx:abap>\n');
  fs.writeFileSync(path.join(work, 'src', 'zcl_billing_output.clas.abap'), 'CLASS zcl_billing_output DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\n    METHODS dispatch.\nENDCLASS.\nCLASS zcl_billing_output IMPLEMENTATION.\n  METHOD dispatch.\n    UPDATE vbrk SET fksto = abap_true WHERE vbeln = \'0090000001\'.\n  ENDMETHOD.\nENDCLASS.\n');
  fs.writeFileSync(path.join(work, 'src', 'zcl_billing_output.clas.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS"/>\n');
  fs.writeFileSync(path.join(work, 'src', 'z_fi_repost.prog.abap'), "REPORT z_fi_repost.\nSELECT * FROM bkpf INTO TABLE @DATA(lt_bkpf) UP TO 10 ROWS.\nUPDATE bkpf SET bktxt = 'REPOST' WHERE belnr = '4900000001'.\nCALL FUNCTION 'RFC_READ_TABLE' EXPORTING query_table = 'USR02'.\n");
  const g = (...a) => execFileSync('git', a, { cwd: work, env: { ...process.env, HOME: gitRoot, GIT_CONFIG_NOSYSTEM: '1' } });
  g('init', '-q', '-b', 'main');
  g('-c', 'user.email=dev@acme.test', '-c', 'user.name=abapGit', 'add', '.');
  g('-c', 'user.email=dev@acme.test', '-c', 'user.name=abapGit', 'commit', '-q', '-m', 'abapGit export of package ZBILLING');
  execFileSync('git', ['clone', '-q', '--bare', work, path.join(gitRoot, 'zbilling.git')]);
  const git = await d.startGitHttpServer({ ...common, port: base + 10, projectRoot: gitRoot, token: 'git-read-token' });

  const info = {
    caFile: tls.ca,
    cloudAlm: { url: calm.url, tokenUrl: calm.tokenUrl, clientId: calm.clientId, clientSecret: calm.clientSecret, projects: calm.state.projects },
    jira: { url: jira.url, email: jira.email, apiToken: jira.apiToken, projectKey: 'SAPS4' },
    azureDevOps: { url: ado.url, organization: ado.organization, project: ado.project, pat: ado.pat },
    serviceNow: { url: snow.url, username: snow.username, password: snow.password },
    odata: { serviceRootUrl: odata.serviceRootUrl, username: odata.username, password: odata.password, url: odata.url },
    oidc: { issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret },
    webhook: { url: webhook.url },
    sentry: { dsn: `http://publickey@${host}:${base + 7}/4242`, url: sentry.url },
    otlp: { url: otlp.url },
    dns: { server: dns.server },
    git: { repositoryUrl: `${git.url}/zbilling.git`, token: 'git-read-token' },
  };
  fs.writeFileSync(outFile, JSON.stringify(info, null, 2));

  // Control plane (stdin-free): tiny HTTP API on base+11 to inspect recorder state / set DNS records.
  const http = require('node:http');
  http
    .createServer(async (req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        const send = (o) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(o));
        };
        if (req.url === '/dns' && req.method === 'POST') {
          dns.setTxt(body.name, body.values);
          return send({ ok: true });
        }
        if (req.url === '/webhook') return send(webhook.state.requests);
        if (req.url === '/sentry') return send(sentry.state.requests);
        if (req.url === '/otlp') return send(otlp.state.requests.map((r) => ({ url: r.url, bytes: r.body.length, contentType: r.headers['content-type'] })));
        if (req.url === '/webhook/fail' && req.method === 'POST') {
          webhook.state.failNext = Number(body.count || 1);
          return send({ ok: true });
        }
        if (req.url === '/calm/tasks') return send([...calm.state.tasks.values()]);
        res.writeHead(404);
        res.end();
      });
    })
    .listen(base + 11, host);

  console.log(`[doubles] running on ${host}:${base}-${base + 11}; endpoints written to ${outFile}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
