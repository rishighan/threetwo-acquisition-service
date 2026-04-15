import { readFileSync, writeFileSync } from "fs";
import { qBittorrentClient } from "@robertklep/qbittorrent";
import type { Context, ServiceBroker } from "moleculer";
import { Service } from "moleculer";
import parseTorrent from "parse-torrent";

interface QBittorrentCredentials {
	client: {
		host: {
			username: string;
			password: string;
			hostname: string;
			port: string;
			protocol: string;
		};
	};
}

interface ConnectParams {
	username: string;
	password: string;
	hostname: string;
	port: string;
	protocol: string;
	name?: string;
}

interface AddTorrentParams {
	torrentToDownload: string;
	comicObjectId: string;
}

interface InfoHashesParams {
	infoHashes: string[];
}

interface TorrentRealTimeStatsParams {
	infoHashes: { _id: string; infoHashes: string[] }[];
}

interface TorrentDetail {
	torrent: Record<string, unknown>;
}

interface TorrentDetailsGroup {
	_id: string;
	details: TorrentDetail[];
}

interface SyncMaindata {
	torrents: Record<string, Record<string, unknown>>;
	rid?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QBittorrentMeta = any;

export default class QBittorrentService extends Service {
	private meta!: QBittorrentMeta;

	private rid = 0;

	// @ts-ignore -- Moleculer requires this constructor signature for service instantiation
	constructor(broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: "qbittorrent",
			mixins: [],
			hooks: {},
			settings: {},
			actions: {
				fetchQbittorrentCredentials: {
					rest: "GET /fetchQbittorrentCredentials",
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					handler: async (ctx: Context<Record<string, never>>) => this.broker.call("settings.getSettings", {
							settingsKey: "bittorrent",
						}),
				},
				connect: {
					rest: "POST /connect",
					handler: (ctx: Context<ConnectParams>) => {
						const { username, password, hostname, port, protocol } = ctx.params;

						// eslint-disable-next-line new-cap
						this.meta = new qBittorrentClient(
							`${protocol}://${hostname}:${port}`,
							`${username}`,
							`${password}`,
						);
						this.logger.info(this.meta);
						if (this.meta) {
							return { success: true, message: "Logged in successfully" };
						}
						return { success: false, message: "Failed to connect" };
					},
				},
				loginWithStoredCredentials: {
					rest: "POST /loginWithStoredCredentials",
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					handler: async (ctx: Context<Record<string, never>>) => {
						try {
							const result: QBittorrentCredentials | undefined = await this.broker.call(
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
								this.logger.info("qbittorrent connection details:");
								this.logger.info(JSON.stringify(connection, null, 4));
								return connection;
							}
							return {
								error: null,
								message: "Qbittorrent credentials not found.",
							};
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
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					handler: async (ctx: Context<Record<string, never>>) => {
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
					handler: async (ctx: Context<AddTorrentParams>) => {
						try {
							await this.broker.call("qbittorrent.loginWithStoredCredentials", {});
							const { torrentToDownload, comicObjectId } = ctx.params;
							this.logger.info(torrentToDownload);
							const response = await fetch(torrentToDownload, {
								method: "GET",
							});
							// Read the buffer to a file
							const buffer = await response.arrayBuffer();
							writeFileSync(`mithrandir.torrent`, new Uint8Array(buffer));
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
							this.logger.error(err);
							return {
								error: err,
								message: "Failed to add torrent",
							};
						}
					},
				},
				getTorrents: {
					rest: "POST /getTorrents",
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					handler: async (ctx: Context<Record<string, never>>) => {
						await this.broker.call("qbittorrent.loginWithStoredCredentials", {});
						return this.meta.torrents.info();
					},
				},
				getTorrentProperties: {
					rest: "POST /getTorrentProperties",
					handler: async (ctx: Context<InfoHashesParams>) => {
						try {
							const { infoHashes } = ctx.params;
							await this.broker.call("qbittorrent.loginWithStoredCredentials", {});
							return this.meta.torrents.info({
								hashes: infoHashes,
							});
						} catch (err) {
							this.logger.error("An error occurred:", err);
							// Consider handling the error more gracefully here, possibly returning an error response
							throw err; // or return a specific error object/message
						}
					},
				},
				getTorrentRealTimeStats: {
					rest: "POST /getTorrentRealTimeStats",
					handler: async (ctx: Context<TorrentRealTimeStatsParams>) => {
						const { infoHashes } = ctx.params;
						await this.broker.call("qbittorrent.loginWithStoredCredentials", {});

						try {
							// Increment rid for each call
							this.rid = typeof this.rid === "number" ? this.rid + 1 : 0;
							const data: SyncMaindata = await this.meta.sync.maindata(this.rid);
							const torrentDetails: TorrentDetailsGroup[] = [];

							infoHashes.forEach(({ _id, infoHashes: hashes }) => {
								// Initialize an object to hold details for this _id
								const details: TorrentDetail[] = [];

								hashes.forEach((hash) => {
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
								this.logger.info(`rid is ${this.rid}`);
							}
							this.logger.info(JSON.stringify(torrentDetails, null, 4));
							return torrentDetails;
						} catch (err) {
							this.logger.error(err);
							throw err;
						}
					},
				},
				determineDownloadApps: {
					rest: "",
					// 1. Parse the incoming search query
					// to make sure that it is well-formed
					// At the very least, it should have name, year, number
					// 2. Choose between download mediums based on user-preference?
					// possible choices are: DC++, Torrent
					// 3. Perform the search on those media with the aforementioned search query
					// 4. Choose a subset of relevant search results,
					// and score them
					// 5. Download the highest-scoring, relevant result
					handler: () => undefined,
				},
			},
			methods: {},
			started() {
				this.logger.info(`Initializing rid...`);
				this.rid = 0;
				this.logger.info(`rid is ${this.rid}`);
			},
		});
	}
}
