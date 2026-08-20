import { defineApp } from "convex/server";
import aggregate from "@convex-dev/aggregate/convex.config.js";

const app = defineApp();

app.use(aggregate, { name: "orgNodeCountByType" });
app.use(aggregate, { name: "orgNodeCountByWorkspace" });
app.use(aggregate, { name: "orgNodeCountByParent" });

export default app;
