import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";       // <-- add .tsx extension
import "./index.css";              // <-- add .css extension

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
