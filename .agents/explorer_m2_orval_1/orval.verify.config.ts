export default {
  api: {
    input: {
      target: './openapi-sample.json',
    },
    output: {
      mode: 'tags-split',
      target: './test-verify/endpoints',
      schemas: './test-verify/models',
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
          useQuery: true,
          useMutation: true,
          signal: true,
        },
      },
    },
  },
};
