// Test-only helper. Lets `node --test` load our TypeScript files the way the
// app does: imports without ".ts" at the end and the "@/..." shortcut.
// Used by `npm test`. Not part of the app.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
