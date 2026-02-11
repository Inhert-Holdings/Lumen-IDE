import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// React entry point for the Lumen IDE renderer.
const root = createRoot(document.getElementById("root"));
root.render(<App />);
