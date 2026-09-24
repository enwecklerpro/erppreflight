export default {
  api: {
    input: {
      target: process.env.OPENAPI_SPEC_URL || '../explorer_m2_orval_1/openapi-sample.json',
    },
    output: {
      mode: 'tags-split',
      target: './generated/endpoints',
      schemas: './generated/models',
      client: 'react-query',
      mock: true,
      clean: true,
      override: {
        mutator: {
          path: './production-custom-instance.ts',
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
