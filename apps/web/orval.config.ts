import { defineConfig } from 'orval';

export default defineConfig({
  api: {
    input: {
      target:
        process.env.OPENAPI_SPEC_URL ||
        '../../apps/api/openapi.json',
    },
    output: {
      mode: 'tags-split',
      target: './src/lib/api/generated/endpoints',
      schemas: './src/lib/api/generated/models',
      client: 'react-query',
      mock: false,
      clean: false,
      override: {
        mutator: {
          path: './src/lib/api/custom-instance.ts',
          name: 'customInstance',
        },
        query: {
          version: 5,
          signal: true,
        },
      },
    },
  },
});
