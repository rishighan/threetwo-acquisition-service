"use strict";
import { Context, Service, ServiceBroker, ServiceSchema, Errors } from "moleculer";
import axios from "axios";

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

						// Iterate through the list of wanted comics
						for (const comic of wantedComics) {
							let issuesToSearch: any = [];

							if (comic.wanted.markEntireVolumeAsWanted) {
								// 1a. Fetch all issues from ComicVine if the entire volume is wanted
								issuesToSearch = await this.broker.call(
									"comicvine.getIssuesForVolume",
									{
										volumeId: comic.wanted.volume.id,
									},
								);
							} else if (comic.wanted.issues && comic.wanted.issues.length > 0) {
								// 1b. Just the issues in "wanted.issues[]"
								issuesToSearch = comic.wanted.issues;
							}
							for (const issue of issuesToSearch) {
								// construct the search queries
							}
						}
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
			methods: {},
		});
	}
}
