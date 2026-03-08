import ora, { type Ora } from "ora";

export function createSpinner(text: string): Ora {
  return ora({ text, color: "magenta", spinner: "dots" });
}

export async function withSpinner<T>(
  text: string,
  fn: () => Promise<T>,
): Promise<T> {
  const spinner = createSpinner(text);
  spinner.start();
  try {
    const result = await fn();
    spinner.succeed();
    return result;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}
