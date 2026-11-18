import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireRole } from './auth/guards.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import VisitRecordingPage from './pages/VisitRecordingPage.jsx';
import PatientSearchPage from './pages/PatientSearchPage.jsx';
import PatientDetailPage from './pages/PatientDetailPage.jsx';
import PatientHistoryPage from './pages/PatientHistoryPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';

function NotFound() {
  return (
    <div className="page">
      <h1>Page not found</h1>
      <p>Use the menu to get back to recording visits.</p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/visit" replace />} />
          <Route path="visit" element={<VisitRecordingPage />} />
          <Route path="patients" element={<PatientSearchPage />} />
          <Route path="patients/:id" element={<PatientDetailPage />} />
          <Route element={<RequireRole role="ADMIN" />}>
            <Route path="admin/patients/:id/history" element={<PatientHistoryPage />} />
            <Route path="admin/reports" element={<ReportsPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
