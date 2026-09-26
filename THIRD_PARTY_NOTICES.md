# Third-Party Notices

> **Generated file — do not edit by hand.** Regenerate with
> `<analysis-service-python> scripts/generate-third-party-notices.py` after dependency changes.

ERP Preflight is built on the open-source packages listed below. Each package remains under
its own license; the license identifier shown is the one declared in the package metadata.
Full license texts are distributed inside each package (node_modules/<pkg>/LICENSE*, and the
`*.dist-info/licenses` directory of each Python distribution). Container base images and
infrastructure images (PostgreSQL/pgvector, Redis, MinIO, ClamAV) carry their own notices;
the CycloneDX SBOMs produced by `.github/workflows/docker.yml` and `release.yml` list every
OS and language package inside the shipped images.

## Licenses that need review (copyleft, dual-licensed or undeclared)

| Package | Version | Declared license |
|---|---|---|
| @img/sharp-libvips-linux-x64 | 1.3.3 | LGPL-3.0-or-later |
| @img/sharp-libvips-linuxmusl-x64 | 1.3.3 | LGPL-3.0-or-later |
| buffers | 0.1.1 | Unknown |
| elkjs | 0.12.0 | EPL-2.0 OR GPL-3.0-or-later |
| jszip | 3.10.2 | (MIT OR GPL-3.0-or-later) |
| pause | 0.0.1 | Unknown |
| certifi | 2026.7.22 | MPL-2.0 |

See SECURITY_REVIEW.md §5 for the assessment of these entries.

## Node.js production dependencies (apps/api, apps/web, apps/local-agent, packages/*)

457 packages.

| License | Packages |
|---|---|
| MIT | 352 |
| Apache-2.0 | 53 |
| ISC | 30 |
| BSD-3-Clause | 6 |
| BSD-2-Clause | 2 |
| LGPL-3.0-or-later | 2 |
| MIT/X11 | 2 |
| Unknown | 2 |
| (MIT AND Zlib) | 1 |
| (MIT OR GPL-3.0-or-later) | 1 |
| 0BSD | 1 |
| BlueOak-1.0.0 | 1 |
| CC-BY-4.0 | 1 |
| EPL-2.0 OR GPL-3.0-or-later | 1 |
| Python-2.0 | 1 |
| Unlicense | 1 |

### (MIT AND Zlib)

- pako 1.0.11 — https://github.com/nodeca/pako

### (MIT OR GPL-3.0-or-later)

- jszip 3.10.2 — https://github.com/Stuk/jszip#readme

### 0BSD

- tslib 2.8.1 — https://www.typescriptlang.org/

### Apache-2.0

- @aws-sdk/checksums 3.1001.1 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/checksums
- @aws-sdk/client-s3 3.1139.0 — https://github.com/aws/aws-sdk-js-v3/tree/main/clients/client-s3
- @aws-sdk/core 3.978.1 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/core
- @aws-sdk/credential-provider-env 3.972.72 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-env
- @aws-sdk/credential-provider-http 3.972.74 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-http
- @aws-sdk/credential-provider-ini 3.973.17 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-ini
- @aws-sdk/credential-provider-login 3.972.79 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-login
- @aws-sdk/credential-provider-node 3.972.84 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-node
- @aws-sdk/credential-provider-process 3.972.72 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-process
- @aws-sdk/credential-provider-sso 3.973.16 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-sso
- @aws-sdk/credential-provider-web-identity 3.972.78 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-web-identity
- @aws-sdk/middleware-sdk-s3 3.972.77 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/middleware-sdk-s3
- @aws-sdk/nested-clients 3.997.46 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages/nested-clients
- @aws-sdk/s3-request-presigner 3.1139.0 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages/s3-request-presigner
- @aws-sdk/signature-v4-multi-region 3.996.47 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages/signature-v4-multi-region
- @aws-sdk/token-providers 3.1138.0 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages/token-providers
- @aws-sdk/types 3.974.6 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/types
- @aws-sdk/xml-builder 3.972.41 — https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/xml-builder
- @aws/lambda-invoke-store 0.3.0 — https://github.com/awslabs/aws-lambda-invoke-store
- @img/sharp-linux-x64 0.35.4 — https://sharp.pixelplumbing.com
- @img/sharp-linuxmusl-x64 0.35.4 — https://sharp.pixelplumbing.com
- @playwright/test 1.63.0 — https://playwright.dev
- @scarf/scarf 1.4.0 — https://github.com/scarf-sh/scarf-js
- @smithy/core 3.35.0 — https://github.com/smithy-lang/smithy-typescript/tree/main/packages/core
- @smithy/credential-provider-imds 4.5.2 — https://github.com/smithy-lang/smithy-typescript/tree/main/packages/credential-provider-imds
- @smithy/fetch-http-handler 5.8.0 — https://github.com/smithy-lang/smithy-typescript/tree/main/packages/fetch-http-handler
- @smithy/node-http-handler 4.12.1 — https://github.com/smithy-lang/smithy-typescript/tree/main/packages/node-http-handler
- @smithy/signature-v4 5.7.3 — https://github.com/smithy-lang/smithy-typescript/tree/main/packages/signature-v4
- @smithy/types 4.19.0 — https://github.com/smithy-lang/smithy-typescript/tree/main/packages/types
- @swc/helpers 0.5.15 — https://swc.rs
- b4a 1.9.0 — https://github.com/holepunchto/b4a#readme
- bare-events 2.9.2 — https://github.com/holepunchto/bare-events#readme
- bare-fs 4.8.1 — https://github.com/holepunchto/bare-fs#readme
- bare-path 3.1.2 — https://github.com/holepunchto/bare-path#readme
- bare-stream 2.13.4 — https://github.com/holepunchto/bare-stream#readme
- bare-url 2.5.4 — https://github.com/holepunchto/bare-url
- baseline-browser-mapping 2.11.25 — https://github.com/web-platform-dx/baseline-browser-mapping#readme
- class-variance-authority 0.7.1 — https://github.com/joe-bell/cva#readme
- cluster-key-slot 1.1.1 — https://github.com/Salakar/cluster-key-slot#readme
- crc-32 1.2.2 — https://sheetjs.com/
- denque 2.1.0 — https://docs.page/invertase/denque
- detect-libc 2.1.2 — https://github.com/lovell/detect-libc#readme
- drizzle-orm 0.45.3 — https://orm.drizzle.team
- ecdsa-sig-formatter 1.0.11 — https://github.com/Brightspace/node-ecdsa-sig-formatter#readme
- events-universal 1.0.1 — https://github.com/holepunchto/events-universal#readme
- playwright 1.63.0 — https://playwright.dev
- playwright-core 1.63.0 — https://playwright.dev
- readdir-glob 1.1.3, 3.0.0 — https://github.com/Yqnn/node-readdir-glob
- reflect-metadata 0.2.2 — http://rbuckton.github.io/reflect-metadata
- rxjs 7.8.1 — https://rxjs.dev
- sharp 0.35.4 — https://sharp.pixelplumbing.com
- swagger-ui-dist 5.32.13 — https://github.com/swagger-api/swagger-ui#readme
- text-decoder 1.2.7 — https://github.com/holepunchto/text-decoder#readme

### BSD-2-Clause

- dotenv 16.6.1, 17.4.1 — https://github.com/motdotla/dotenv#readme
- dotenv-expand 12.0.3 — https://github.com/motdotla/dotenv-expand#readme

### BSD-3-Clause

- buffer-equal-constant-time 1.0.1 — https://github.com/goinstant/buffer-equal-constant-time#readme
- d3-ease 3.0.1 — https://d3js.org/d3-ease/
- duplexer2 0.1.4 — https://github.com/deoxxa/duplexer2#readme
- ieee754 1.2.1 — https://github.com/feross/ieee754#readme
- qs 6.16.0 — https://github.com/ljharb/qs
- source-map-js 1.2.1 — https://github.com/7rulnik/source-map-js

### BlueOak-1.0.0

- minimatch 10.2.6 — https://github.com/isaacs/minimatch#readme

### CC-BY-4.0

- caniuse-lite 1.0.30001810 — https://github.com/browserslist/caniuse-lite#readme

### EPL-2.0 OR GPL-3.0-or-later

- elkjs 0.12.0 — https://github.com/kieler/elkjs#readme

### ISC

- d3-color 3.1.0 — https://d3js.org/d3-color/
- d3-dispatch 3.0.1 — https://d3js.org/d3-dispatch/
- d3-drag 3.0.0 — https://d3js.org/d3-drag/
- d3-interpolate 3.0.1 — https://d3js.org/d3-interpolate/
- d3-selection 3.0.0 — https://d3js.org/d3-selection/
- d3-timer 3.0.1 — https://d3js.org/d3-timer/
- d3-transition 3.0.1 — https://d3js.org/d3-transition/
- d3-zoom 3.0.0 — https://d3js.org/d3-zoom/
- electron-to-chromium 1.5.438 — https://github.com/Kilian/electron-to-chromium#readme
- fs.realpath 1.0.0 — https://github.com/isaacs/fs.realpath#readme
- fstream 1.0.12 — https://github.com/npm/fstream#readme
- glob 7.2.3 — https://github.com/isaacs/node-glob#readme
- graceful-fs 4.2.11 — https://github.com/isaacs/node-graceful-fs#readme
- inflight 1.0.6 — https://github.com/isaacs/inflight
- inherits 2.0.4 — https://github.com/isaacs/inherits#readme
- iterare 1.2.1 — https://github.com/felixfbecker/iterare#readme
- listenercount 1.0.1 — https://github.com/jden/node-listenercount#readme
- lru-cache 5.1.1 — https://github.com/isaacs/node-lru-cache#readme
- lucide-react 0.475.0 — https://lucide.dev
- minimatch 3.1.5, 5.1.9 — https://github.com/isaacs/minimatch#readme
- once 1.4.0 — https://github.com/isaacs/once#readme
- pg-int8 1.0.1 — https://github.com/charmander/pg-int8#readme
- picocolors 1.1.1 — https://github.com/alexeyraspopov/picocolors#readme
- rimraf 2.7.1 — https://github.com/isaacs/rimraf#readme
- saxes 5.0.1 — https://github.com/lddubeau/saxes#readme
- semver 6.3.1, 7.8.5 — https://github.com/npm/node-semver#readme
- setprototypeof 1.2.0 — https://github.com/wesleytodd/setprototypeof
- split2 4.2.0 — https://github.com/mcollina/split2#readme
- wrappy 1.0.2 — https://github.com/npm/wrappy
- yallist 3.1.1 — https://github.com/isaacs/yallist#readme

### LGPL-3.0-or-later

- @img/sharp-libvips-linux-x64 1.3.3 — https://sharp.pixelplumbing.com
- @img/sharp-libvips-linuxmusl-x64 1.3.3 — https://sharp.pixelplumbing.com

### MIT

- @babel/code-frame 7.29.7 — https://babel.dev/docs/en/next/babel-code-frame
- @babel/compat-data 7.29.7 — https://github.com/babel/babel#readme
- @babel/core 7.29.7 — https://babel.dev/docs/en/next/babel-core
- @babel/generator 7.29.8 — https://babel.dev/docs/en/next/babel-generator
- @babel/helper-compilation-targets 7.29.7 — https://github.com/babel/babel#readme
- @babel/helper-globals 7.29.7 — https://github.com/babel/babel#readme
- @babel/helper-module-imports 7.29.7 — https://babel.dev/docs/en/next/babel-helper-module-imports
- @babel/helper-module-transforms 7.29.7 — https://babel.dev/docs/en/next/babel-helper-module-transforms
- @babel/helper-string-parser 7.29.7 — https://babel.dev/docs/en/next/babel-helper-string-parser
- @babel/helper-validator-identifier 7.29.7 — https://github.com/babel/babel#readme
- @babel/helper-validator-option 7.29.7 — https://github.com/babel/babel#readme
- @babel/helpers 7.29.7 — https://babel.dev/docs/en/next/babel-helpers
- @babel/parser 7.29.9 — https://babel.dev/docs/en/next/babel-parser
- @babel/runtime 7.29.7 — https://babel.dev/docs/en/next/babel-runtime
- @babel/template 7.29.7 — https://babel.dev/docs/en/next/babel-template
- @babel/traverse 7.29.8 — https://babel.dev/docs/en/next/babel-traverse
- @babel/types 7.29.8 — https://babel.dev/docs/en/next/babel-types
- @base-ui-components/react 1.0.0-rc.0 — https://base-ui.com
- @base-ui-components/utils 0.2.2 — https://github.com/mui/base-ui#readme
- @borewit/text-codec 0.2.2 — https://github.com/Borewit/text-codec#readme
- @fast-csv/format 4.3.5 — http://c2fo.github.com/fast-csv/packages/format
- @fast-csv/parse 4.3.6 — http://c2fo.github.com/fast-csv/packages/parse
- @floating-ui/core 1.8.0 — https://floating-ui.com
- @floating-ui/dom 1.8.0 — https://floating-ui.com
- @floating-ui/react-dom 2.1.9 — https://floating-ui.com/docs/react-dom
- @floating-ui/utils 0.2.12 — https://floating-ui.com
- @img/colour 1.1.0 — https://github.com/lovell/colour#readme
- @ioredis/commands 1.10.0 — https://github.com/ioredis/commands
- @jridgewell/gen-mapping 0.3.13 — https://github.com/jridgewell/sourcemaps/tree/main/packages/gen-mapping
- @jridgewell/remapping 2.3.5 — https://github.com/jridgewell/sourcemaps/tree/main/packages/remapping
- @jridgewell/resolve-uri 3.1.2 — https://github.com/jridgewell/resolve-uri#readme
- @jridgewell/sourcemap-codec 1.6.0 — https://github.com/jridgewell/sourcemaps/tree/main/packages/sourcemap-codec
- @jridgewell/trace-mapping 0.3.31 — https://github.com/jridgewell/sourcemaps/tree/main/packages/trace-mapping
- @lukeed/csprng 1.1.0 — https://github.com/lukeed/csprng#readme
- @microsoft/tsdoc 0.16.0 — https://tsdoc.org/
- @msgpackr-extract/msgpackr-extract-linux-x64 3.0.4 — https://github.com/kriszyp/msgpackr-extract#readme
- @nestjs/bull-shared 11.0.5 — https://github.com/nestjs/bull
- @nestjs/bullmq 11.0.5 — https://github.com/nestjs/bull
- @nestjs/common 11.2.6 — https://nestjs.com
- @nestjs/config 4.0.4 — https://github.com/nestjs/config#readme
- @nestjs/core 11.2.6 — https://nestjs.com
- @nestjs/jwt 11.0.2 — https://github.com/nestjs/jwt#readme
- @nestjs/mapped-types 2.1.1 — https://github.com/nestjs/mapped-types#readme
- @nestjs/passport 11.0.5 — https://github.com/nestjs/passport#readme
- @nestjs/platform-express 11.2.6 — https://nestjs.com
- @nestjs/swagger 11.4.7 — https://github.com/nestjs/swagger#readme
- @next/env 15.5.26 — https://github.com/vercel/next.js#readme
- @next/swc-linux-x64-gnu 15.5.26 — https://github.com/vercel/next.js#readme
- @next/swc-linux-x64-musl 15.5.26 — https://github.com/vercel/next.js#readme
- @noble/ciphers 1.3.0 — https://paulmillr.com/noble/
- @noble/hashes 1.8.0 — https://paulmillr.com/noble/
- @node-rs/argon2 2.2.1 — https://github.com/napi-rs/node-rs
- @node-rs/argon2-linux-x64-gnu 2.2.1 — https://github.com/napi-rs/node-rs
- @node-rs/argon2-linux-x64-musl 2.2.1 — https://github.com/napi-rs/node-rs
- @radix-ui/number 1.1.3 — https://radix-ui.com/primitives
- @radix-ui/primitive 1.1.7 — https://radix-ui.com/primitives
- @radix-ui/react-arrow 1.1.15 — https://radix-ui.com/primitives
- @radix-ui/react-collection 1.1.15 — https://radix-ui.com/primitives
- @radix-ui/react-compose-refs 1.1.5 — https://radix-ui.com/primitives
- @radix-ui/react-context 1.2.2 — https://radix-ui.com/primitives
- @radix-ui/react-dialog 1.1.23 — https://radix-ui.com/primitives
- @radix-ui/react-direction 1.1.4 — https://radix-ui.com/primitives
- @radix-ui/react-dismissable-layer 1.1.19 — https://radix-ui.com/primitives
- @radix-ui/react-dropdown-menu 2.1.24 — https://radix-ui.com/primitives
- @radix-ui/react-focus-guards 1.1.6 — https://radix-ui.com/primitives
- @radix-ui/react-focus-scope 1.1.16 — https://radix-ui.com/primitives
- @radix-ui/react-id 1.1.4 — https://radix-ui.com/primitives
- @radix-ui/react-menu 2.1.24 — https://radix-ui.com/primitives
- @radix-ui/react-popper 1.3.7 — https://radix-ui.com/primitives
- @radix-ui/react-portal 1.1.17 — https://radix-ui.com/primitives
- @radix-ui/react-presence 1.1.10 — https://radix-ui.com/primitives
- @radix-ui/react-primitive 2.1.10 — https://radix-ui.com/primitives
- @radix-ui/react-roving-focus 1.1.19 — https://radix-ui.com/primitives
- @radix-ui/react-select 2.3.7 — https://radix-ui.com/primitives
- @radix-ui/react-slot 1.3.3 — https://radix-ui.com/primitives
- @radix-ui/react-tabs 1.1.21 — https://radix-ui.com/primitives
- @radix-ui/react-tooltip 1.2.16 — https://radix-ui.com/primitives
- @radix-ui/react-use-callback-ref 1.1.4 — https://radix-ui.com/primitives
- @radix-ui/react-use-controllable-state 1.2.6 — https://radix-ui.com/primitives
- @radix-ui/react-use-effect-event 0.0.5 — https://radix-ui.com/primitives
- @radix-ui/react-use-is-hydrated 0.1.3 — https://radix-ui.com/primitives
- @radix-ui/react-use-layout-effect 1.1.4 — https://radix-ui.com/primitives
- @radix-ui/react-use-previous 1.1.4 — https://radix-ui.com/primitives
- @radix-ui/react-use-rect 1.1.4 — https://radix-ui.com/primitives
- @radix-ui/react-use-size 1.1.4 — https://radix-ui.com/primitives
- @radix-ui/react-visually-hidden 1.2.11 — https://radix-ui.com/primitives
- @radix-ui/rect 1.1.3 — https://radix-ui.com/primitives
- @tanstack/devtools-event-client 0.4.4, 0.5.0 — https://tanstack.com/devtools
- @tanstack/form-core 1.33.5 — https://tanstack.com/form
- @tanstack/pacer 0.22.0 — https://tanstack.com/pacer
- @tanstack/pacer-lite 0.1.1 — https://tanstack.com/pacer
- @tanstack/query-core 5.103.2 — https://tanstack.com/query
- @tanstack/react-form 1.33.5 — https://tanstack.com/form
- @tanstack/react-pacer 0.23.0 — https://tanstack.com/pacer
- @tanstack/react-query 5.103.2 — https://tanstack.com/query
- @tanstack/react-store 0.11.1 — https://tanstack.com/store
- @tanstack/react-table 8.21.3 — https://tanstack.com/table
- @tanstack/react-virtual 3.14.13 — https://tanstack.com/virtual
- @tanstack/store 0.11.1 — https://tanstack.com/store
- @tanstack/table-core 8.21.3 — https://tanstack.com/table
- @tanstack/virtual-core 3.17.11 — https://tanstack.com/virtual
- @tokenizer/inflate 0.4.1 — https://github.com/Borewit/tokenizer-inflate#readme
- @tokenizer/token 0.3.0 — https://github.com/Borewit/tokenizer-token#readme
- @types/d3-color 3.1.3 — https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/d3-color
- @types/d3-drag 3.0.7 — https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/d3-drag
- @types/d3-interpolate 3.0.4 — https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/d3-interpolate
- @types/d3-selection 3.0.12 — https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/d3-selection
- @types/d3-transition 3.0.9 — https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/d3-transition
- @types/d3-zoom 3.0.8 — https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/d3-zoom
- @types/jsonwebtoken 9.0.10 — https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/jsonwebtoken
- @types/ms 2.1.0 — https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/ms
- @types/node 14.18.63, 22.20.4 — https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node
- @types/pg 8.23.1 — https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/pg
- @types/react 19.3.0 — https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react
- @types/react-dom 19.3.0 — https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react-dom
- @types/validator 13.15.10 — https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/validator
- @xyflow/react 12.11.6 — https://reactflow.dev
- @xyflow/system 0.0.82 — https://github.com/xyflow/xyflow#readme
- abort-controller 3.0.0 — https://github.com/mysticatea/abort-controller#readme
- accepts 2.0.0 — https://github.com/jshttp/accepts#readme
- append-field 1.0.0 — https://github.com/LinusU/node-append-field#readme
- archiver 5.3.2, 8.0.0 — https://github.com/archiverjs/node-archiver
- archiver-utils 2.1.0, 3.0.4 — https://github.com/archiverjs/archiver-utils#readme
- aria-hidden 1.2.6 — https://github.com/theKashey/aria-hidden#readme
- async 3.2.6 — https://caolan.github.io/async/
- balanced-match 1.0.2, 4.0.4 — https://github.com/juliangruber/balanced-match#readme
- base64-js 0.0.8, 1.5.1 — https://github.com/beatgammit/base64-js
- binary 0.3.0 — https://github.com/substack/node-binary#readme
- bl 4.1.0 — https://github.com/rvagg/bl
- bluebird 3.4.7, 3.7.2 — https://github.com/petkaantonov/bluebird
- body-parser 2.3.0 — https://github.com/expressjs/body-parser#readme
- bowser 2.14.1 — https://github.com/bowser-js/bowser
- brace-expansion 1.1.21, 2.1.7, 5.0.12 — https://github.com/juliangruber/brace-expansion#readme
- brotli 1.3.3 — https://github.com/devongovett/brotli.js
- browserslist 4.29.0 — https://github.com/browserslist/browserslist#readme
- buffer 5.7.1, 6.0.3 — https://github.com/feross/buffer
- buffer-crc32 0.2.13, 1.0.0 — https://github.com/brianloveswords/buffer-crc32
- buffer-indexof-polyfill 1.0.2 — https://github.com/sarosia/buffer-indexof-polyfill#readme
- bullmq 5.81.5 — https://bullmq.io/
- busboy 1.6.0 — https://github.com/mscdex/busboy#readme
- bytes 3.1.2 — https://github.com/visionmedia/bytes.js#readme
- call-bind-apply-helpers 1.0.2 — https://github.com/ljharb/call-bind-apply-helpers#readme
- call-bound 1.0.4 — https://github.com/ljharb/call-bound#readme
- class-transformer 0.5.1 — https://github.com/typestack/class-transformer#readme
- class-validator 0.14.4 — https://github.com/typestack/class-validator#readme
- classcat 5.0.5 — https://github.com/jorgebucaran/classcat#readme
- client-only 0.0.1 — https://reactjs.org/
- clone 2.1.2 — https://github.com/pvorb/node-clone#readme
- clsx 2.1.1 — https://github.com/lukeed/clsx#readme
- compress-commons 4.1.2, 7.0.1 — https://github.com/archiverjs/node-compress-commons
- concat-map 0.0.1 — https://github.com/substack/node-concat-map#readme
- content-disposition 1.1.0 — https://github.com/jshttp/content-disposition#readme
- content-type 1.0.5, 2.1.0 — https://github.com/jshttp/content-type#readme
- convert-source-map 2.0.0 — https://github.com/thlorenz/convert-source-map
- cookie 0.7.2 — https://github.com/jshttp/cookie#readme
- cookie-signature 1.2.2 — https://github.com/visionmedia/node-cookie-signature#readme
- core-util-is 1.0.3 — https://github.com/isaacs/core-util-is#readme
- cors 2.8.6 — https://github.com/expressjs/cors#readme
- crc32-stream 4.0.3, 7.0.1 — https://github.com/archiverjs/node-crc32-stream
- cron-parser 4.9.0 — https://github.com/harrisiirak/cron-parser#readme
- csstype 3.2.3 — https://github.com/frenic/csstype#readme
- dayjs 1.11.23 — https://day.js.org
- debug 4.4.3 — https://github.com/debug-js/debug#readme
- depd 2.0.0 — https://github.com/dougwilson/nodejs-depd#readme
- detect-node-es 1.1.0 — https://github.com/thekashey/detect-node
- dfa 1.2.0 — https://github.com/devongovett/dfa#readme
- dunder-proto 1.0.1 — https://github.com/es-shims/dunder-proto#readme
- ee-first 1.1.1 — https://github.com/jonathanong/ee-first#readme
- encodeurl 2.0.0 — https://github.com/pillarjs/encodeurl#readme
- end-of-stream 1.4.5 — https://github.com/mafintosh/end-of-stream
- es-define-property 1.0.1 — https://github.com/ljharb/es-define-property#readme
- es-errors 1.3.0 — https://github.com/ljharb/es-errors#readme
- es-object-atoms 1.1.2 — https://github.com/ljharb/es-object-atoms#readme
- escalade 3.2.0 — https://github.com/lukeed/escalade#readme
- escape-html 1.0.3 — https://github.com/component/escape-html#readme
- etag 1.8.1 — https://github.com/jshttp/etag#readme
- event-target-shim 5.0.1 — https://github.com/mysticatea/event-target-shim
- events 3.3.0 — https://github.com/Gozala/events#readme
- exceljs 4.4.0 — https://github.com/exceljs/exceljs#readme
- express 5.2.1 — https://expressjs.com/
- fast-csv 4.3.6 — http://c2fo.github.com/fast-csv
- fast-deep-equal 3.1.3 — https://github.com/epoberezkin/fast-deep-equal#readme
- fast-fifo 1.3.2 — https://github.com/mafintosh/fast-fifo
- fast-safe-stringify 2.1.1 — https://github.com/davidmarkclements/fast-safe-stringify#readme
- fflate 0.8.3 — https://101arrowz.github.io/fflate
- file-type 21.3.4 — https://github.com/sindresorhus/file-type#readme
- finalhandler 2.1.1 — https://github.com/pillarjs/finalhandler#readme
- fontkit 2.0.4 — https://github.com/foliojs/fontkit#readme
- forwarded 0.2.0 — https://github.com/jshttp/forwarded#readme
- framer-motion 12.43.0 — https://github.com/motiondivision/motion#readme
- fresh 2.0.0 — https://github.com/jshttp/fresh#readme
- fs-constants 1.0.0 — https://github.com/mafintosh/fs-constants
- fs-extra 11.3.1 — https://github.com/jprichardson/node-fs-extra
- function-bind 1.1.2 — https://github.com/Raynos/function-bind
- gensync 1.0.0-beta.2 — https://github.com/loganfsmyth/gensync
- get-intrinsic 1.3.0 — https://github.com/ljharb/get-intrinsic#readme
- get-nonce 1.0.1 — https://github.com/theKashey/get-nonce
- get-proto 1.0.1 — https://github.com/ljharb/get-proto#readme
- gopd 1.2.0 — https://github.com/ljharb/gopd#readme
- has-symbols 1.1.0 — https://github.com/ljharb/has-symbols#readme
- hasown 2.0.4 — https://github.com/inspect-js/hasOwn#readme
- http-errors 2.0.1 — https://github.com/jshttp/http-errors#readme
- iconv-lite 0.7.3 — https://github.com/pillarjs/iconv-lite
- immediate 3.0.6 — https://github.com/calvinmetcalf/immediate#readme
- ioredis 5.11.1 — https://github.com/luin/ioredis#readme
- ipaddr.js 1.9.1 — https://github.com/whitequark/ipaddr.js#readme
- is-promise 4.0.0 — https://github.com/then/is-promise#readme
- is-stream 4.0.1 — https://github.com/sindresorhus/is-stream#readme
- isarray 1.0.0 — https://github.com/juliangruber/isarray
- js-tokens 4.0.0 — https://github.com/lydell/js-tokens#readme
- js-yaml 5.3.0 — https://github.com/nodeca/js-yaml#readme
- jsesc 3.1.0 — https://mths.be/jsesc
- json5 2.2.3 — http://json5.org/
- jsonfile 6.2.1 — https://github.com/jprichardson/node-jsonfile#readme
- jsonwebtoken 9.0.3 — https://github.com/auth0/node-jsonwebtoken#readme
- jwa 2.0.1 — https://github.com/brianloveswords/node-jwa#readme
- jws 4.0.1 — https://github.com/brianloveswords/node-jws#readme
- lazystream 1.0.1 — https://github.com/jpommerening/node-lazystream
- libphonenumber-js 1.13.13 — https://gitlab.com/catamphetamine/libphonenumber-js#readme
- lie 3.3.0 — https://github.com/calvinmetcalf/lie#readme
- linebreak 1.1.0 — https://github.com/devongovett/linebreaker
- load-esm 1.0.3 — https://github.com/Borewit/load-esm#readme
- lodash 4.18.1 — https://lodash.com/
- lodash.defaults 4.2.0 — https://lodash.com/
- lodash.difference 4.5.0 — https://lodash.com/
- lodash.escaperegexp 4.1.2 — https://lodash.com/
- lodash.flatten 4.4.0 — https://lodash.com/
- lodash.groupby 4.6.0 — https://lodash.com/
- lodash.includes 4.3.0 — https://lodash.com/
- lodash.isboolean 3.0.3 — https://lodash.com/
- lodash.isequal 4.5.0 — https://lodash.com/
- lodash.isfunction 3.0.9 — https://lodash.com/
- lodash.isinteger 4.0.4 — https://lodash.com/
- lodash.isnil 4.0.0 — https://lodash.com/
- lodash.isnumber 3.0.3 — https://lodash.com/
- lodash.isplainobject 4.0.6 — https://lodash.com/
- lodash.isstring 4.0.1 — https://lodash.com/
- lodash.isundefined 3.0.1 — https://lodash.com/
- lodash.once 4.1.1 — https://lodash.com/
- lodash.union 4.6.0 — https://lodash.com/
- lodash.uniq 4.5.0 — https://lodash.com/
- luxon 3.7.2 — https://github.com/moment/luxon#readme
- math-intrinsics 1.1.0 — https://github.com/es-shims/math-intrinsics#readme
- media-typer 0.3.0, 1.1.1 — https://github.com/jshttp/media-typer#readme
- merge-descriptors 2.0.0 — https://github.com/sindresorhus/merge-descriptors#readme
- mime-db 1.52.0, 1.54.0 — https://github.com/jshttp/mime-db#readme
- mime-types 2.1.35, 3.0.2 — https://github.com/jshttp/mime-types#readme
- minimist 1.2.8 — https://github.com/minimistjs/minimist
- mkdirp 0.5.6 — https://github.com/substack/node-mkdirp#readme
- motion 12.43.0 — https://github.com/motiondivision/motion#readme
- motion-dom 12.43.0 — https://github.com/motiondivision/motion#readme
- motion-utils 12.39.0 — https://github.com/motiondivision/motion#readme
- ms 2.1.3 — https://github.com/vercel/ms#readme
- msgpackr 2.0.5 — https://github.com/kriszyp/msgpackr#readme
- msgpackr-extract 3.0.4 — https://github.com/kriszyp/msgpackr-extract#readme
- multer 2.4.0 — https://github.com/expressjs/multer#readme
- nanoid 3.3.19 — https://github.com/ai/nanoid#readme
- negotiator 1.1.0 — https://github.com/jshttp/negotiator#readme
- next 15.5.26 — https://nextjs.org
- node-abort-controller 3.1.1 — https://github.com/southpolesteve/node-abort-controller#readme
- node-gyp-build-optional-packages 5.2.2 — https://github.com/prebuild/node-gyp-build
- node-int64 0.4.0 — https://github.com/broofa/node-int64#readme
- node-releases 2.0.57 — https://github.com/chicoxyzzy/node-releases#readme
- normalize-path 3.0.0 — https://github.com/jonschlinkert/normalize-path
- object-assign 4.1.1 — https://github.com/sindresorhus/object-assign#readme
- object-inspect 1.13.4 — https://github.com/inspect-js/object-inspect
- on-finished 2.4.1 — https://github.com/jshttp/on-finished#readme
- pako 0.2.9 — https://github.com/nodeca/pako
- parseurl 1.3.3 — https://github.com/pillarjs/parseurl#readme
- passport 0.7.0 — https://www.passportjs.org/
- passport-jwt 4.0.1 — https://github.com/mikenicholson/passport-jwt
- passport-strategy 1.0.0 — https://github.com/jaredhanson/passport-strategy#readme
- path-is-absolute 1.0.1 — https://github.com/sindresorhus/path-is-absolute#readme
- path-to-regexp 8.4.2 — https://github.com/pillarjs/path-to-regexp#readme
- pdfkit 0.20.2 — http://pdfkit.org/
- pg 8.23.0 — https://github.com/brianc/node-postgres
- pg-cloudflare 1.4.0 — https://github.com/brianc/node-postgres#readme
- pg-connection-string 2.14.0 — https://github.com/brianc/node-postgres/tree/master/packages/pg-connection-string
- pg-pool 3.14.0 — https://github.com/brianc/node-postgres/tree/master/packages/pg-pool#readme
- pg-protocol 1.16.0 — https://github.com/brianc/node-postgres#readme
- pg-types 2.2.0 — https://github.com/brianc/node-pg-types
- pgpass 1.0.5 — https://github.com/hoegaarden/pgpass#readme
- png-js 2.0.0 — https://github.com/devongovett/png.js#readme
- postcss 8.4.31 — https://postcss.org/
- postgres-array 2.0.0 — https://github.com/bendrucker/postgres-array#readme
- postgres-bytea 1.0.1 — https://github.com/bendrucker/postgres-bytea#readme
- postgres-date 1.0.7 — https://github.com/bendrucker/postgres-date#readme
- postgres-interval 1.2.0 — https://github.com/bendrucker/postgres-interval#readme
- process 0.11.10 — https://github.com/shtylman/node-process#readme
- process-nextick-args 2.0.1 — https://github.com/calvinmetcalf/process-nextick-args
- proxy-addr 2.0.8 — https://github.com/jshttp/proxy-addr#readme
- range-parser 1.3.0 — https://github.com/jshttp/range-parser#readme
- raw-body 3.0.2 — https://github.com/stream-utils/raw-body#readme
- react 19.3.0 — https://react.dev/
- react-dom 19.3.0 — https://react.dev/
- react-remove-scroll 2.7.2 — https://github.com/theKashey/react-remove-scroll#readme
- react-remove-scroll-bar 2.3.8 — https://github.com/theKashey/react-remove-scroll-bar#readme
- react-style-singleton 2.2.3 — https://github.com/theKashey/react-style-singleton#readme
- readable-stream 2.3.8, 3.6.2, 4.7.0 — https://github.com/nodejs/readable-stream
- redis-errors 1.2.0 — https://github.com/NodeRedis/redis-errors#readme
- redis-parser 3.0.0 — https://github.com/NodeRedis/node-redis-parser#readme
- reselect 5.3.0 — https://github.com/reduxjs/reselect#readme
- restructure 3.0.2 — https://github.com/devongovett/restructure
- router 2.2.0 — https://github.com/pillarjs/router#readme
- safe-buffer 5.1.2, 5.2.1 — https://github.com/feross/safe-buffer
- safer-buffer 2.1.2 — https://github.com/ChALkeR/safer-buffer#readme
- scheduler 0.28.0 — https://react.dev/
- send 1.2.1 — https://github.com/pillarjs/send#readme
- serve-static 2.2.1 — https://github.com/expressjs/serve-static#readme
- setimmediate 1.0.5 — https://github.com/YuzuJS/setImmediate#readme
- side-channel 1.1.1 — https://github.com/ljharb/side-channel#readme
- side-channel-list 1.0.1 — https://github.com/ljharb/side-channel-list#readme
- side-channel-map 1.0.1 — https://github.com/ljharb/side-channel-map#readme
- side-channel-weakmap 1.0.2 — https://github.com/ljharb/side-channel-weakmap#readme
- standard-as-callback 2.1.0 — https://github.com/luin/asCallback#readme
- statuses 2.0.2 — https://github.com/jshttp/statuses#readme
- streamsearch 1.1.0 — https://github.com/mscdex/streamsearch#readme
- streamx 2.28.1 — https://github.com/mafintosh/streamx
- string_decoder 1.1.1, 1.3.0 — https://github.com/nodejs/string_decoder
- strtok3 10.3.5 — https://github.com/Borewit/strtok3#readme
- styled-jsx 5.1.6 — https://github.com/vercel/styled-jsx#readme
- tabbable 6.5.0 — https://github.com/focus-trap/tabbable#readme
- tailwind-merge 3.7.0 — https://github.com/dcastil/tailwind-merge
- tar-stream 2.2.0, 3.2.1 — https://github.com/mafintosh/tar-stream
- teex 1.0.1 — https://github.com/mafintosh/teex
- tiny-inflate 1.0.3 — https://github.com/devongovett/tiny-inflate
- tmp 0.2.7 — http://github.com/raszi/node-tmp
- toidentifier 1.0.1 — https://github.com/component/toidentifier#readme
- token-types 6.1.2 — https://github.com/Borewit/token-types#readme
- type-is 1.6.18, 2.1.0 — https://github.com/jshttp/type-is#readme
- uid 2.0.2 — https://github.com/lukeed/uid#readme
- uint8array-extras 1.5.0 — https://github.com/sindresorhus/uint8array-extras#readme
- undici-types 6.21.0 — https://undici.nodejs.org
- unicode-properties 1.4.1 — https://github.com/devongovett/unicode-properties
- unicode-trie 2.0.0 — https://github.com/devongovett/unicode-trie
- universalify 2.0.1 — https://github.com/RyanZim/universalify#readme
- unpipe 1.0.0 — https://github.com/stream-utils/unpipe#readme
- unzipper 0.10.14, 0.12.5 — https://github.com/ZJONSSON/node-unzipper#readme
- update-browserslist-db 1.3.3 — https://github.com/browserslist/update-db#readme
- use-callback-ref 1.3.3 — https://github.com/theKashey/use-callback-ref#readme
- use-sidecar 1.1.3 — https://github.com/theKashey/use-sidecar
- use-sync-external-store 1.7.0 — https://github.com/react/react#readme
- util-deprecate 1.0.2 — https://github.com/TooTallNate/util-deprecate
- utils-merge 1.0.1 — https://github.com/jaredhanson/utils-merge#readme
- uuid 10.0.0, 8.3.2 — https://github.com/uuidjs/uuid#readme
- validator 13.15.35 — https://github.com/validatorjs/validator.js
- vary 1.1.2 — https://github.com/jshttp/vary#readme
- xmlchars 2.2.0 — https://github.com/lddubeau/xmlchars#readme
- xtend 4.0.2 — https://github.com/Raynos/xtend
- zip-stream 4.1.1, 7.0.5 — https://github.com/archiverjs/node-zip-stream
- zod 3.25.76 — https://zod.dev
- zustand 4.5.7 — https://github.com/pmndrs/zustand

### MIT/X11

- chainsaw 0.1.0 — https://github.com/substack/node-chainsaw#readme
- traverse 0.3.9 — https://github.com/substack/js-traverse#readme

### Python-2.0

- argparse 2.0.1 — https://github.com/nodeca/argparse#readme

### Unknown

- buffers 0.1.1 — https://github.com/substack/node-buffers#readme
- pause 0.0.1

### Unlicense

- big-integer 1.6.52 — https://github.com/peterolson/BigInteger.js#readme

## Python runtime dependencies (services/analysis-python/requirements.txt, transitive)

31 packages.

| License | Packages |
|---|---|
| MIT | 15 |
| BSD-3-Clause | 8 |
| Apache-2.0 | 2 |
| Apache-2.0 OR BSD-2-Clause | 1 |
| BSD-2-Clause | 1 |
| MIT License | 1 |
| MPL-2.0 | 1 |
| PSF-2.0 | 1 |
| PSFL | 1 |

### Apache-2.0

- pytest-asyncio 1.4.0 — https://github.com/pytest-dev/pytest-asyncio/issues
- python-multipart 0.0.32 — https://github.com/Kludex/python-multipart

### Apache-2.0 OR BSD-2-Clause

- packaging 26.3 — https://packaging.pypa.io/

### BSD-2-Clause

- Pygments 2.21.0 — https://pygments.org

### BSD-3-Clause

- click 8.5.0 — https://click.palletsprojects.com/page/changes/
- httpcore 1.0.9 — https://www.encode.io/httpcore
- httpx 0.28.1 — https://github.com/encode/httpx/blob/master/CHANGELOG.md
- idna 3.20 — https://github.com/kjd/idna/blob/master/HISTORY.md
- python-dotenv 1.2.3 — https://github.com/theskumar/python-dotenv
- starlette 1.7.0 — https://github.com/Kludex/starlette
- uvicorn 0.54.0 — https://uvicorn.dev/release-notes
- websockets 17.1 — https://github.com/python-websockets/websockets

### MIT

- annotated-doc 0.0.5 — https://github.com/fastapi/annotated-doc
- annotated-types 0.8.0 — https://github.com/annotated-types/annotated-types
- anyio 4.15.1 — https://anyio.readthedocs.io/en/latest/
- fastapi 0.141.1 — https://github.com/fastapi/fastapi
- h11 0.16.0 — https://github.com/python-hyper/h11
- httptools 0.8.0 — https://github.com/MagicStack/httptools
- iniconfig 2.3.0 — https://github.com/pytest-dev/iniconfig
- pluggy 1.6.0
- pydantic 2.13.5 — https://github.com/pydantic/pydantic
- pydantic-settings 2.15.0 — https://github.com/pydantic/pydantic-settings
- pydantic_core 2.46.5 — https://github.com/pydantic/pydantic
- pytest 9.1.1 — https://docs.pytest.org/en/stable/changelog.html
- PyYAML 6.0.3 — https://pyyaml.org/
- typing-inspection 0.4.4 — https://github.com/pydantic/typing-inspection
- watchfiles 1.3.0 — https://github.com/samuelcolvin/watchfiles

### MIT License

- uvloop 0.22.1 — https://github.com/MagicStack/uvloop

### MPL-2.0

- certifi 2026.7.22 — https://github.com/certifi/python-certifi

### PSF-2.0

- typing_extensions 4.16.0 — https://github.com/python/typing_extensions/issues

### PSFL

- defusedxml 0.7.1 — https://github.com/tiran/defusedxml
