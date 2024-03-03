"use strict";
import { Context, Service, ServiceBroker, ServiceSchema, Errors } from "moleculer";
import { qBittorrentClient } from "@robertklep/qbittorrent";
import parseTorrent from "parse-torrent";
import { readFileSync, writeFileSync } from "fs";

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
						console.log(this.meta);
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
				addTorrent: {
					rest: "POST /addTorrent",
					handler: async (
						ctx: Context<{
							torrentToDownload: any;
							comicObjectId: string;
						}>,
					) => {
						try {
							const { torrentToDownload, comicObjectId } = ctx.params;
							console.log(torrentToDownload);
							const response = await fetch(torrentToDownload, {
								method: "GET",
							});
							// Read the buffer to a file
							const buffer = await response.arrayBuffer();
							writeFileSync(`mithrandir.torrent`, Buffer.from(buffer));
							// Add the torrent to qbittorrent's queue, paused.
							const result = await this.meta.torrents.add({
								torrents: {
									buffer: readFileSync("mithrandir.torrent"),
								},
								// start this torrent in a paused state (see Torrent type for options)
								paused: true,
							});
							const { name, infoHash, announce } = parseTorrent(
								readFileSync("mithrandir.torrent"),
							);
							await this.broker.call("library.applyTorrentDownloadMetadata", {
								name,
								torrentToDownload,
								comicObjectId,
								announce,
								infoHash,
							});
							return {
								result,
							};
						} catch (err) {
							console.error(err);
						}
					},
				},
				getTorrents: {
					rest: "POST /getTorrents",
					handler: async (ctx: Context<{}>) => {
						return await this.meta.torrents.info();
					},
				},
			},
			methods: {},
		});
	}
}
