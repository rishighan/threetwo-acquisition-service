"use strict";
import { Service, ServiceBroker, ServiceSchema } from "moleculer";
import { Kafka, EachMessagePayload, logLevel } from "kafkajs";
import io from "socket.io-client";
import { isUndefined } from "lodash";

interface SearchResult {
	result: {
		id: string;
		// Add other relevant fields
	};
	search_id: string;
	// Add other relevant fields
}

interface SearchResultPayload {
	groupedResult: SearchResult;
	updatedResult: SearchResult;
	instanceId: string;
}

export default class ComicProcessorService extends Service {
	private kafkaConsumer: any;
	private socketIOInstance: any;
	private kafkaProducer: any;
	private prowlarrResultsMap: Map<string, any> = new Map();
	private airDCPPSearchResults: Map<string, any[]> = new Map();
	private issuesToSearch: any = [];

	// @ts-ignore
	public constructor(
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
				processJob: async (job: any) => {
					try {
						this.logger.info("Processing job:", JSON.stringify(job, null, 2));
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
							// issue number
							const inferredIssueNumber = issue.issueNumber
								? issue.issueNumber
								: issue.issue_number;
							// year
							const { year } = this.parseStringDate(issue.coverDate);
							const inferredYear = year ? issue?.coverDate : issue.year;

							const settings: any = await this.broker.call("settings.getSettings", {
								settingsKey: "directConnect",
							});
							const hubs = settings.client.hubs.map((hub: any) => hub.value);
							const dcppSearchQuery = {
								query: {
									pattern: `${volume.name.replace(
										/#/g,
										"",
									)} ${inferredIssueNumber} ${inferredYear}`,
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
									hostname: "localhost:5600",
									protocol: "http",
									username: "user",
									password: "pass",
								},
								namespace: "/automated",
							});

							const prowlarrResults = await this.broker.call("prowlarr.search", {
								prowlarrQuery: {
									port: "9696",
									apiKey: "c4f42e265fb044dc81f7e88bd41c3367",
									offset: 0,
									categories: [7030],
									query: `${volume.name} ${issue.issueNumber} ${year}`,
									host: "localhost",
									limit: 100,
									type: "search",
									indexerIds: [2],
								},
							});

							this.logger.info(
								"Prowlarr search results:",
								JSON.stringify(prowlarrResults, null, 4),
							);

							// Store prowlarr results in map using unique key
							const key = `${volume.name}-${issue.issueNumber}-${year}`;
							this.prowlarrResultsMap.set(key, prowlarrResults);
						}
					} catch (error) {
						this.logger.error("Error processing job:", error);
					}
				},
				produceResultsToKafka: async (dcppResults: any, prowlarrResults: any) => {
					const results = { dcppResults, prowlarrResults };
					try {
						await this.kafkaProducer.send({
							topic: "comic-search-results",
							messages: [{ value: JSON.stringify(results) }],
						});
						this.logger.info(
							"Produced results to Kafka:",
							JSON.stringify(results, null, 4),
						);
						// socket event for UI
						await this.broker.call("socket.broadcast", {
							namespace: "/",
							event: "searchResultsAvailable",
							args: [
								{
									dcppResults,
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
				this.socketIOInstance.on(
					"searchResultAdded",
					({ groupedResult, instanceId }: SearchResultPayload) => {
						this.logger.info(
							"Received search result added:",
							JSON.stringify(groupedResult, null, 4),
						);
						if (!this.airDCPPSearchResults.has(instanceId)) {
							this.airDCPPSearchResults.set(instanceId, []);
						}
						this.airDCPPSearchResults.get(instanceId).push(groupedResult.result);
					},
				);

				// Handle searchResultUpdated event
				this.socketIOInstance.on(
					"searchResultUpdated",
					async ({ updatedResult, instanceId }: SearchResultPayload) => {
						this.logger.info(
							"Received search result update:",
							JSON.stringify(updatedResult, null, 4),
						);
						const resultsForInstance = this.airDCPPSearchResults.get(instanceId);
						if (resultsForInstance) {
							const toReplaceIndex = resultsForInstance.findIndex(
								(element: any) => element.id === updatedResult.result.id,
							);
							if (toReplaceIndex !== -1) {
								resultsForInstance[toReplaceIndex] = updatedResult.result;
							}
						}
					},
				);

				// Handle searchComplete event
				this.socketIOInstance.on("searchComplete", async (instanceId: string) => {
					this.logger.info(`Search complete for instance ID ${instanceId}`);
					await this.produceResultsToKafka(instanceId);
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
