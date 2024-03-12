import { readFileSync, writeFileSync } from "fs";
import { qBittorrentClient } from "@robertklep/qbittorrent";
import type { Context, ServiceBroker, ServiceSchema } from "moleculer";
import { Errors, Service } from "moleculer";
import parseTorrent from "parse-torrent";

export default class QBittorrentService extends Service {
	// @ts-ignore
	constructor(public broker: ServiceBroker, schema: ServiceSchema<{}> = { name: "qbittorrent" }) {
		super(broker);
		this.parseServiceSchema({
			name: "qbittorrent",
			mixins: [],
			hooks: {},
			settings: {},
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
						if (this.meta) {
							return { success: true, message: "Logged in successfully" };
						}
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
					handler: async (ctx: Context<{}>) => await this.meta.torrents.info(),
				},
				getTorrentDetails: {
					rest: "POST /getTorrentDetails",
					handler: async (ctx: Context<{ infoHashes: [string] }>) => {
						const infoHashes = Object.values(ctx.params);
						const torrentDetails = infoHashes.map(async (infoHash) => {
							return await this.meta.torrents.properties(infoHash);
						});
						return Promise.all(torrentDetails);
					},
				},
				checkForDeletedTorrents: {
					rest: "GET /checkForDeletedTorrents",
					handler: async (ctx: Context<{ infoHashes: [string] }>) => {
						await this.broker.call("qbittorrent.connect", {
							hostname: "localhost",
							protocol: "http",
							port: "8080",
							username: "admin",
							password: "password",
						});
						const torrents: any = await this.broker.call("qbittorrent.getTorrents", {});
						const deletedTorrents = this.detectDeletedTorrents(
							torrents.map((torrent: any) => torrent.hash),
						);
						return deletedTorrents;
					},
				},
			},
			methods: {
				detectDeletedTorrents(currentHashes) {},
			},
			async started() {},
		});
	}
}
