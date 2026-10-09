/**
 * Copyright & DMCA notice (user decision 2026-10-09). The footer line sits at the bottom of the
 * Anime, Manga and More sections; the full policy opens in-app and is mirrored word for word in
 * LEGAL.md (a test keeps them in step). Keep every statement true to how the app works, and never
 * name a streaming source here.
 */
export const LEGAL_FOOTER =
  "AniStream does not host, store or distribute any videos or manga. All streams and chapters are provided by independent third-party services, and all titles and artwork belong to their respective owners.";

export const LEGAL_CONTACT = {
  issues: "https://github.com/Athen2045/AniStream/issues",
  profile: "https://github.com/Athen2045",
};

export interface LegalSection {
  heading: string;
  paragraphs: string[];
  /** A numbered list after the paragraphs. */
  list?: string[];
  /** Paragraphs after the list. */
  after?: string[];
}

export const LEGAL_POLICY: LegalSection[] = [
  {
    heading: "About AniStream",
    paragraphs: [
      "AniStream is a free, open-source desktop application that runs on your device. It does not operate servers, user accounts or upload features.",
    ],
  },
  {
    heading: "Content AniStream does not host",
    paragraphs: [
      "AniStream does not host, upload, store or distribute video files. Videos play inside players embedded from third-party websites and are delivered directly from those websites' servers to your device; AniStream does not download, copy or re-encode them.",
      "Manga pages are retrieved from MangaDex and other third-party sources when you open a chapter, kept temporarily in memory, and not saved. To load faster, AniStream saves cover and banner artwork on your device.",
    ],
  },
  {
    heading: "Third-party services",
    paragraphs: [
      "The websites and players AniStream connects to are operated by independent third parties not affiliated with AniStream. AniStream does not control, review or endorse the content they host, and their own terms and policies apply.",
      "Title information and artwork are provided through the public APIs of AniList, TMDB, MyAnimeList, Kitsu, MangaDex and Simkl. AniStream is not affiliated with or endorsed by any of them. This product uses the TMDB API but is not endorsed or certified by TMDB. All titles, artwork and trademarks are the property of their respective owners.",
    ],
  },
  {
    heading: "Your responsibility",
    paragraphs: ["Use AniStream only to access content you are permitted to view where you live."],
  },
  {
    heading: "Copyright complaints",
    paragraphs: [
      `AniStream respects the rights of copyright owners. If you believe AniStream embeds, links to or otherwise provides access to material that infringes your copyright, contact the maintainer through GitHub: open an issue at ${LEGAL_CONTACT.issues} or reach the maintainer at ${LEGAL_CONTACT.profile}. GitHub issues are public, so if your notice includes personal details, first open an issue asking for a private channel. Your notice should include:`,
    ],
    list: [
      "your physical or electronic signature;",
      "the copyrighted work you believe is infringed;",
      "the material in AniStream and enough detail to locate it (title, episode or chapter, and section);",
      "your name, address, phone number and email address;",
      "a statement that you believe in good faith the use is not authorized by the copyright owner, its agent or the law;",
      "a statement, under penalty of perjury, that the information in your notice is accurate and that you are the owner or authorized to act on the owner's behalf.",
    ],
    after: [
      "Every valid notice is reviewed promptly. Where appropriate, the identified material or source is removed or disabled and an updated version of the app is published. Because AniStream does not host this material, it may remain available on the third-party website; contacting that website's operator directly is the most effective way to have it removed.",
    ],
  },
  {
    heading: "Counter-notices",
    paragraphs: [
      "If you believe material was disabled by mistake or misidentification, you may send a counter-notice through the same channel with the details required by 17 U.S.C. § 512(g).",
      "Knowingly misrepresenting that material is infringing may make you liable for damages under 17 U.S.C. § 512(f).",
    ],
  },
];
