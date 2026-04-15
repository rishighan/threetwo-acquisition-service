import type { Consumer, EachMessagePayload, Producer } from "kafkajs";
import { Kafka, logLevel } from "kafkajs";
import { isNil } from "lodash";
import type { ServiceBroker, ServiceSchema } from "moleculer";
import { Service } from "moleculer";
import type { Socket } from "socket.io-client";
import io from "socket.io-client";
import stringSimilarity from "string-similarity-alg";

interface SearchPayload {
	id: string;
	name: string;
}

interface SearchResult {
	groupedResult: { entityId: number; payload: SearchPayload };
	updatedResult: { entityId: number; payload: SearchPayload };
}

interface Issue {
	issueNumber?: string;
	issue_number?: string;
	coverDate?: string;
	year?: number;
}

interface Volume {
	id: string;
	name: string;
}

interface Comic {
	wanted: {
		volume: Volume;
		issues?: Issue[];
		markEntireVolumeWanted?: boolean;
	};
}

interface Job {
	comic: Comic;
}

interface Hub {
	value: string;
}

interface DirectConnectSettings {
	client: {
		hubs: Hub[];
	};
}

interface SearchInfo {
	query: {
		pattern: string;
	};
}

interface SearchesSentData {
	searchInfo: SearchInfo;
}

interface RankedResult extends SearchPayload {
	similarity: number;
}

export default class ComicProcessorService extends Service {
	private kafkaConsumer!: Consumer;

	private socketIOInstance!: Socket;

	private kafkaProducer!: Producer;

	private prowlarrResultsMap: Map<string, unknown> = new Map();

	private airDCPPSearchResults: Map<number, SearchPayload[]> = new Map();

	private issuesToSearch: Issue[] = [];

	// @ts-ignore -- Moleculer requires this constructor signature for service instantiation
	constructor(
		broker: ServiceBroker,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		schema: ServiceSchema<object> = { name: "comicProcessor" },
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
				rankSearchResults: (results: Map<number, SearchPayload[]>, query: string): RankedResult | null => {
					// Find the highest-ranked response based on similarity to the search string
					let highestRankedResult: RankedResult | null = null;
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
				processJob: async (job: Job) => {
					try {
						this.logger.info("Processing job:", JSON.stringify(job, null, 2));
						// Get the hub to search on
						const settings: DirectConnectSettings = await this.broker.call("settings.getSettings", {
							settingsKey: "directConnect",
						});
						const hubs = settings.client.hubs.map((hub: Hub) => hub.value);

						const { comic } = job;
						const { volume, issues, markEntireVolumeWanted } = comic.wanted;

						// If entire volume is marked as wanted, get their details from CV
						if (markEntireVolumeWanted) {
							const fetchedIssues: Issue[] = await this.broker.call(
								"comicvine.getIssuesForVolume",
								{ volumeId: volume.id },
							);
							this.issuesToSearch = fetchedIssues;
							this.logger.info(
								`The entire volume with id: ${volume.id} was marked as wanted.`,
							);
							this.logger.info(`Fetched issues for ${volume.id}:`);
							this.logger.info(`${this.issuesToSearch.length} issues to search`);
						} else {
							// Or proceed with `issues` from the wanted object.
							this.issuesToSearch = issues || [];
						}

						/* eslint-disable no-await-in-loop */
						for (const issue of this.issuesToSearch) {
							// Query builder for DC++
							// 1. issue number
							const issueNumber =
								issue.issueNumber || issue.issue_number || "";
							// 2. year
							const { year } = this.parseStringDate(issue.coverDate || "");
							const issueYear = year || issue.year || "";

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
							this.logger.debug(`Issue number: ${issueNumber}, Year: ${issueYear}`);

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
						}
						/* eslint-enable no-await-in-loop */
					} catch (error) {
						this.logger.error("Error processing job:", error);
					}
				},
				produceResultsToKafka: async (query: string): Promise<void> => {
					try {
						/*
							Match and rank
						*/
						const finalResult = this.rankSearchResults(
							this.airDCPPSearchResults,
							query,
						);
						/*
							Kafka messages need to be in a format that can be serialized to JSON, 
							and a Map is not directly serializable in a way that retains its structure, 
							hence why we use Object.fromEntries
						*/
						await this.kafkaProducer.send({
							topic: "comic-search-results",
							messages: [
								{
									value: JSON.stringify(finalResult),
								},
							],
						});
						this.logger.info(`Produced results to Kafka.`);

						// socket event for UI
						await this.broker.call("socket.broadcast", {
							namespace: "/",
							event: "searchResultsAvailable",
							args: [
								{
									query,
									finalResult,
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
					brokers: [process.env.KAFKA_BROKER_URI || "localhost:9092"],
					logLevel: logLevel.INFO,
				});
				this.kafkaConsumer = kafka.consumer({ groupId: "comic-processor-group" });
				this.kafkaProducer = kafka.producer();

				this.kafkaConsumer.on("consumer.crash", (event: { payload: Error }) => {
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
					eachMessage: async ({ message }: EachMessagePayload) => {
						if (message.value) {
							const job = JSON.parse(message.value.toString()) as Job;
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
						const results = this.airDCPPSearchResults.get(entityId);
						if (results) {
							results.push(payload);
						}
					}

					this.logger.info(
						"Updated airDCPPSearchResults:",
						JSON.stringify(Array.from(this.airDCPPSearchResults.entries()), null, 4),
					);
					this.logger.info(JSON.stringify(payload, null, 4));
				});

				// Handle searchResultUpdated event
				this.socketIOInstance.on("searchResultUpdated", (result: SearchResult) => {
					const {
						updatedResult: { entityId, payload },
					} = result;
					const resultsForInstance = this.airDCPPSearchResults.get(entityId);

					if (resultsForInstance) {
						const toReplaceIndex = resultsForInstance.findIndex((element: SearchPayload) => {
							this.logger.info("search result updated!");
							this.logger.info(JSON.stringify(element, null, 4));
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
				this.socketIOInstance.on("searchesSent", async (data: SearchesSentData) => {
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
