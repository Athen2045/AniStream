// AniStream landing page. One requestAnimationFrame loop drives every scroll-linked value; entrances
// are CSS. With reduced motion nothing here animates and every section shows its final state.
const root = document.documentElement;
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

// Offer the installer for the visitor's system. Phones, tablets and Linux get both choices.
function detectOs() {
  if (/android|iphone|ipad|ipod/i.test(navigator.userAgent)) return "other";
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  if (/^win/i.test(platform)) return "windows";
  // iPadOS reports a Mac platform; a touch screen gives it away.
  if (/mac/i.test(platform)) return navigator.maxTouchPoints > 1 ? "other" : "mac";
  return "other";
}

function setupDownloads() {
  const os = detectOs();
  const button = $("[data-download]");
  const label = $("[data-download-label]", button);
  const icon = $("[data-os-icon]", button);
  const other = $("[data-other]");
  const meta = $("[data-meta]");
  const version = meta.dataset.version;
  if (os === "mac") {
    button.href = $('.dl[data-os="mac"]').href;
    label.textContent = "Download for macOS";
    icon.innerHTML = $("[data-mac-icon]").innerHTML;
    other.textContent = "Windows version";
    meta.textContent = `${version} · macOS 12 or newer, Apple Silicon`;
  } else if (os === "windows") {
    other.textContent = "macOS version";
  } else {
    button.href = "#download";
    label.textContent = "See downloads";
    icon.innerHTML = '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />';
    icon.classList.add("os-icon-line");
    other.hidden = true;
    meta.textContent = `${version} · A desktop app for Windows and macOS`;
  }
  $(`.dl[data-os="${os}"]`)?.classList.add("dl-match");
}

// The cover wall: five columns, each listing its covers twice so the drift loops seamlessly.
function buildWall() {
  const columns = [
    [1, 4, 7, 2, 9],
    [3, 8, 5, 6, 1],
    [9, 2, 6, 4, 7],
    [5, 1, 8, 3, 2],
    [7, 6, 3, 9, 4],
  ];
  $("[data-wall-tilt]").innerHTML = columns
    .map(
      (covers) =>
        `<div class="wall-col">${[...covers, ...covers]
          .map((n) => `<img src="img/wall/${n}.jpg" alt="" width="150" height="214" />`)
          .join("")}</div>`,
    )
    .join("");
}

// Welcome: the app's startup mark, then it flies to the brand in the top bar.
function playWelcome() {
  const welcome = $(".welcome");
  if (!root.classList.contains("welcoming")) {
    welcome.remove();
    return;
  }
  const mark = $("[data-welcome-mark]");
  const brand = $("[data-brand] img");
  const from = mark.getBoundingClientRect();
  const to = brand.getBoundingClientRect();
  mark.style.setProperty("--fly-x", `${to.left + to.width / 2 - (from.left + from.width / 2)}px`);
  mark.style.setProperty("--fly-y", `${to.top + to.height / 2 - (from.top + from.height / 2)}px`);
  mark.style.setProperty("--fly-s", (to.width / from.width).toFixed(3));
  // The hero's entrance delay stays in place after a full welcome, so nothing jumps; a skip
  // drops the delay and the hero comes in at once.
  const finish = (skipped) => {
    if (!welcome.isConnected) return;
    if (skipped) root.classList.add("welcome-skipped");
    welcome.remove();
  };
  welcome.addEventListener("animationend", (event) => event.target === welcome && finish(false));
  // Any key, click or scroll skips straight to the page.
  for (const type of ["keydown", "pointerdown", "wheel", "touchstart"]) {
    addEventListener(type, () => finish(true), { once: true, passive: true });
  }
}

// Smooth wheel scrolling. Touch and keyboard keep the browser's own scrolling.
function startSmoothScroll() {
  if (still || typeof Lenis !== "function") return null;
  const lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 0.9, anchors: true });
  window.lenis = lenis;
  return lenis;
}

function setupReveals() {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -12% 0px" },
  );
  $$(".reveal").forEach((el) => observer.observe(el));
}

// Privacy statement: wrap each word so it can light up as the sentence scrolls past.
function splitWords() {
  const statement = $("[data-words]");
  const wrap = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = child.textContent.split(/(\s+)/);
        const fragment = document.createDocumentFragment();
        for (const part of parts) {
          if (!part.trim()) {
            fragment.append(part);
            continue;
          }
          const word = document.createElement("span");
          word.className = "word";
          word.textContent = part;
          fragment.append(word);
        }
        child.replaceWith(fragment);
      } else {
        wrap(child);
      }
    }
  };
  wrap(statement);
  return $$(".word", statement);
}

// Pointer position for the wall's depth and the main button's pull.
function setupPointer(state) {
  addEventListener(
    "pointermove",
    (event) => {
      state.pointerX = event.clientX / innerWidth - 0.5;
      state.pointerY = event.clientY / innerHeight - 0.5;
    },
    { passive: true },
  );
  const magnet = $("[data-magnet]");
  magnet.addEventListener("pointermove", (event) => {
    const box = magnet.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width - 0.5) * 12;
    const y = ((event.clientY - box.top) / box.height - 0.5) * 12;
    magnet.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
  });
  magnet.addEventListener("pointerleave", () => (magnet.style.translate = ""));
}

// Top bar links: the section holding the middle of the screen is marked as the current one.
function setupNav() {
  const links = new Map($$("[data-nav-link]").map((a) => [a.dataset.navLink, a]));
  let current = "";
  return (id) => {
    if (id === current) return;
    current = id;
    for (const [key, link] of links) link.classList.toggle("active", key === id);
  };
}

function main() {
  setupDownloads();
  buildWall();
  playWelcome();
  setupReveals();
  const lenis = startSmoothScroll();
  const words = splitWords();
  const setNav = setupNav();
  const state = { pointerX: 0, pointerY: 0, wallX: 0, wallY: 0, scene: -1 };
  if (!still) setupPointer(state);

  const topbar = $("[data-topbar]");
  const heroCopy = $("[data-hero-copy]");
  const wall = $("[data-wall]");
  const tour = $("[data-tour]");
  const scenes = $$(".scene", tour);
  const dots = $$("[data-tour-dots] i");
  const bar = $("[data-tour-bar]");
  const statement = $("[data-words]");
  const sections = $$("[data-section]");
  const pinned = matchMedia("(min-width: 1000px)");

  function showScene(index) {
    if (index === state.scene) return;
    state.scene = index;
    scenes.forEach((scene, i) => {
      scene.classList.toggle("is-active", i === index);
      scene.classList.toggle("is-past", i < index);
    });
    dots.forEach((dot, i) => dot.classList.toggle("on", i === index));
    tour.style.setProperty("--glow", scenes[index].style.getPropertyValue("--tint"));
  }

  function frame(time) {
    requestAnimationFrame(frame);
    const y = scrollY;
    const vh = innerHeight;
    topbar.classList.toggle("scrolled", y > 8);

    if (!still) {
      // Hero: copy lifts away, the wall trails behind and leans toward the pointer.
      const out = clamp(y / (vh * 0.6));
      heroCopy.style.opacity = (1 - out * 1.1).toFixed(3);
      heroCopy.style.translate = `0 ${(-out * 48).toFixed(1)}px`;
      state.wallX += (state.pointerX * -24 - state.wallX) * 0.06;
      state.wallY += (state.pointerY * -24 - state.wallY) * 0.06;
      wall.style.translate = `${state.wallX.toFixed(1)}px ${(state.wallY + y * 0.35).toFixed(1)}px`;
    }

    // Tour: the window straightens as it arrives, then scenes follow scroll while pinned.
    const box = tour.getBoundingClientRect();
    tour.style.setProperty("--enter", clamp(1 - box.top / vh).toFixed(3));
    if (pinned.matches) {
      const progress = clamp(-box.top / (box.height - vh));
      bar.style.scale = `${progress.toFixed(4)} 1`;
      showScene(Math.min(scenes.length - 1, Math.floor(progress * scenes.length)));
    }

    // Privacy: words light up while the sentence crosses the middle of the screen.
    const s = statement.getBoundingClientRect();
    const lit = clamp((vh * 0.8 - s.top) / (s.height + vh * 0.35)) * words.length;
    words.forEach((word, i) => word.classList.toggle("lit", i < lit));

    // Top bar: mark the section that holds the middle of the screen.
    const middle = sections.find((section) => {
      const r = section.getBoundingClientRect();
      return r.top <= vh / 2 && r.bottom > vh / 2;
    });
    setNav(middle?.dataset.section ?? "");

    lenis?.raf(time);
  }
  showScene(0);
  requestAnimationFrame(frame);
}

main();
