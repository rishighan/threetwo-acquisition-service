"use strict";
import { Service, ServiceBroker, ServiceSchema } from "moleculer";
import { Kafka, EachMessagePayload, logLevel } from "kafkajs";
import { isUndefined } from "lodash";
import io from "socket.io-client";
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
	private airDCPPSearchResults: Array<any> = [];

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
					this.logger.info("Processing job:", job);
					const { volumeName, issue } = job;
					const { year } = this.parseStringDate(issue.cover_date || issue.coverDate);
					const settings: any = await this.broker.call("settings.getSettings", {
						settingsKey: "directConnect",
					});
					const hubs = settings.client.hubs.map((hub: any) => hub.value);
					const dcppSearchQuery = {
						query: {
							pattern: `${volumeName.replace(/#/g, "")} ${
								issue.issue_number || issue.issueNumber
							} ${year}`,
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
							query: `${volumeName} ${issue.issueNumber} ${year}`,
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
					const key = `${volumeName}-${issue.issueNumber}-${year}`;
					this.prowlarrResultsMap.set(key, prowlarrResults);
				},
				produceResultsToKafka: async (dcppResults: any, prowlarrResults: any) => {
					const results = { dcppResults, prowlarrResults };
					await this.kafkaProducer.send({
						topic: "comic-search-results",
						messages: [{ value: JSON.stringify(results) }],
					});
					this.logger.info(
						"Produced results to Kafka:",
						JSON.stringify(results, null, 4),
					);
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
				await this.kafkaConsumer.connect();
				await this.kafkaProducer.connect();
				this.logger.info("Kafka consumer and producer connected successfully.");

				await this.kafkaConsumer.subscribe({
					topic: "comic-search-jobs",
					fromBeginning: true,
				});

				await this.kafkaConsumer.run({
					eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
						if (message.value) {
							const job = JSON.parse(message.value.toString());
							this.logger.info(
								"Consumed job from Kafka:",
								JSON.stringify(job, null, 4),
							);
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

				this.socketIOInstance.on(
					"searchResultAdded",
					({ groupedResult, instanceId }: SearchResultPayload) => {
						this.logger.info(
							"Received search result added:",
							JSON.stringify(groupedResult, null, 4),
						);
						this.airDCPPSearchResults.push({
							groupedResult: groupedResult.result,
							instanceId,
						});
					},
				);

				this.socketIOInstance.on(
					"searchResultUpdated",
					async ({ updatedResult, instanceId }: SearchResultPayload) => {
						this.logger.info(
							"Received search result update:",
							JSON.stringify(updatedResult, null, 4),
						);
						if (
							!isUndefined(updatedResult.result) &&
							!isUndefined(this.airDCPPSearchResults.result)
						) {
							const toReplaceIndex = this.airDCPPSearchResults.findIndex(
								(element: any) => {
									return element?.result.id === updatedResult.result.id;
								},
							);
							this.airDCPPSearchResults[toReplaceIndex] = {
								result: updatedResult.result,
								instanceId,
							};
						}
					},
				);
				this.socketIOInstance.on("searchComplete", async () => {
					// Ensure results are not empty before producing to Kafka
					if (this.airDCPPSearchResults.length > 0) {
						const results = this.airDCPPSearchResults.reduce((acc: any, item: any) => {
							const key = item.instanceId;
							if (!acc[key]) {
								acc[key] = [];
							}
							acc[key].push(item);
							return acc;
						}, {});
						await this.produceResultsToKafka(results, []);
					} else {
						this.logger.warn(
							"AirDC++ search results are empty, not producing to Kafka.",
						);
					}
				});
			},
			async stopped() {
				await this.kafkaConsumer.disconnect();
				await this.kafkaProducer.disconnect();
				this.logger.info("Kafka consumer and producer disconnected successfully.");

				// Close Socket.IO connection
				if (this.socketIOInstance) {
					this.socketIOInstance.close();
					this.logger.info("Socket.IO disconnected successfully.");
				}
			},
		});
	}
}
