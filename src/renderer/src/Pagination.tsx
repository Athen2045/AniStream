import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
import { useId, useMemo } from "react";
import { motionTransition } from "./motion";
import { useAppReducedMotion } from "./useAppReducedMotion";

const ELLIPSIS = "ellipsis" as const;
type PageItem = number | typeof ELLIPSIS;

function buildPageRange(page: number, totalPages: number, siblings = 1): PageItem[] {
  const totalSlots = siblings * 2 + 5;
  if (totalPages <= totalSlots) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const left = Math.max(page - siblings, 2);
  const right = Math.min(page + siblings, totalPages - 1);
  const items: PageItem[] = [1];

  if (left > 2) items.push(ELLIPSIS);
  else for (let value = 2; value < left; value += 1) items.push(value);

  for (let value = left; value <= right; value += 1) items.push(value);

  if (right < totalPages - 1) items.push(ELLIPSIS);
  else for (let value = right + 1; value < totalPages; value += 1) items.push(value);

  items.push(totalPages);
  return items;
}

export function Pagination({
  label = "Catalog pages",
  page,
  totalPages,
  hasNextPage,
  onPageChange,
}: {
  label?: string;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  onPageChange: (page: number) => void;
}): React.JSX.Element {
  const reducedMotion = useAppReducedMotion();
  const id = useId();
  const items = useMemo(() => buildPageRange(page, Math.max(page, totalPages)), [page, totalPages]);

  return (
    <nav className="pagination" aria-label={label}>
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Go to previous page"
      >
        <ChevronLeft size={17} />
        <span>Previous</span>
      </button>
      <ol>
        {items.map((item, index) =>
          item === ELLIPSIS ? (
            <li className="pagination-ellipsis" key={`ellipsis-${index}`} aria-hidden="true">
              …
            </li>
          ) : (
            <motion.li
              key={item}
              initial={reducedMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                ...motionTransition(reducedMotion, "fast"),
                delay: reducedMotion ? 0 : Math.min(index, 4) * 0.02,
              }}
            >
              <button
                type="button"
                className={item === page ? "active" : ""}
                aria-current={item === page ? "page" : undefined}
                onClick={() => onPageChange(item)}
              >
                {item === page ? (
                  <motion.span
                    className="pagination-indicator"
                    layoutId={`pagination-${id}`}
                    transition={motionTransition(reducedMotion, "standard")}
                  />
                ) : null}
                <span>{item}</span>
              </button>
            </motion.li>
          ),
        )}
      </ol>
      <button
        type="button"
        disabled={!hasNextPage}
        onClick={() => onPageChange(page + 1)}
        aria-label="Go to next page"
      >
        <span>Next</span>
        <ChevronRight size={17} />
      </button>
    </nav>
  );
}
