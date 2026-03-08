import cliProgress from "cli-progress";

export function createProgressBar(label?: string): cliProgress.SingleBar {
  const format = label
    ? `  ${label}  {bar}  {percentage}%  {value}/{total}`
    : "  {bar}  {percentage}%  {value}/{total}";

  return new cliProgress.SingleBar(
    {
      format,
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: true,
    },
    cliProgress.Presets.shades_classic,
  );
}
