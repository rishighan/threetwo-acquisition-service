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
				fetchQbittorrentCredentials: {
					rest: "GET /fetchQbittorrentCredentials",
					handler: async (ctx: Context<{}>) => {
						return await this.broker.call("settings.getSettings", {
							settingsKey: "bittorrent",
						});
					},
				},
				connect: {
					rest: "POST /connect",
					handler: async (
						ctx: Context<{
							username: string;
							password: string;
							hostname: string;
							port: string;
							protocol: string;
							name?: string;
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
				loginWithStoredCredentials: {
					rest: "POST /loginWithStoredCredentials",
					handler: async (ctx: Context<{}>) => {
						try {
							const result: any = await this.broker.call(
								"qbittorrent.fetchQbittorrentCredentials",
								{},
							);
							if (result !== undefined) {
								const {
									client: {
										host: { username, password, hostname, port, protocol },
									},
								} = result;

								const connection = await this.broker.call("qbittorrent.connect", {
									username,
									password,
									hostname,
									port,
									protocol,
								});
								console.log("qbittorrent connection details:");
								console.log(JSON.stringify(connection, null, 4));
								return connection;
							}
						} catch (err) {
							return {
								error: err,
								message:
									"Qbittorrent credentials not found, please configure them in Settings.",
							};
						}
					},
				},

				getClientInfo: {
					rest: "GET /getClientInfo",
					handler: async (ctx: Context<{}>) => {
						console.log(this.meta.app);
						await this.broker.call("qbittorrent.loginWithStoredCredentials", {});
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
							await this.broker.call("qbittorrent.loginWithStoredCredentials", {});
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
						await this.broker.call("qbittorrent.loginWithStoredCredentials", {});
						return await this.meta.torrents.info();
					},
				},
				getTorrentProperties: {
					rest: "POST /getTorrentProperties",
					handler: async (ctx: Context<{ infoHashes: string[] }>) => {
						try {
							const { infoHashes } = ctx.params;
							await this.broker.call("qbittorrent.loginWithStoredCredentials", {});
							return await this.meta.torrents.info({
								hashes: infoHashes,
							});
						} catch (err) {
							console.error("An error occurred:", err);
							// Consider handling the error more gracefully here, possibly returning an error response
							throw err; // or return a specific error object/message
						}
					},
				},
				getTorrentRealTimeStats: {
					rest: "POST /getTorrentRealTimeStats",
					handler: async (
						ctx: Context<{ infoHashes: { _id: string; infoHashes: string[] }[] }>,
					) => {
						const { infoHashes } = ctx.params;
						await this.broker.call("qbittorrent.loginWithStoredCredentials", {});

						try {
							// Increment rid for each call
							this.rid = typeof this.rid === "number" ? this.rid + 1 : 0;
							const data = await this.meta.sync.maindata(this.rid);
							const torrentDetails: any = [];

							infoHashes.forEach(({ _id, infoHashes }) => {
								// Initialize an object to hold details for this _id
								const details: any = [];

								infoHashes.forEach((hash) => {
									// Assuming 'data.torrents[hash]' retrieves the details for the hash
									const torrent = data.torrents[hash];
									if (torrent) {
										details.push({
											torrent,
										});
									}
								});

								// If you have details for this _id, add them to the main array
								if (details.length > 0) {
									torrentDetails.push({
										_id,
										details,
									});
								}
							});
							// Update rid with the latest value if needed based on the response
							// Assuming `data.rid` contains the latest rid from the server
							if (data.rid !== undefined) {
								this.rid = data.rid;
								console.log(`rid is ${this.rid}`);
							}
							console.log(JSON.stringify(torrentDetails, null, 4));
							return torrentDetails;
						} catch (err) {
							this.logger.error(err);
							throw err;
						}
					},
				},
			},
			methods: {},
			async started() {
				console.log(`Initializing rid...`);
				this.rid = 0;
				console.log(`rid is ${this.rid}`);
			},
		});
	}
}
