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
					handler: async (ctx: Context<{}>) => {
						const result = await axios.request({
							url: "http://192.168.1.183:9696/api",
							method: "GET",
							headers: {
								"X-Api-Key": "163ef9a683874f65b53c7be87354b38b",
							},
						});
						console.log(result.data);
					},
				},
				indexers: {
					rest: "GET /indexers",
					handler: async (ctx: Context<{}>) => {
						const result = await axios.request({
							url: "http://192.168.1.183:9696/api/v1/indexer",
							method: "GET",
							headers: {
								"X-Api-Key": "163ef9a683874f65b53c7be87354b38b",
							},
						});
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
