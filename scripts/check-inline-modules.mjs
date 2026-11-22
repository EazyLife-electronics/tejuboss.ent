import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = ["structured-shop.html"];
for (const file of files) {
  const html = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const blocks = [...html.matchAll(/<script\\s+type=["']module["']\\s*>([\\s\\S]*?)<\\/script>/gi)];
  if (!blocks.length) throw new Error("No inline module script found in " + file);
  for (let index = 0; index < blocks.length; index += 1) {
    const check = spawnSync(process.execPath, ["--check", "--input-type=module"], {
      input: blocks[index][1], encoding: "utf8"
    });
    if (check.status !== 0) {
      process.stderr.write(check.stderr || check.stdout);
      throw new Error("Inline module syntax failed in " + file + " (block " + (index + 1) + ")");
    }
  }
}
process.stdout.write("Structured storefront inline module syntax passed.\\n");
