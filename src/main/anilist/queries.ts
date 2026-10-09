/** Profile fields, shared by the sign-in query and the dashboard so the profile stays current. */
const VIEWER_FIELDS = `
  fragment AniStreamViewerFields on User {
    id
    name
    about
    avatar {
      large
    }
    bannerImage
    siteUrl
    statistics {
      anime {
        count
        episodesWatched
        minutesWatched
      }
      manga {
        count
        chaptersRead
        volumesRead
      }
    }
  }
`;

export const DASHBOARD_QUERY = `
  query AniStreamDashboard($userId: Int!) {
    viewer: Viewer {
      ...AniStreamViewerFields
    }
    anime: MediaListCollection(type: ANIME, userId: $userId) {
      lists {
        name
        isCustomList
        entries {
          ...AniStreamEntry
        }
      }
    }
    manga: MediaListCollection(type: MANGA, userId: $userId) {
      lists {
        name
        isCustomList
        entries {
          ...AniStreamEntry
        }
      }
    }
  }

  fragment AniStreamEntry on MediaList {
    id
    status
    score(format: POINT_10_DECIMAL)
    progress
    progressVolumes
    repeat
    notes
    updatedAt
    media {
      id
      type
      title {
        userPreferred
        english
        romaji
      }
      coverImage {
        large
        color
      }
      bannerImage
      format
      status
      episodes
      chapters
      volumes
      genres
      averageScore
      nextAiringEpisode {
        episode
        airingAt
      }
      siteUrl
    }
  }
${VIEWER_FIELDS}`;

export const VIEWER_QUERY = `
  query AniStreamViewer {
    Viewer {
      ...AniStreamViewerFields
    }
  }
${VIEWER_FIELDS}`;

export const UPDATE_ENTRY_MUTATION = `
  mutation UpdateAniStreamEntry(
    $id: Int!
    $status: MediaListStatus
    $score: Float
    $progress: Int
    $progressVolumes: Int
    $repeat: Int
    $notes: String
  ) {
    SaveMediaListEntry(
      id: $id
      status: $status
      score: $score
      progress: $progress
      progressVolumes: $progressVolumes
      repeat: $repeat
      notes: $notes
    ) {
      id
      status
      score(format: POINT_10_DECIMAL)
      progress
    }
  }
`;

export const DELETE_ENTRY_MUTATION = `
  mutation DeleteAniStreamEntry($id: Int!) {
    DeleteMediaListEntry(id: $id) {
      deleted
    }
  }
`;

export const ADD_ENTRY_MUTATION = `
  mutation AddAniStreamEntry($mediaId: Int!) {
    SaveMediaListEntry(mediaId: $mediaId, status: PLANNING) {
      id
      status
      score(format: POINT_10_DECIMAL)
      progress
    }
  }
`;

export const CATALOG_MEDIA_FIELDS = `
  fragment AniStreamCatalogMedia on Media {
    id
    idMal
    type
    title {
      userPreferred
      english
      romaji
    }
    coverImage {
      extraLarge
      large
      color
    }
    bannerImage
    description(asHtml: false)
    format
    status
    episodes
    chapters
    volumes
    siteUrl
    genres
    averageScore
    popularity
    season
    seasonYear
    nextAiringEpisode {
      episode
      airingAt
    }
  }
`;

export const BROWSE_MEDIA_QUERY = `
  query BrowseAniStreamMedia(
    $page: Int!
    $perPage: Int!
    $type: MediaType!
    $search: String
    $genre: String
    $sort: [MediaSort!]!
    $format: MediaFormat
    $status: MediaStatus
    $season: MediaSeason
    $seasonYear: Int
    $startDateGreater: FuzzyDateInt
    $startDateLesser: FuzzyDateInt
    $countryOfOrigin: CountryCode
    $tag: String
    $averageScoreGreater: Int
  ) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        currentPage
        perPage
        lastPage
        hasNextPage
      }
      media(
        type: $type
        search: $search
        genre: $genre
        sort: $sort
        format: $format
        status: $status
        season: $season
        seasonYear: $seasonYear
        startDate_greater: $startDateGreater
        startDate_lesser: $startDateLesser
        countryOfOrigin: $countryOfOrigin
        tag: $tag
        averageScore_greater: $averageScoreGreater
      ) {
        ...AniStreamCatalogMedia
      }
    }
  }
  ${CATALOG_MEDIA_FIELDS}
`;

/** Genre and tag vocabularies for the catalog filter drawer; both change rarely. */
export const FILTER_OPTIONS_QUERY = `
  query AniStreamFilterOptions {
    GenreCollection
    MediaTagCollection {
      name
      category
      isAdult
    }
  }
`;

export const AIRING_UPDATES_QUERY = `
  query AniStreamAiringUpdates($page: Int!, $perPage: Int!) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        currentPage
        perPage
        lastPage
        hasNextPage
      }
      airingSchedules(notYetAired: false, sort: TIME_DESC) {
        episode
        airingAt
        media {
          ...AniStreamCatalogMedia
        }
      }
    }
  }
  ${CATALOG_MEDIA_FIELDS}
`;

/** Exact titles by AniList ID (hero artwork for For You picks); AniList returns them unordered. */
export const MEDIA_BY_IDS_QUERY = `
  query AniStreamMediaByIds($ids: [Int], $type: MediaType) {
    Page(page: 1, perPage: 12) {
      pageInfo {
        currentPage
        perPage
        lastPage
        hasNextPage
      }
      media(id_in: $ids, type: $type, isAdult: false) {
        ...AniStreamCatalogMedia
      }
    }
  }
  ${CATALOG_MEDIA_FIELDS}
`;

export const MANGA_KIND_HINTS_QUERY = `
  query AniStreamMangaKindHints($ids: [Int]) {
    Page(page: 1, perPage: 50) {
      media(id_in: $ids, type: MANGA) {
        id
        idMal
        countryOfOrigin
        format
      }
    }
  }
`;

export const MEDIA_DETAIL_QUERY = `
  query AniStreamMediaDetail($id: Int!, $type: MediaType!) {
    Media(id: $id, type: $type) {
      ...AniStreamCatalogMedia
      title {
        userPreferred
        romaji
        english
        native
      }
      synonyms
      source
      countryOfOrigin
      duration
      startDate {
        year
        month
        day
      }
      endDate {
        year
        month
        day
      }
      studios {
        edges {
          isMain
          node {
            name
          }
        }
      }
      characters(page: 1, perPage: 12, sort: [ROLE, RELEVANCE, ID]) {
        edges {
          role
          node {
            id
            name {
              full
            }
            image {
              medium
            }
          }
        }
      }
      staff(page: 1, perPage: 12, sort: [RELEVANCE, ID]) {
        edges {
          role
          node {
            id
            name {
              full
            }
            image {
              medium
            }
          }
        }
      }
      relations {
        edges {
          relationType
          node {
            ...AniStreamCatalogMedia
          }
        }
      }
      recommendations(page: 1, perPage: 25, sort: RATING_DESC) {
        nodes {
          mediaRecommendation {
            ...AniStreamCatalogMedia
          }
        }
      }
      externalLinks {
        site
        url
        type
      }
      trailer {
        id
        site
      }
      airingSchedule(notYetAired: true, perPage: 25) {
        nodes {
          episode
          airingAt
        }
      }
      mediaListEntry {
        id
        status
        score(format: POINT_10_DECIMAL)
        progress
      }
    }
  }
  ${CATALOG_MEDIA_FIELDS}
`;

export interface GraphQlEnvelope<T> {
  data?: T;
  errors?: Array<{ message?: unknown }>;
}

export interface ViewerResponse {
  Viewer?: unknown;
}

export interface DashboardResponse {
  viewer?: unknown;
  anime?: unknown;
  manga?: unknown;
}

export interface BrowseResponse {
  Page?: unknown;
}

export interface FilterOptionsResponse {
  GenreCollection?: unknown;
  MediaTagCollection?: unknown;
}

export interface AiringUpdatesResponse {
  Page?: unknown;
}

export interface MangaKindHintsResponse {
  Page?: unknown;
}

export interface MediaDetailResponse {
  Media?: unknown;
}

export interface SaveEntryResponse {
  SaveMediaListEntry?: unknown;
}
