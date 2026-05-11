export function AttachmentRemoveButton({
  onClick,
}: {
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="absolute -top-1 -right-1 z-10 flex size-4 cursor-pointer items-center justify-center rounded-full border border-border/50 bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
      onClick={onClick}
      aria-label="移除附件"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M3 3l6 6M9 3l-6 6" />
      </svg>
    </button>
  )
}
