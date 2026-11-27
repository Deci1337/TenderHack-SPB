import { Link, Routes, Route } from "react-router-dom";
import SearchPage from "./pages/SearchPage";
import ResultsPage from "./pages/ResultsPage";

export default function App() {
  return (
    <>
      <a href="#main" className="skip-link">
        К основному содержимому
      </a>
      <header className="portal-header">
        <Link to="/" aria-label="Портал поставщиков — поиск цен">
          <img
            src="/portal-logo.svg"
            alt="Портал поставщиков"
            width="180"
            height="40"
          />
        </Link>
        <span className="header-section">Поиск цен</span>
        <span className="header-context">Система поиска цен</span>
      </header>
      <Routes>
        <Route path="/" element={<SearchPage />} />
        <Route path="/results" element={<ResultsPage />} />
      </Routes>
      <footer className="portal-footer">
        <span>Система для Портала поставщиков</span>
        <span>Поиск предложений для обоснования закупки</span>
      </footer>
    </>
  );
}
