#!/usr/bin/env node

const debugPort = Number(process.argv[2] ?? "9333");
const timeoutMs = 30_000;
const pending = new Map();
const megaPlayResponses = [];
let commandId = 0;

const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) =>
  response.json(),
);
const target = targets.find(
  (candidate) =>
    candidate.type === "page" &&
    (candidate.url.startsWith("http://127.0.0.1:") ||
      candidate.url.startsWith("http://localhost:")),
);

if (!target?.webSocketDebuggerUrl) {
  throw new Error(`AniStream renderer was not found on DevTools port ${debugPort}.`);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Timed out connecting to DevTools.")), timeoutMs);
  socket.addEventListener(
    "open",
    () => {
      clearTimeout(timer);
      resolve();
    },
    { once: true },
  );
  socket.addEventListener("error", reject, { once: true });
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }

  if (
    message.method === "Network.responseReceived" &&
    message.params?.response?.url?.startsWith("https://megaplay.buzz/")
  ) {
    megaPlayResponses.push({
      url: message.params.response.url,
      status: message.params.response.status,
      mimeType: message.params.response.mimeType,
    });
  }
});

function send(method, params = {}) {
  commandId += 1;
  const id = commandId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  return evaluateInContext(expression);
}

async function evaluateInContext(expression, contextId) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    ...(contextId ? { contextId } : {}),
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Renderer evaluation failed.");
  }
  return result.result?.value;
}

async function waitFor(expression, label, durationMs = timeoutMs) {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function click(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) return null;
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);

  if (!point) throw new Error(`Unable to click missing element: ${selector}`);
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
}

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");

  const initial = await evaluate(`({
    url: location.href,
    title: document.title,
    signedIn: !document.querySelector(".login-shell"),
  })`);
  if (!initial.signedIn) throw new Error("AniStream is not signed in to AniList.");

  if (await evaluate(`Boolean(document.querySelector(".detail-modal .detail-close"))`)) {
    await click(".detail-modal .detail-close");
    await waitFor(`!document.querySelector(".detail-modal")`, "the previous detail view to close");
  }
  await click(".nav-links button:first-child");
  await waitFor(
    `Boolean(document.querySelector(
      '.latest-updates-section[aria-label="Latest anime updates"] .latest-update-card, .media-rail[aria-label^="Trending Anime"] .rail-card'
    ))`,
    "an anime catalog card",
  );

  const cardSelector = await evaluate(`document.querySelector(
    '.latest-updates-section[aria-label="Latest anime updates"] .latest-update-card'
  )
    ? '.latest-updates-section[aria-label="Latest anime updates"] .latest-update-card'
    : '.media-rail[aria-label^="Trending Anime"] .rail-card'`);
  await click(cardSelector);
  await waitFor(`Boolean(document.querySelector(".detail-modal .play-action"))`, "anime details");

  const title = await evaluate(
    `document.querySelector(".detail-modal .detail-hero h2")?.textContent?.trim()`,
  );
  await click(".detail-modal .play-action");
  await waitFor(
    `Boolean(document.querySelector(".watch-experience--episodes .netflix-episode-list > button"))`,
    "the episode list",
  );

  const episodeLabel = await evaluate(
    `document.querySelector(".netflix-episode-list > button")?.getAttribute("aria-label")`,
  );
  await evaluate(`(() => {
    window.__anistreamSawWatchTransition = Boolean(document.querySelector(".watch-view-transition"));
    window.__anistreamTransitionObserver?.disconnect();
    window.__anistreamTransitionObserver = new MutationObserver(() => {
      if (document.querySelector(".watch-view-transition")) {
        window.__anistreamSawWatchTransition = true;
      }
    });
    window.__anistreamTransitionObserver.observe(document.body, { childList: true, subtree: true });
  })()`);
  await click(".netflix-episode-list > button");
  await waitFor(
    `Boolean(
      document.querySelector(".watch-experience--player .anikoto-embed") &&
      document.fullscreenElement
    )`,
    "the fullscreen Anikoto player",
  );

  const player = await evaluate(`({
    iframeUrl: document.querySelector(".anikoto-embed")?.src,
    sandboxed: document.querySelector(".anikoto-embed")?.hasAttribute("sandbox"),
    fullscreen: Boolean(document.fullscreenElement),
    view: document.querySelector(".watch-experience")?.className,
    sawTransition: window.__anistreamSawWatchTransition,
  })`);
  if (!player.iframeUrl?.startsWith("https://megaplay.buzz/stream/")) {
    throw new Error(`Unexpected player URL: ${String(player.iframeUrl)}`);
  }
  if (player.sandboxed) throw new Error("The Anikoto iframe is still sandboxed.");
  if (!player.sawTransition) throw new Error("The Framer Motion view curtain did not render.");

  await waitFor(
    `!document.querySelector(".anikoto-player-loading")`,
    "the embedded player frame",
    20_000,
  );
  await new Promise((resolve) => setTimeout(resolve, 2_000));

  const frameTree = await send("Page.getFrameTree");
  const frames = flattenFrames(frameTree.frameTree);
  const megaPlayFrame = frames.find((frame) =>
    frame.frame.url.startsWith("https://megaplay.buzz/stream/"),
  );
  let embeddedDocument;
  if (megaPlayFrame) {
    const world = await send("Page.createIsolatedWorld", {
      frameId: megaPlayFrame.frame.id,
      worldName: "anistream-verification",
    });
    embeddedDocument = await evaluateInContext(
      `(() => {
        const video = document.querySelector("video");
        return {
          title: document.title,
          text: document.body?.innerText?.replace(/\\s+/g, " ").trim().slice(0, 240),
          videoCount: document.querySelectorAll("video").length,
          nestedFrames: document.querySelectorAll("iframe").length,
          video: video
            ? {
                readyState: video.readyState,
                networkState: video.networkState,
                paused: video.paused,
                currentTime: video.currentTime,
                duration: Number.isFinite(video.duration) ? video.duration : null,
                errorCode: video.error?.code ?? null,
              }
            : null,
        };
      })()`,
      world.executionContextId,
    );
  }

  await send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 53,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 53,
  });
  await waitFor(
    `Boolean(document.querySelector(".watch-experience--episodes")) &&
      !document.fullscreenElement`,
    "the episode list after Escape",
  );

  const returned = await evaluate(`({
    fullscreen: Boolean(document.fullscreenElement),
    view: document.querySelector(".watch-experience")?.className,
    episodeRows: document.querySelectorAll(".netflix-episode-list > button").length,
  })`);

  await click(".netflix-episode-list > button");
  await waitFor(
    `Boolean(
      document.querySelector(".watch-experience--player [aria-label='Back to episode list']") &&
      document.fullscreenElement
    )`,
    "the fullscreen player for the explicit exit check",
  );
  await click(".watch-experience--player [aria-label='Back to episode list']");
  await waitFor(
    `Boolean(document.querySelector(".watch-experience--episodes")) &&
      !document.fullscreenElement`,
    "the episode list after the player exit button",
  );
  const returnedByButton = await evaluate(`({
    fullscreen: Boolean(document.fullscreenElement),
    view: document.querySelector(".watch-experience")?.className,
  })`);

  await click(".detail-modal .detail-close");
  await waitFor(`!document.querySelector(".detail-modal")`, "the anime detail view to close");
  await waitFor(
    `document.querySelector(
      '.latest-updates-section[aria-label="Latest anime updates"]'
    )?.getAttribute("aria-busy") === "false"`,
    "the static latest-anime grid",
  );
  const animeLatest = await evaluate(`(() => {
    const section = document.querySelector(
      '.latest-updates-section[aria-label="Latest anime updates"]'
    );
    const grid = section?.querySelector(".latest-updates-grid");
    return {
      cardCount: section?.querySelectorAll(".latest-update-card").length ?? 0,
      display: grid ? getComputedStyle(grid).display : null,
      columns: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      containsCarousel: Boolean(section?.querySelector(".content-carousel")),
    };
  })()`);
  if (animeLatest.cardCount !== 21 || animeLatest.display !== "grid") {
    throw new Error(`Latest Anime is not a 21-title grid: ${JSON.stringify(animeLatest)}`);
  }
  if (animeLatest.containsCarousel) throw new Error("Latest Anime still contains a carousel.");

  const animeTrendingBefore = await evaluate(
    `document.querySelector('.media-rail[aria-label^="Trending anime"] .rail-card strong')?.textContent`,
  );
  const latestNextSelector =
    '.latest-updates-section[aria-label="Latest anime updates"] .pagination > button:last-child';
  if (await evaluate(`!document.querySelector(${JSON.stringify(latestNextSelector)})?.disabled`)) {
    await click(latestNextSelector);
    await waitFor(
      `document.querySelector(
        '.latest-updates-section[aria-label="Latest anime updates"]'
      )?.getAttribute("aria-busy") === "false" &&
      document.querySelector(
        '.latest-updates-section[aria-label="Latest anime updates"] .rail-count'
      )?.textContent?.includes("2")`,
      "latest-anime page 2",
    );
  }
  const animeTrendingAfter = await evaluate(
    `document.querySelector('.media-rail[aria-label^="Trending anime"] .rail-card strong')?.textContent`,
  );
  if (animeTrendingBefore !== animeTrendingAfter) {
    throw new Error("Paging Latest Anime changed the Trending rail.");
  }

  await click(".nav-links button:nth-child(2)");
  await waitFor(
    `document.querySelector(
      '.latest-updates-section[aria-label="Latest manga updates"]'
    )?.getAttribute("aria-busy") === "false"`,
    "the static latest-manga grid",
  );
  await evaluate(`document.querySelector(
    '.latest-updates-section[aria-label="Latest manga updates"]'
  )?.scrollIntoView({ block: "start" })`);
  await waitFor(
    `Array.from(document.querySelectorAll(
      '.latest-updates-section[aria-label="Latest manga updates"] .latest-update-art img'
    )).some((image) => image.naturalWidth > 0)`,
    "at least one MangaDex cover",
    20_000,
  );
  const mangaLatest = await evaluate(`(() => {
    const section = document.querySelector(
      '.latest-updates-section[aria-label="Latest manga updates"]'
    );
    const grid = section?.querySelector(".latest-updates-grid");
    const images = Array.from(section?.querySelectorAll(".latest-update-art img") ?? []);
    const tags = Array.from(section?.querySelectorAll(".latest-kind-badge") ?? [])
      .map((tag) => tag.textContent?.trim())
      .filter(Boolean);
    return {
      cardCount: section?.querySelectorAll(".latest-update-card").length ?? 0,
      display: grid ? getComputedStyle(grid).display : null,
      columns: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      containsCarousel: Boolean(section?.querySelector(".content-carousel")),
      imageCount: images.length,
      loadedImages: images.filter((image) => image.naturalWidth > 0).length,
      tagCount: tags.length,
      tags: [...new Set(tags)],
    };
  })()`);
  if (
    mangaLatest.cardCount !== 21 ||
    mangaLatest.display !== "grid" ||
    mangaLatest.tagCount !== mangaLatest.cardCount ||
    mangaLatest.loadedImages < 1
  ) {
    throw new Error(`Latest Manga grid verification failed: ${JSON.stringify(mangaLatest)}`);
  }
  if (mangaLatest.containsCarousel) throw new Error("Latest Manga still contains a carousel.");

  const successfulMegaPlayResponse = megaPlayResponses.some(
    (response) => response.status >= 200 && response.status < 400,
  );
  if (!successfulMegaPlayResponse) {
    throw new Error(
      `MegaPlay did not return a successful frame response: ${JSON.stringify(megaPlayResponses)}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        initial,
        title,
        episodeLabel,
        player,
        embeddedDocument,
        megaPlayResponses,
        returned,
        returnedByButton,
        animeLatest,
        animeTrendingStable: animeTrendingBefore === animeTrendingAfter,
        mangaLatest,
      },
      null,
      2,
    ),
  );
} finally {
  socket.close();
}

function flattenFrames(node) {
  return [node, ...(node.childFrames ?? []).flatMap((child) => flattenFrames(child))];
}
