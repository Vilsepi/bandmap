
# Last.fm API

We crawl artist metadata from the Last.fm API.

## artist.getInfo

API documentation: https://www.last.fm/api/show/artist.getInfo
Sample response: `doc/sample.artist.getinfo.json`

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
Sample response: `doc/sample.artist.getsimilar.json`

What we especially want from this response for each of the similar artists:

- `name`
- `mbid`
- `match` which is the similarity score
- `url`

What we are not interested in the data:

- `image` urls. Do not download any images.
- `streamable` number


## tag.getTopArtists

Get a list of artists which are most associated with this tag.

API documentation: https://www.last.fm/api/show/tag.getTopArtists

##  tag.getSimilar

Get a list of tags which are similar to this tag.

API documentation: https://www.last.fm/api/show/tag.getSimilar
