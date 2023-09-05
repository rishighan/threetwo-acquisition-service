"use strict";
import { Context, Service, ServiceBroker, ServiceSchema, Errors } from "moleculer";
import { qBittorrentClient} from "@robertklep/qbittorrent";

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
						const torrentClient = new qBittorrentClient("http://192.168.1.183:8089", "admin", "adminadmin");
						const info = await torrentClient.torrents.info();

						return { foo: info };
					},
				},
				getList : {
					rest: "GET /getList",
					handler: async (ctx: Context<{}>) => {

					}
				}
			},
			methods: {},
		});
	}
}
