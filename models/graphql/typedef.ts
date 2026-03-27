import { gql } from "graphql-tag";

export const typeDefs = gql`
	scalar JSON

	input AddTorrentInput {
		torrentToDownload: String!
		comicObjectId: ID!
	}

	type AddTorrentResult {
		result: JSON
	}

	type Query {
		_empty: String
	}

	type Mutation {
		"""
		Add a torrent to qBittorrent
		"""
		addTorrent(input: AddTorrentInput!): AddTorrentResult
	}
`;
