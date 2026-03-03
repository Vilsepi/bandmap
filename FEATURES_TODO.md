

- Rename opinions to ratings
- Rework the user schema: generate uuid for each user, and use the uuid as primary key. Username and apikey should not be primary key
- Fix bug: related artists are not sorted correctly always
- Add view path to frontend URL, so that URLs can be shared and bookmarked and they take you back to the same screen
- Upgrade backend lambda to node24
