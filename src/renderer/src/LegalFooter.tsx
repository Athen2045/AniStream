import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LEGAL_CONTACT, LEGAL_FOOTER, LEGAL_POLICY } from "./legal";

/** The Copyright & DMCA footer line for the bottom of the Anime, Manga and More sections. */
export function LegalFooter({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <footer className="legal-footer">
      {children}
      <p>
        {LEGAL_FOOTER} Copyright concerns: see{" "}
        <button type="button" className="legal-footer-link" onClick={() => setOpen(true)}>
          Copyright &amp; DMCA
        </button>
        .
      </p>
      {open ? <LegalDialog onClose={() => setOpen(false)} /> : null}
    </footer>
  );
}

/** The full policy, readable offline; links open in the browser. */
function LegalDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    // A native listener: Escape, the close button and the backdrop all end in "close".
    const closed = (): void => closeRef.current();
    element.addEventListener("close", closed);
    return () => element.removeEventListener("close", closed);
  }, []);
  return (
    <dialog
      ref={dialog}
      className="legal-dialog"
      aria-labelledby="legal-dialog-title"
      onClick={(event) => {
        // A click on the backdrop (the dialog element itself) closes it.
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <div className="legal-dialog-body">
        <header>
          <h2 id="legal-dialog-title">Copyright &amp; DMCA</h2>
          <button
            type="button"
            className="legal-dialog-close"
            aria-label="Close"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <p className="legal-dialog-lead">{LEGAL_FOOTER}</p>
        {LEGAL_POLICY.map((section) => (
          <section key={section.heading}>
            <h3>{section.heading}</h3>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{linkify(paragraph)}</p>
            ))}
            {section.list ? (
              <ol>
                {section.list.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            ) : null}
            {section.after?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </div>
    </dialog>
  );
}

/** Turns the GitHub contact URLs in a paragraph into links (opened in the browser). */
function linkify(text: string): React.ReactNode {
  const urls = [LEGAL_CONTACT.issues, LEGAL_CONTACT.profile];
  const parts = text.split(new RegExp(`(${urls.map(escape).join("|")})`));
  return parts.map((part, index) =>
    urls.includes(part) ? (
      <a key={index} href={part} target="_blank" rel="noreferrer">
        {part.replace("https://", "")}
      </a>
    ) : (
      part
    ),
  );
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
