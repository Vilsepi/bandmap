
# Last.fm API

We crawl artist metadata from the Last.fm API.

## artist.getInfo

API documentation: https://www.last.fm/api/show/artist.getInfo
Sample response: [samples/artist_getinfo.json](samples/artist_getinfo.json)

What we are interested in this response:

- artist name
- `mbid` — optional, used to look up Spotify URL via MusicBrainz
- url to last.fm artist page — used as the unique external identifier for an artist
- genre tags

What we are not interested in the data:

- image urls. Do not download any images.
- bio content. This is too long text.
- similar artists: this could potentially be useful but it is lacking a crucial metric: the similarity score. We get this data from a separate request.

## artist.getSimilar

API documentation: https://www.last.fm/api/show/artist.getSimilar
Sample response: [samples/artist_getsimilar.json](samples/artist_getsimilar.json)

What we especially want from this response for each of the similar artists:

- `name`
- `mbid` — optional
- `match` which is the similarity score
- `url` — last.fm artist page URL

What we are not interested in the data:

- `image` urls. Do not download any images.
- `streamable` number

## artist.search

API Documentation: https://www.last.fm/api/show/artist.search
Sample responses:

- [samples/artist_search_with_mbids.json](samples/artist_search_with_mbids.json)
- [samples/artist_search_missing_mbids.json](samples/artist_search_missing_mbids.json)

What we are interested in:

- `results.artistmatches.artist.name`
- `results.artistmatches.artist.mbid` — optional, not always present
- `results.artistmatches.artist.url`

What we are not interested in:

- `image` urls. Do not download any images.

Note: Search results often have missing artist MBIDs. All results are included regardless.

## Other potential APIs

We are currently not using the following endpoints but they have potential.

### tag.getTopArtists

Get a list of artists which are most associated with this tag.

API documentation: https://www.last.fm/api/show/tag.getTopArtists

###  tag.getSimilar

Get a list of tags which are similar to this tag.

API documentation: https://www.last.fm/api/show/tag.getSimilar

# MusicBrainz API

API documentation: https://musicbrainz.org/doc/MusicBrainz_API

## Artist search

Search API documentation: https://musicbrainz.org/doc/MusicBrainz_API/Search
Sample response: [samples/musicbrainz_search.json](samples/musicbrainz_search.json)

Used to resolve an MBID for artists that Last.fm did not provide one for.
We search by artist name and accept the result only when the match score is 100.

For example: https://musicbrainz.org/ws/2/artist?query=artist:glasgow+coma+scale&limit=5&fmt=json

What we are interested in:

- `id` which is the MBID

## Artist lookup (url-rels)

Sample response: [samples/musicbrainz_lookup.json](samples/musicbrainz_lookup.json)

Used to find the Spotify artist URL from an artist's MBID.
Fetches the artist with `inc=url-rels` and looks for a relation with a Spotify URL prefix.

For example: https://musicbrainz.org/ws/2/artist/5ca3c7f7-370c-4829-98f0-b33ff3cbc584?inc=url-rels&fmt=json

What we are interested in:

- `relations[].url.resource` where the URL starts with `https://open.spotify.com/artist/`

Rate limit: MusicBrainz enforces 1 request per second. The backend client enforces this.
