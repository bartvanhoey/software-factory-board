import { EXIT, UsageError, errorMessage } from "./errors.js";
import { main } from "./cli.js";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(errorMessage(e));
    process.exit(e instanceof UsageError ? e.exitCode : EXIT.failed);
  },
);
