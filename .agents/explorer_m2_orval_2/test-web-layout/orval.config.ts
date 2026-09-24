export default {
  api: {
    input: {
      target: '../../explorer_m2_orval_1/openapi-sample.json',
    },
    output: {
      mode: 'tags-split',
      target: './src/lib/api/generated/endpoints',
      schemas: './src/lib/api/generated/models',
      client: 'react-query',
      mock: true,
      clean: true,
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
};
