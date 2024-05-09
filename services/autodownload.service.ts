"use strict";
import { Context, Service, ServiceBroker, ServiceSchema, Errors } from "moleculer";
import io from "socket.io-client";

export default class AutoDownloadService extends Service {
	// @ts-ignore
	public constructor(
		public broker: ServiceBroker,
		schema: ServiceSchema<{}> = { name: "autodownload" },
	) {
		super(broker);
		this.parseServiceSchema({
			name: "autodownload",
			mixins: [],
			hooks: {},
			actions: {
				searchWantedComics: {
					rest: "POST /searchWantedComics",
					handler: async (ctx: Context<{}>) => {
						// 1.iterate through the wanted comic objects, and:
						// 1a. Orchestrate all issues from ComicVine if the entire volume is wanted
						// 1b. Just the issues in "wanted.issues[]"
						const wantedComics: any = await this.broker.call(
							"library.getComicsMarkedAsWanted",
							{},
						);

						// 2a. Get the list of hubs from AirDC++
						const data: any = await this.broker.call("settings.getSettings", {
							settingsKey: "directConnect",
						});
						const { hubs } = data?.client;
						console.log("HUBZZZZZ", hubs);
						// Iterate through the list of wanted comics
						wantedComics.forEach(async (comic: any) => {
							let issuesToSearch: any = [];
							if (comic.wanted.markEntireVolumeAsWanted) {
								// Fetch all issues from ComicVine if the entire volume is wanted
								issuesToSearch = await this.broker.call(
									"comicvine.getIssuesForVolume",
									{
										volumeId: comic.wanted.volume.id,
									},
								);
							} else if (comic.wanted.issues && comic.wanted.issues.length > 0) {
								// 1b. Just the issues in "wanted.issues[]"
								issuesToSearch = {
									issues: comic.wanted.issues,
									volumeName: comic.wanted.volume?.name,
								};
							}
							for (const issue of issuesToSearch.issues) {
								// 2. construct the search queries

								// 2b. for AirDC++ search, with the volume name, issueId and cover_date
								const { year } = this.parseStringDate(issue.coverDate);

								const dcppSearchQuery = {
									query: {
										pattern: `${issuesToSearch.volumeName.replace(/#/g, "")} ${
											issue.issueNumber
										} ${year}`,
										extensions: ["cbz", "cbr", "cb7"],
									},
									hub_urls: hubs.map((hub: any) => hub.value),
									priority: 5,
								};
								// Perform the AirDC++ search
								const dcppResults = await this.broker.call("socket.search", {
									query: dcppSearchQuery,
									config: {
										hostname: "localhost:5600",
										protocol: "http",
										username: "user",
										password: "pass",
									},
									namespace: "/automated",
								});
								this.socketIOInstance.on("searchResultUpdated", (data: any) => {
									console.log("Hyaar we go", data);
								});
								// const dcppResults = await ctx.call("airdcpp.search", {
								// 	dcppSearchQuery,
								// });

								// 2b. for Prowlarr search, with the volume name, issueId and cover_date
								const prowlarrQuery = {
									port: "9696",
									apiKey: "c4f42e265fb044dc81f7e88bd41c3367",
									offset: 0,
									categories: [7030],
									query: `${issuesToSearch.volumeName} ${issue.issueNumber} ${year}`,
									host: "localhost",
									limit: 100,
									type: "search",
									indexerIds: [2],
								};

								// Perform the Prowlarr search
								const prowlarrResults = await this.broker.call("prowlarr.search", {
									prowlarrQuery,
								});

								// Process results here or after the loop
								console.log("DCPP Results: ", dcppResults);
								console.log("Prowlarr Results: ", prowlarrResults);
							}
						});
					},
				},
				determineDownloadChannel: {
					rest: "POST /determineDownloadChannel",
					handler: async (ctx: Context<{}>) => {
						// 1. Parse the incoming search query
						// to make sure that it is well-formed
						// At the very least, it should have name, year, number
						// 2. Choose between download mediums based on user-preference?
						// possible choices are: DC++, Torrent
						// 3. Perform the search on those media with the aforementioned search query
						// 4. Choose a subset of relevant search results,
						// and score them
						// 5. Download the highest-scoring, relevant result
					},
				},
			},
			methods: {
				parseStringDate: (dateString: string) => {
					const date = new Date(dateString);

					// Get the year, month, and day
					const year = date.getFullYear(); // 2022
					const month = date.getMonth() + 1; // December is 11 in Date object (0-indexed), so add 1 to make it human-readable
					const day = date.getDate(); // 1
					return { year, month, day };
				},
			},
			async started() {
				this.socketIOInstance = io("ws://localhost:3001/automated", {
					transports: ["websocket"],
					withCredentials: true,
				});
				this.socketIOInstance.on("connect", (data: any) => {
					console.log("connected", data);
				});

				this.socketIOInstance.on("searchResultAdded", (data: any) => {
					console.log("Received searchResultUpdated event:", data);
				});
			},
		});
	}
}
