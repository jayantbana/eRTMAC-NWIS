import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/plus-jakarta-sans";
import App from "./App";
import { applyTextSize, getTextSize } from "./textsize";
import "./styles.css";

applyTextSize(getTextSize());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
