"use strict";
import { Context, Service, ServiceBroker, ServiceSchema, Errors } from "moleculer";

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
						return { foo: "bar" };
					},
				},
			},
			methods: {},
		});
	}
}
