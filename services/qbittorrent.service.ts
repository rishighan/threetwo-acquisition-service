"use strict";
import { Context, Service, ServiceBroker, ServiceSchema, Errors } from "moleculer";
import { qBittorrentClient } from "@robertklep/qbittorrent";
const { MoleculerError } = require("moleculer").Errors;

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

				getList: {
					rest: "GET /getTorrents",
					handler: async (ctx: Context<{}>) => {
						return await this.torrentClient.torrents.info()
					}
				}
			}, methods: {},
			async started(): Promise<any> {
				try {
					this.torrentClient = new qBittorrentClient("http://192.168.1.183:8089", "admin", "adminadmin");

				} catch (err) {
					throw new MoleculerError(err, 500, "QBITTORRENT_CONNECTION_ERROR", {
						data: err,
					});
				}

			}
		});
	}
}
