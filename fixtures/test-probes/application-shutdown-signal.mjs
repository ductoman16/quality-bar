import { installApplicationSignalHandlers } from "../../src/application/application-shutdown.ts";

installApplicationSignalHandlers({
  close() {
    process.stdout.write("closing\n");
    return new Promise(() => {});
  },
});

process.stdout.write("ready\n");
setInterval(() => {}, 60_000);
