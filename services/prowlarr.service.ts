import axios from "axios";
import type { Context, ServiceBroker } from "moleculer";
import { Service } from "moleculer";

interface ConnectParams {
	host: string;
	port: string;
	apiKey: string;
}

interface ProwlarrQuery {
	host: string;
	port: string;
	apiKey: string;
	query: string;
	type: string;
	indexerIds: number[];
	categories: number[];
	limit: number;
	offset: number;
}

interface SearchParams {
	prowlarrQuery: ProwlarrQuery;
}

export default class ProwlarrService extends Service {
	// @ts-ignore -- Moleculer requires this constructor signature for service instantiation
	constructor(broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: "prowlarr",
			mixins: [],
			hooks: {},
			actions: {
				connect: {
					rest: "POST /connect",
					handler: async (ctx: Context<ConnectParams>) => {
						const { host, port, apiKey } = ctx.params;
						const result = await axios.request({
							url: `http://${host}:${port}/api`,
							method: "GET",
							headers: {
								"X-Api-Key": apiKey,
							},
						});
						this.logger.info(result.data);
					},
				},
				getIndexers: {
					rest: "GET /indexers",
					handler: async (ctx: Context<ConnectParams>) => {
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
					handler: async (ctx: Context<SearchParams>) => {
						const {
							prowlarrQuery: {
								indexerIds,
								categories,
								host,
								port,
								apiKey,
								query,
								type,
								limit,
								offset,
							},
						} = ctx.params;
						const indexer = indexerIds[0] ? indexerIds.length === 1 : indexerIds;
						const category = categories[0] ? categories.length === 1 : categories;
						const result = await axios({
							url: `http://${host}:${port}/api/v1/search`,
							method: "GET",
							params: {
								query,
								type,
								indexer,
								category,
								limit,
								offset,
							},
							headers: {
								Accept: "application/json",
								"X-Api-Key": `${apiKey}`,
							},
						});
						return result.data;
					},
				},
				ping: {
					rest: "GET /ping",
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					handler: async (ctx: Context<Record<string, never>>) => {
						const foo = await axios.request({
							url: "http://192.168.1.183:9696/ping",
							method: "GET",
							headers: {
								Accept: "application/json",
								"X-Api-Key": "163ef9a683874f65b53c7be87354b38b",
							},
						});
						this.logger.info(foo.data);
						return true;
					},
				},
			},
			methods: {},
		});
	}
}
