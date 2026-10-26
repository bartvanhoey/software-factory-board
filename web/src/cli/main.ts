import { EXIT, run } from "./admin";

run(process.argv.slice(2), process.env, { out: (line) => console.log(line), err: (line) => console.error(line) }).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    // run() catches what it can; this is for the unexpected. 69 is the documented "could not complete".
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = EXIT.unavailable;
  },
);
