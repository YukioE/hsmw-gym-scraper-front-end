import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import routes from "./routes.js";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const limiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: "Too many requests, please try again later.",
    skip: (req, _) => {
        return req.ip === "127.0.0.1";
    },
});

app.use(limiter);
app.use(express.static(__dirname));
app.use(helmet());
app.use(cookieParser());
app.use(express.json());

app.use(routes);

app.get("/", (_, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
    console.log(`\nhttps://localhost:${port},\n${new Date().toLocaleString()}`);
});
