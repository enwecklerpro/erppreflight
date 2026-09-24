export default {
  api: {
    input: {
      target: '../explorer_m2_orval_1/openapi-sample.json',
    },
    output: {
      mode: 'tags-split',
      target: './test-defaults/endpoints',
      schemas: './test-defaults/models',
      client: 'react-query',
      mock: true,
      clean: true,
      override: {
        mutator: {
          path: '../explorer_m2_orval_1/production-custom-instance.ts',
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
