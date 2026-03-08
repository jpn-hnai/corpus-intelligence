import figlet from "figlet";
import boxen from "boxen";
import { c } from "./colors.js";

export function printBanner(): void {
  const art = figlet.textSync("CORPUS", { font: "ANSI Shadow" });
  const version = "v0.1.0";
  const tagline = c.dim("private intelligence for your writing");

  const banner = boxen(
    `${c.primary(art)}\n${tagline}  ${c.dim(version)}`,
    {
      padding: { top: 0, bottom: 0, left: 2, right: 2 },
      borderStyle: "round",
      borderColor: "#7c6aff",
    },
  );
  console.log(banner);
  console.log();
}
