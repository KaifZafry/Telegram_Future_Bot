import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

const readline = createInterface({ input, output });

export const ask = async (question: string, defaultValue?: string): Promise<string> => {
  const suffix = defaultValue !== undefined && defaultValue !== "" ? ` [${defaultValue}]` : "";
  const answer = (await readline.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue || "";
};

export const askNumber = async (question: string, defaultValue: number): Promise<number> => {
  for (;;) {
    const value = Number(await ask(question, String(defaultValue)));

    if (Number.isFinite(value)) {
      return value;
    }

    console.log("  Please enter a number.");
  }
};

export const askYesNo = async (question: string, defaultValue: boolean): Promise<boolean> =>
  /^y/i.test(await ask(`${question} (y/n)`, defaultValue ? "y" : "n"));

export const closePrompt = (): void => {
  readline.close();
};
