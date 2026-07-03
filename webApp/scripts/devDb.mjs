// Dev Postgres tempatan (binari dalam node_modules, tiada install sistem).
// Guna: node scripts/devDb.mjs   (biar berjalan; Ctrl+C untuk henti)
// App dev connect ke: postgresql://dev:dev@localhost:5433/dicci
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "devPgData");

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "dev",
  password: "dev",
  port: 5433,
  persistent: true,
});

if (!existsSync(join(dataDir, "PG_VERSION"))) {
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase("dicci");
} catch {
  // dah wujud
}
console.log("dev postgres sedia: postgresql://dev:dev@localhost:5433/dicci");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
