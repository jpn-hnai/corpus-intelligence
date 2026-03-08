import Conf from "conf";

interface CliConfig {
  apiKey?: string;
  corpusPath?: string;
  projectRoot?: string;
  installed?: boolean;
  lastInstallDate?: string;
}

export const config = new Conf<CliConfig>({
  projectName: "corpus-intelligence",
});
