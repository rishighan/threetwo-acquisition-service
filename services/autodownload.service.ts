"use strict";
import { Context, Service, ServiceBroker, ServiceSchema, Errors } from "moleculer";
import { Kafka } from "kafkajs";

export default class AutoDownloadService extends Service {
	private kafkaProducer: any;

	// @ts-ignore
	public constructor(
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
							const wantedComics: any = await this.broker.call(
								"library.getComicsMarkedAsWanted",
								{},
							);
							this.logger.info("Fetched wanted comics:", wantedComics.length);

							for (const comic of wantedComics) {
								if (comic.wanted.markEntireVolumeWanted) {
									const issues: any = await this.broker.call(
										"comicvine.getIssuesForVolume",
										{
											volumeId: comic.wanted.volume.id,
										},
									);
									for (const issue of issues) {
										await this.produceJobToKafka(
											comic.wanted.volume.name,
											issue,
										);
									}
								} else if (comic.wanted.issues && comic.wanted.issues.length > 0) {
									for (const issue of comic.wanted.issues) {
										await this.produceJobToKafka(
											comic.wanted.volume?.name,
											issue,
										);
									}
								}
							}
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
				produceJobToKafka: async (volumeName: string, issue: any) => {
					const job = { volumeName, issue };
					await this.kafkaProducer.send({
						topic: "comic-search-jobs",
						messages: [{ value: JSON.stringify(job) }],
					});
					this.logger.info("Produced job to Kafka:", job);
				},
			},
			async started() {
				const kafka = new Kafka({
					clientId: "comic-search-service",
					brokers: ["localhost:9092"],
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
