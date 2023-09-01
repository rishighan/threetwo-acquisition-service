"use strict";
import { Context, Service, ServiceBroker, ServiceSchema, Errors } from "moleculer";

export default class TorrentService extends Service {
	// @ts-ignore
	public constructor(
		public broker: ServiceBroker,
		schema: ServiceSchema<{}> = { name: "torrent" },
	) {
		super(broker);
		this.parseServiceSchema({
			name: "torrent",
			mixins: [],
			hooks: {},
			actions: {},
			methods: {},
		});
	}
}
