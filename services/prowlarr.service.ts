"use strict";
import { Context, Service, ServiceBroker, ServiceSchema, Errors } from "moleculer";
import axios from "axios";

export default class ProwlarrService extends Service {
	// @ts-ignore
	public constructor(
		public broker: ServiceBroker,
		schema: ServiceSchema<{}> = { name: "prowlarr" },
	) {
		super(broker);
		this.parseServiceSchema({
			name: "prowlarr",
			mixins: [],
			hooks: {},
			actions: {
				connect: {
					rest: "POST /connect",
					handler: async (
						ctx: Context<{
							host: string;
							port: string;
							apiKey: string;
						}>,
					) => {
						const { host, port, apiKey } = ctx.params;
						const result = await axios.request({
							url: `http://${host}:${port}/api`,
							method: "GET",
							headers: {
								"X-Api-Key": apiKey,
							},
						});
						console.log(result.data);
					},
				},
				getIndexers: {
					rest: "GET /indexers",
					handler: async (
						ctx: Context<{ host: string; port: string; apiKey: string }>,
					) => {
						const { host, port, apiKey } = ctx.params;
						const result = await axios.request({
							url: `http://${host}:${port}/api/v1/indexer`,
							method: "GET",
							headers: {
								"X-Api-Key": apiKey,
							},
						});
						return result.data;
					},
				},
				search: {
					rest: "GET /search",
					handler: async (
						ctx: Context<{
							host: string;
							port: string;
							apiKey: string;
							query: string;
							type: string;
							indexerIds: string;
							categories: string;
							limit: number;
							offset: number;
						}>,
					) => {
						const {
							indexerIds,
							categories,
							host,
							port,
							apiKey,
							query,
							type,
							limit,
							offset,
						} = ctx.params;

						const indexers = indexerIds.split(",").map((index) => parseInt(index, 10));
						const searchCategories = categories
							.split(",")
							.map((category) => parseInt(category, 10));

						const result = await axios({
							url: `http://${host}:${port}/api/v1/search`,
							method: "GET",
							params: {
								query,
								type,
								indexers,
								searchCategories,
								limit,
								offset,
							},
							headers: {
								Accept: "application/json",
								"X-Api-Key": `${apiKey}`,
							},
						});
						console.log(result);
						return result.data;
					},
				},
				ping: {
					rest: "GET /ping",
					handler: async (ctx: Context<{}>) => {
						const foo = await axios.request({
							url: "http://192.168.1.183:9696/ping",
							method: "GET",
							headers: {
								Accept: "application/json",
								"X-Api-Key": "163ef9a683874f65b53c7be87354b38b",
							},
						});
						console.log(foo.data);
						return true;
					},
				},
			},
			methods: {},
		});
	}
}
