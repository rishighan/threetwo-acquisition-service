"use strict";
import { Context, Service, ServiceBroker, ServiceSchema, Errors } from "moleculer";
import { qBittorrentClient } from "@robertklep/qbittorrent";

export default class QBittorrentService extends Service {
	// @ts-ignore
	public constructor(
		public broker: ServiceBroker,
		schema: ServiceSchema<{}> = { name: "qbittorrent" },
	) {
		super(broker);
		this.parseServiceSchema({
			name: "qbittorrent",
			mixins: [],
			hooks: {},
			actions: {
				connect: {
					rest: "POST /connect",
					handler: async (ctx: Context<{}>) => {
						const client = new qBittorrentClient(
							"http://127.0.0.1:8080",
							"admin",
							"adminadmin",
						);
						console.log(client);
						return { foo: "bar" };
					},
				},
			},
			methods: {},
		});
	}
}
