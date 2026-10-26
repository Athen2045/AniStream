/**
 * The main process refuses every new window, so embedded players cannot open pop-ups. AniStream's
 * own `target="_blank"` links are sent to the default browser here instead: any click or
 * middle-click on one in this document (player frames are other documents and never reach it).
 */
export function installExternalLinks(): void {
  const open = (event: MouseEvent): void => {
    if (event.defaultPrevented || (event.type === "auxclick" && event.button !== 1)) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement)) return;
    if (link.target !== "_blank" || !link.href.startsWith("https:")) return;
    event.preventDefault();
    void window.anistream.openLink(link.href);
  };
  document.addEventListener("click", open);
  document.addEventListener("auxclick", open);
}
