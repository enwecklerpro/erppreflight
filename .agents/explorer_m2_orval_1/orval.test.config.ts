export default {
  api: {
    input: {
      target: './openapi-sample.json',
    },
    output: {
      mode: 'tags-split',
      target: './test-output-mutator/endpoints',
      schemas: './test-output-mutator/models',
      client: 'react-query',
      mock: true,
      override: {
        mutator: {
          path: './custom-instance.ts',
          name: 'customInstance',
        },
        query: {
          version: 5,
          useQuery: true,
          useMutation: true,
        },
      },
    },
  },
};
