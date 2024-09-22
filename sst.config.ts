/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "genesiss-ai",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },

  


  async run() {

    const genesissapitable = new sst.aws.Dynamo("GenesissAPITable", {
      fields: {
        apiKey: "string",
      },
      primaryIndex: { hashKey: "apiKey"},
    })

    const bucket = new sst.aws.Bucket("GenesissBucket");

    const publicbucket = new sst.aws.Bucket("GenesissPublicBucket", {
      public: true
    });

    const vector = new sst.aws.Vector("GenesissVectorDB", {
      dimension: 768
    });

    const jinaapikey = new sst.Secret("JinaApiKey");
    const internalAPIKey = new sst.Secret("InternalAPIKey");
    const rtrolearn = new sst.Secret("RTRoleArn");
    const judge0apikey = new sst.Secret("Judge0APIKey")
    const replicateapikey = new sst.Secret("ReplicateAPIKey")

    new sst.aws.Nextjs("GenesissAI", {
      link: [genesissapitable, bucket, publicbucket, vector, jinaapikey, internalAPIKey, rtrolearn, judge0apikey, replicateapikey],
      transform: {
        server: {
          nodejs: {
            esbuild: {
              external: ['canvas'],
            }
          }
        }
      }
    });
  },
});
