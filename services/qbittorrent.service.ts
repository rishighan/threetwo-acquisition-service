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
					handler: async (
						ctx: Context<{
							username: string;
							password: string;
							hostname: string;
							port: string;
							protocol: string;
							name: string;
						}>,
					) => {
						const { username, password, hostname, port, protocol } = ctx.params;
						this.meta = new qBittorrentClient(
							`${protocol}://${hostname}:${port}`,
							`${username}`,
							`${password}`,
						);
					},
				},
				getClientInfo: {
					rest: "GET /getClientInfo",
					handler: async (ctx: Context<{}>) => {
						console.log(this.meta.app);
						return {
							buildInfo: await this.meta.app.buildInfo(),
							version: await this.meta.app.version(),
							webAPIVersion: await this.meta.app.webapiVersion(),
						};
					},
				},
			},
			methods: {},
		});
	}
}
