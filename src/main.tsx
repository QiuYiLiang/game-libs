import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { App } from "./App";
import { DEFAULT_CATEGORY_PATH } from "./types";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={<Navigate to={`/c/${DEFAULT_CATEGORY_PATH}`} replace />}
        />
        <Route path="/c/:category" element={<App />} />
        <Route path="/c/:category/game/:gameId" element={<App />} />
        <Route path="/search" element={<App />} />
        <Route path="/search/game/:gameId" element={<App />} />
        <Route
          path="*"
          element={<Navigate to={`/c/${DEFAULT_CATEGORY_PATH}`} replace />}
        />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
