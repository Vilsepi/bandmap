
- Add view path to frontend URL, so that URLs can be shared and bookmarked and they take you back to the same screen
- Add local storage for artists with cache timestamps to lessen queries on backend. Or at the very least add artist name to ratings table. Both recommendations and todo list views currently bombard the backend every time you open the view.
- Fix: Recommendations are not sorted by score in Recommendations view
- Review: Recommendation score should be based on both the rating score the user gave the artist, and the similarity score from Last.fm related artists API.
