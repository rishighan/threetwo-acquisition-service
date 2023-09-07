"use strict";
import { Context, Service, ServiceBroker, ServiceSchema, Errors } from "moleculer";
const { MoleculerError } = require("moleculer").Errors;
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
				testConnection: {
					rest: "GET /testConnection",
					handler: async (ctx: Context<{}>) => {
						try {
							const result = await axios.request({
								url: `http://192.168.1.183:9696/api/`,
								method: `GET`,
								headers: { Accept: "application/json" },
								params: {
									apiKey: "163ef9a683874f65b53c7be87354b38b",
								}
							});

							return result.data;
						} catch(err) {
							console.log(err);
						}
					}
				},

			}, methods: {},
			async started(): Promise<any> {


			}
		});
	}
}
