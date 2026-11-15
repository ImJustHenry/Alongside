import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./style.css";
import Preview from "./Preview.jsx";
createRoot(document.getElementById("root")).render(
  new URLSearchParams(location.search).get("preview") === "1" ? (
    <Preview />
  ) : (
    <App />
  ),
);
