import type { EachMessagePayload } from "kafkajs";
import { Kafka, logLevel } from "kafkajs";
import { isNil, isUndefined } from "lodash";
import type { ServiceBroker, ServiceSchema } from "moleculer";
import { Service } from "moleculer";
import io from "socket.io-client";
import stringSimilarity from "string-similarity-alg";

interface SearchResult {
	groupedResult: { entityId: number; payload: any };
	updatedResult: { entityId: number; payload: any };
}

export default class ComicProcessorService extends Service {
	private kafkaConsumer: any;

	private socketIOInstance: any;

	private kafkaProducer: any;

	private prowlarrResultsMap: Map<string, any> = new Map();

	private airDCPPSearchResults: Map<number, any[]> = new Map();

	private issuesToSearch: any = [];

	// @ts-ignore: schema parameter is required by Service constructor
	constructor(
		public broker: ServiceBroker,
		schema: ServiceSchema<{}> = { name: "comicProcessor" },
	) {
		super(broker);
		this.parseServiceSchema({
			name: "comicProcessor",
			methods: {
				parseStringDate: (dateString: string) => {
					const date = new Date(dateString);
					return {
						year: date.getFullYear(),
						month: date.getMonth() + 1,
						day: date.getDate(),
					};
				},
				rankSearchResults: async (results: Map<number, any[]>, query: string) => {
					// Find the highest-ranked response based on similarity to the search string
					let highestRankedResult = null;
					let highestSimilarity = -1;

					results.forEach((resultArray) => {
						resultArray.forEach((result) => {
							const similarity = stringSimilarity("jaro-winkler").compare(
								result.name,
								query,
							);
							if (similarity > highestSimilarity) {
								highestSimilarity = similarity;
								highestRankedResult = { ...result, similarity };
							}
						});
					});

					return highestRankedResult;
				},
				processJob: async (job: any) => {
					try {
						this.logger.info("Processing job:", JSON.stringify(job, null, 2));
						// Get the hub to search on
						const settings: any = await this.broker.call("settings.getSettings", {
							settingsKey: "directConnect",
						});
						const hubs = settings.client.hubs.map((hub: any) => hub.value);

						const { comic } = job;
						const { volume, issues, markEntireVolumeWanted } = comic.wanted;

						// If entire volume is marked as wanted, get their details from CV
						if (markEntireVolumeWanted) {
							this.issuesToSearch = await this.broker.call(
								"comicvine.getIssuesForVolume",
								{ volumeId: volume.id },
							);
							this.logger.info(
								`The entire volume with id: ${volume.id} was marked as wanted.`,
							);
							this.logger.info(`Fetched issues for ${volume.id}:`);
							this.logger.info(`${this.issuesToSearch.length} issues to search`);
						} else {
							// Or proceed with `issues` from the wanted object.
							this.issuesToSearch = issues;
						}

						for (const issue of this.issuesToSearch) {
							// Query builder for DC++
							// 1. issue number
							const inferredIssueNumber =
								issue.issueNumber || issue.issue_number || "";
							// 2. year
							const { year } = this.parseStringDate(issue.coverDate);
							const inferredYear = year || issue.year || "";

							// 3. Orchestrate the query
							const dcppSearchQuery = {
								query: {
									pattern: `${volume.name
										.replace(/[^\w\s]/g, "")
										.replace(/\s+/g, " ")
										.trim()}`,
									extensions: ["cbz", "cbr", "cb7"],
								},
								hub_urls: hubs,
								priority: 5,
							};
							this.logger.info(
								"DC++ search query:",
								JSON.stringify(dcppSearchQuery, null, 4),
							);

							await this.broker.call("socket.search", {
								query: dcppSearchQuery,
								config: {
									hostname: "192.168.1.119:5600",
									protocol: "http",
									username: "admin",
									password: "password",
								},
								namespace: "/automated",
							});

							// 							const prowlarrResults = await this.broker.call("prowlarr.search", {
							// 								prowlarrQuery: {
							// 									port: "9696",
							// 									apiKey: "c4f42e265fb044dc81f7e88bd41c3367",
							// 									offset: 0,
							// 									categories: [7030],
							// 									query: `${volume.name} ${issue.issueNumber} ${year}`,
							// 									host: "localhost",
							// 									limit: 100,
							// 									type: "search",
							// 									indexerIds: [2],
							// 								},
							// 							});
							//
							// 							this.logger.info(
							// 								"Prowlarr search results:",
							// 								JSON.stringify(prowlarrResults, null, 4),
							// 							);

							// Store prowlarr results in map using unique key
							// const key = `${volume.name}-${issue.issueNumber}-${year}`;
							// this.prowlarrResultsMap.set(key, prowlarrResults);
						}
					} catch (error) {
						this.logger.error("Error processing job:", error);
					}
				},
				produceResultsToKafka: async (query: string, result: any[]): Promise<void> => {
					try {
						/*
							Match and rank
						*/
						const result = await this.rankSearchResults(
							this.airDCPPSearchResults,
							query,
						);
						console.log(JSON.stringify(result, null, 4));
						console.log("majori");
						/*
							Kafka messages need to be in a format that can be serialized to JSON, 
							and a Map is not directly serializable in a way that retains its structure, 
							hence why we use Object.fromEntries
						*/
						await this.kafkaProducer.send({
							topic: "comic-search-results",
							messages: [
								{
									value: JSON.stringify(result),
								},
							],
						});
						console.log(`Produced results to Kafka.`);

						// socket event for UI
						await this.broker.call("socket.broadcast", {
							namespace: "/",
							event: "searchResultsAvailable",
							args: [
								{
									query,
									result,
								},
							],
						});
					} catch (error) {
						this.logger.error("Error producing results to Kafka:", error);
					}
				},
			},
			async started() {
				const kafka = new Kafka({
					clientId: "comic-processor-service",
					brokers: ["localhost:9092"],
					logLevel: logLevel.INFO,
				});
				this.kafkaConsumer = kafka.consumer({ groupId: "comic-processor-group" });
				this.kafkaProducer = kafka.producer();

				this.kafkaConsumer.on("consumer.crash", (event: any) => {
					this.logger.error("Consumer crash:", event);
				});
				this.kafkaConsumer.on("consumer.connect", () => {
					this.logger.info("Consumer connected");
				});
				this.kafkaConsumer.on("consumer.disconnect", () => {
					this.logger.info("Consumer disconnected");
				});
				this.kafkaConsumer.on("consumer.network.request_timeout", () => {
					this.logger.warn("Consumer network request timeout");
				});

				await this.kafkaConsumer.connect();
				await this.kafkaProducer.connect();

				await this.kafkaConsumer.subscribe({
					topic: "comic-search-jobs",
					fromBeginning: true,
				});

				await this.kafkaConsumer.run({
					eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
						if (message.value) {
							const job = JSON.parse(message.value.toString());
							await this.processJob(job);
						} else {
							this.logger.warn("Received message with null value");
						}
					},
				});

				this.socketIOInstance = io("ws://localhost:3001/automated", {
					transports: ["websocket"],
					withCredentials: true,
				});
				this.socketIOInstance.on("connect", () => {
					this.logger.info("Socket.IO connected successfully.");
				});

				// Handle searchResultAdded event
				this.socketIOInstance.on("searchResultAdded", (result: SearchResult) => {
					const {
						groupedResult: { entityId, payload },
					} = result;

					this.logger.info(
						`AirDC++ Search result added for entityId: ${entityId} - ${payload?.name}`,
					);
					if (!this.airDCPPSearchResults.has(entityId)) {
						this.airDCPPSearchResults.set(entityId, []);
					}
					if (!isNil(payload)) {
						this.airDCPPSearchResults.get(entityId).push(payload);
					}

					console.log(typeof entityId, entityId);
					console.log(entityId);
					console.log(
						"Updated airDCPPSearchResults:",
						JSON.stringify(Array.from(this.airDCPPSearchResults.entries()), null, 4),
					);
					console.log(JSON.stringify(payload, null, 4));
				});

				// Handle searchResultUpdated event
				this.socketIOInstance.on("searchResultUpdated", (result: SearchResult) => {
					const {
						updatedResult: { entityId, payload },
					} = result;
					const resultsForInstance = this.airDCPPSearchResults.get(entityId);

					if (resultsForInstance) {
						const toReplaceIndex = resultsForInstance.findIndex((element: any) => {
							console.log("search result updated!");
							console.log(JSON.stringify(element, null, 4));
							return element.id === payload.id;
						});

						if (toReplaceIndex !== -1) {
							// Replace the existing result with the updated result
							resultsForInstance[toReplaceIndex] = payload;

							// Optionally, update the map with the modified array
							this.airDCPPSearchResults.set(entityId, resultsForInstance);
						}
					}
				});

				// Handle searchComplete event
				this.socketIOInstance.on("searchesSent", async (data: any) => {
					this.logger.info(
						`Search complete for query: "${data.searchInfo.query.pattern}"`,
					);
					await this.produceResultsToKafka(data.searchInfo.query.pattern);
				});
			},
			async stopped() {
				await this.kafkaConsumer.disconnect();
				await this.kafkaProducer.disconnect();

				if (this.socketIOInstance) {
					this.socketIOInstance.close();
				}
			},
		});
	}
}
