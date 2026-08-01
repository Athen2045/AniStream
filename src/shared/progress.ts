export function isProgressComplete(
  status: string,
  progress: number,
  totalProgress?: number,
): boolean {
  return (
    status === "COMPLETED" ||
    (totalProgress !== undefined && totalProgress > 0 && progress >= totalProgress)
  );
}
