"use strict";
import { Kafka } from "kafkajs";
import type { Context, ServiceBroker, ServiceSchema } from "moleculer";
import { Errors, Service } from "moleculer";

interface Comic {
	wanted: {
		markEntireVolumeWanted?: boolean;
		issues?: any[];
		volume: {
			id: string;
			name: string;
		};
	};
}

export default class AutoDownloadService extends Service {
	private kafkaProducer: any;

	private readonly BATCH_SIZE = 100; // Adjust based on your system capacity

	// @ts-ignore
	constructor(
		public broker: ServiceBroker,
		schema: ServiceSchema<{}> = { name: "autodownload" },
	) {
		super(broker);
		this.parseServiceSchema({
			name: "autodownload",
			actions: {
				searchWantedComics: {
					rest: "POST /searchWantedComics",
					handler: async (ctx: Context<{}>) => {
						try {
							/* eslint-disable no-await-in-loop */
							let page = 1;
							const limit = this.BATCH_SIZE;
							let comics: Comic[];
							do {
								comics = await this.broker.call(
									"library.getComicsMarkedAsWanted",
									{ page, limit },
								);
								// Log debugging info
								this.logger.info(
									"Received comics from getComicsMarkedAsWanted:",
									JSON.stringify(comics, null, 2),
								);
								if (!Array.isArray(comics)) {
									this.logger.error(
										"Invalid response structure",
										JSON.stringify(comics, null, 2),
									);
									throw new Errors.MoleculerError(
										"Invalid response structure from getComicsMarkedAsWanted",
										500,
										"INVALID_RESPONSE_STRUCTURE",
									);
								}
								this.logger.info(
									`Fetched ${comics.length} comics from page ${page}`,
								);
								for (const comic of comics) {
									await this.produceJobToKafka(comic);
								}
								page += 1;
							} while (comics.length === limit);

							return {
								success: true,
								message: "Jobs enqueued for background processing.",
							};
						} catch (error) {
							this.logger.error("Error in searchWantedComics:", error);
							throw new Errors.MoleculerError(
								"Failed to search wanted comics.",
								500,
								"SEARCH_WANTED_COMICS_ERROR",
								{ error },
							);
						}
					},
				},
			},
			methods: {
				produceJobToKafka: async (comic: Comic) => {
					const job = { comic };
					try {
						await this.kafkaProducer.send({
							topic: "comic-search-jobs",
							messages: [{ value: JSON.stringify(job) }],
						});
						this.logger.info("Produced job to Kafka:", job);
					} catch (error) {
						this.logger.error("Error producing job to Kafka:", error);
					}
				},
			},
			async started() {
				const kafka = new Kafka({
					clientId: "comic-search-service",
					brokers: [process.env.KAFKA_BROKER_URI],
				});
				this.kafkaProducer = kafka.producer();
				await this.kafkaProducer.connect();
				this.logger.info("Kafka producer connected successfully.");
			},
			async stopped() {
				await this.kafkaProducer.disconnect();
				this.logger.info("Kafka producer disconnected successfully.");
			},
		});
	}
}
