import { Button } from "@/components/ui/button";

interface ListPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  lang: "bn" | "en";
}

export function ListPagination({ page, pageSize, total, onPageChange, lang }: ListPaginationProps) {
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount <= 1) return null;
  const currentPage = Math.min(page, pageCount - 1);
  return (
    <nav
      aria-label={lang === "bn" ? "তালিকার পৃষ্ঠা" : "List pages"}
      className="mt-4 flex items-center justify-between gap-3"
    >
      <Button
        type="button"
        variant="outline"
        disabled={currentPage === 0}
        onClick={() => onPageChange(currentPage - 1)}
      >
        {lang === "bn" ? "আগের" : "Previous"}
      </Button>
      <span className="text-sm" aria-live="polite">
        {currentPage + 1} / {pageCount}
      </span>
      <Button
        type="button"
        variant="outline"
        disabled={currentPage + 1 >= pageCount}
        onClick={() => onPageChange(currentPage + 1)}
      >
        {lang === "bn" ? "পরের" : "Next"}
      </Button>
    </nav>
  );
}
