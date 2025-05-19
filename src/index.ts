import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import routes from "./routes.js";
import cookieParser from "cookie-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.use(cookieParser());
app.use(express.json());

app.use(routes);

app.get("/", (_, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
    console.log(`\nhttps://localhost:${port},\n${new Date().toLocaleString()}`);
});
