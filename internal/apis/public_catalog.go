package apis

const publicApisSource = "public-apis/public-apis curated"

func init() {
	fallbackEntries = append(fallbackEntries, curatedPublicApiEntries()...)
}

func curatedPublicApiEntries() []ApiEntry {
	return []ApiEntry{
		publicApiEntry(
			"Cat Facts",
			"cat-facts-public",
			"Random cat facts from a no-auth public API. Good for quick response-shape tests.",
			[]string{"Animals", "Testing"},
			"https://catfact.ninja/fact",
			"https://catfact.ninja/",
		),
		publicApiEntry(
			"Dog CEO Random Image",
			"dog-ceo-random-image",
			"Random dog image endpoint with a compact JSON response.",
			[]string{"Animals", "Images & Photography"},
			"https://dog.ceo/api/breeds/image/random",
			"https://dog.ceo/dog-api/",
		),
		publicApiEntry(
			"Advice Slip",
			"advice-slip-random",
			"Random advice payload for simple GET request testing.",
			[]string{"Random", "Testing"},
			"https://api.adviceslip.com/advice",
			"https://api.adviceslip.com/",
		),
		publicApiEntry(
			"Open-Meteo Rome Forecast",
			"open-meteo-rome-forecast",
			"Forecast sample using Open-Meteo with latitude, longitude, and current weather fields.",
			[]string{"Weather", "Maps & Geo"},
			"https://api.open-meteo.com/v1/forecast?latitude=41.9028&longitude=12.4964&current=temperature_2m,wind_speed_10m",
			"https://open-meteo.com/en/docs",
		),
		publicApiEntry(
			"Open Brewery DB",
			"open-brewery-db",
			"Small paginated brewery dataset useful for list and filtering tests.",
			[]string{"Food & Drinks", "Open Data"},
			"https://api.openbrewerydb.org/v1/breweries?per_page=3",
			"https://www.openbrewerydb.org/documentation",
		),
		publicApiEntry(
			"Random User",
			"random-user",
			"Generate realistic fake users with nested profile data.",
			[]string{"Testing", "Random"},
			"https://randomuser.me/api/",
			"https://randomuser.me/documentation",
		),
		publicApiEntry(
			"Hacker News Top Stories",
			"hacker-news-top-stories",
			"Firebase-backed Hacker News top story IDs for feed and array handling tests.",
			[]string{"News & Feeds", "Open Data"},
			"https://hacker-news.firebaseio.com/v0/topstories.json",
			"https://github.com/HackerNews/API",
		),
		publicApiEntry(
			"World Bank Countries",
			"world-bank-countries",
			"Country metadata from the World Bank API in JSON format.",
			[]string{"Government", "Statistics & Data"},
			"https://api.worldbank.org/v2/country/IT?format=json",
			"https://datahelpdesk.worldbank.org/knowledgebase/articles/889392",
		),
		publicApiEntry(
			"Open Library Search",
			"open-library-search",
			"Book search endpoint returning documents, authors, and edition metadata.",
			[]string{"Books", "Open Data"},
			"https://openlibrary.org/search.json?q=api",
			"https://openlibrary.org/developers/api",
		),
		publicApiEntry(
			"PokeAPI Pikachu",
			"pokeapi-pikachu",
			"Pokemon resource sample with deeply nested JSON and links.",
			[]string{"Games", "Open Data"},
			"https://pokeapi.co/api/v2/pokemon/pikachu",
			"https://pokeapi.co/docs/v2",
		),
		publicApiEntry(
			"Jikan Anime Search",
			"jikan-anime-search",
			"Unofficial MyAnimeList search API sample.",
			[]string{"Comics & Anime", "Entertainment"},
			"https://api.jikan.moe/v4/anime?q=cowboy%20bebop&limit=3",
			"https://docs.api.jikan.moe/",
		),
		publicApiEntry(
			"Agify Name Estimate",
			"agify-name-estimate",
			"Name-based age estimate endpoint for query parameter testing.",
			[]string{"Random", "Validation & Verification"},
			"https://api.agify.io?name=andrea",
			"https://agify.io/",
		),
		publicApiEntry(
			"Nationalize Name Estimate",
			"nationalize-name-estimate",
			"Name nationality probability endpoint with an array response.",
			[]string{"Random", "Validation & Verification"},
			"https://api.nationalize.io?name=andrea",
			"https://nationalize.io/",
		),
		publicApiEntry(
			"Universities Italy Search",
			"universities-italy-search",
			"University domain dataset filtered by country.",
			[]string{"Education", "Open Data"},
			"https://universities.hipolabs.com/search?country=Italy",
			"https://github.com/Hipo/university-domains-list-api",
		),
		publicApiEntry(
			"OpenFDA Drug Label",
			"openfda-drug-label",
			"Public FDA drug label sample for large JSON payload inspection.",
			[]string{"Health", "Government"},
			"https://api.fda.gov/drug/label.json?limit=1",
			"https://open.fda.gov/apis/drug/label/",
		),
		publicApiEntry(
			"IPify Current IP",
			"ipify-current-ip",
			"Simple plain public IP response wrapped as JSON.",
			[]string{"Development", "Network & HTTP"},
			"https://api.ipify.org?format=json",
			"https://www.ipify.org/",
		),
		publicApiEntry(
			"SpaceX Latest Launch",
			"spacex-latest-launch",
			"Latest SpaceX launch payload for date, links, and status fields.",
			[]string{"Space", "Open Data"},
			"https://api.spacexdata.com/v5/launches/latest",
			"https://github.com/r-spacex/SpaceX-API",
		),
		publicApiEntry(
			"GitHub Public APIs Repository",
			"github-public-apis-repository",
			"GitHub REST sample for the public-apis repository metadata.",
			[]string{"Development", "Open Source"},
			"https://api.github.com/repos/public-apis/public-apis",
			"https://github.com/public-apis/public-apis",
		),
	}
}

func publicApiEntry(name string, slug string, description string, categories []string, apiURL string, docsURL string) ApiEntry {
	return ApiEntry{
		Name:        name,
		Slug:        slug,
		Description: description,
		Categories:  categories,
		Type:        "rest",
		IsFree:      true,
		Source:      publicApisSource,
		Links: []struct {
			Name string `json:"name" yaml:"name"`
			URL  string `json:"url" yaml:"url"`
		}{
			{Name: "API", URL: apiURL},
			{Name: "Docs", URL: docsURL},
			{Name: "Source", URL: "https://github.com/public-apis/public-apis"},
		},
	}
}
