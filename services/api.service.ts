import fs from "fs";
import { Service, ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";

export default class ApiService extends Service {
	constructor(broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: "api",
			mixins: [ApiGateway],
			// More info about settings: https://moleculer.services/docs/0.14/moleculer-web.html
			settings: {
				port: process.env.PORT || 3060,
				routes: [
					{
						path: "/api",
						whitelist: ["**"],
						cors: {
							origin: "*",
							methods: ["GET", "OPTIONS", "POST", "PUT", "DELETE"],
							allowedHeaders: ["*"],
							exposedHeaders: [],
							credentials: false,
							maxAge: 3600,
						},
						use: [],
						mergeParams: true,
						authentication: false,
						authorization: false,
						autoAliases: true,
						aliases: {},
						callingOptions: {},

						bodyParsers: {
							json: {
								strict: false,
								limit: "1MB",
							},
							urlencoded: {
								extended: true,
								limit: "1MB",
							},
						},
						mappingPolicy: "all", // Available values: "all", "restrict"
						logging: true,
					},

					{
						path: "/logs",
						use: [ApiGateway.serveStatic("logs")],
					},
				],
				log4XXResponses: false,
				logRequestParams: true,
				logResponseData: true,
				assets: {
					folder: "public",
					// Options to `server-static` module
					options: {},
				},
			},
			events: {},

			methods: {},
			started(): any {},
		});
	}
}
