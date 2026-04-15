import { makeExecutableSchema } from "@graphql-tools/schema";
import type { GraphQLSchema } from "graphql";
import { graphql } from "graphql";
import type { Context, ServiceBroker } from "moleculer";
import { Service } from "moleculer";
import { resolvers } from "../models/graphql/resolvers";
import { typeDefs } from "../models/graphql/typedef";

interface GraphQLParams {
	query: string;
	variables?: Record<string, unknown>;
	operationName?: string;
}

export default class GraphQLService extends Service {
	private graphqlSchema!: GraphQLSchema;

	constructor(broker: ServiceBroker) {
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
					async handler(ctx: Context<GraphQLParams>) {
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
