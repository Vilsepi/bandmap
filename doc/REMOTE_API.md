
# Last.fm API

We crawl artist metadata from the Last.fm API.

## artist.getInfo

API documentation: https://www.last.fm/api/show/artist.getInfo
Sample response: [samples/artist_getinfo.json](samples/artist_getinfo.json)

What we are interested in this response:

- artist name
- `mbid` as the primary unique id to refer to an artist
- url to last.fm artist page
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
- `mbid`
- `match` which is the similarity score
- `url`

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
- `results.artistmatches.artist.mbid`
- `results.artistmatches.artist.url`

What we are not interested in:

- `image` urls. Do not download any images.

Known issue: Sometimes the search results are missing the artist MBID.

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

## search

Search API documentation: https://musicbrainz.org/doc/MusicBrainz_API/Search

If the Last.fm search does not provide artist MBIDs, we attempt to do the same search in MusicBrainz.

For example: https://musicbrainz.org/ws/2/artist?query=glasgow+coma&limit=1&fmt=json

What we are interested in:

- `id` which is mbid
