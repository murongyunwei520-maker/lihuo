import { createServer } from "vite";

const target = process.argv[2];
if (!target) throw new Error("missing target script");
const server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
});
try {
    await server.ssrLoadModule(target);
} finally {
    await server.close();
}
