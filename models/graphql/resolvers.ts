export const resolvers = {
	Query: {
		_empty: (): null => null,
	},

	Mutation: {
		addTorrent: async (_: any, { input }: any, context: any) => {
			const { broker } = context;
			if (!broker) throw new Error("Broker not available in context");

			return broker.call("qbittorrent.addTorrent", {
				torrentToDownload: input.torrentToDownload,
				comicObjectId: input.comicObjectId,
			});
		},
	},

	JSON: {
		__parseValue: (value: any) => value,
		__serialize: (value: any) => value,
		__parseLiteral: (ast: any) => ast.value,
	},
};
