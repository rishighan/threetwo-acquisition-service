import { Service, ServiceBroker } from "moleculer";
import { graphql, GraphQLSchema } from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { typeDefs } from "../models/graphql/typedef";
import { resolvers } from "../models/graphql/resolvers";

export default class GraphQLService extends Service {
	private graphqlSchema!: GraphQLSchema;

	public constructor(broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: "acquisition-graphql",

			actions: {
				query: {
					params: {
						query: "string",
						variables: { type: "object", optional: true },
						operationName: { type: "string", optional: true },
					},
					async handler(ctx: any) {
						const { query, variables, operationName } = ctx.params;
						return graphql({
							schema: this.graphqlSchema,
							source: query,
							variableValues: variables,
							operationName,
							contextValue: { broker: this.broker, ctx },
						});
					},
				},
			},

			started() {
				this.graphqlSchema = makeExecutableSchema({ typeDefs, resolvers });
				this.logger.info("Acquisition GraphQL service started");
			},
		});
	}
}
