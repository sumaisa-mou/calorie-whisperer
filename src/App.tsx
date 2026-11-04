import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { getToken } from './lib/api';
import { Loading, TabBar } from './components/ui';
import Login from './pages/Login';
import Today from './pages/Today';
import Meals from './pages/Meals';
import MealEdit from './pages/MealEdit';
import Settings from './pages/Settings';
import Chat from './pages/Chat';
import Workout from './pages/Workout';

// Recharts is heavy — only load it when a chart page is opened.
const WeightPage = lazy(() => import('./pages/Weight'));
const Charts = lazy(() => import('./pages/Charts'));

export default function App() {
  const [signedIn, setSignedIn] = useState(() => !!getToken());
  const qc = useQueryClient();

  useEffect(() => {
    const onLogout = () => {
      setSignedIn(!!getToken());
      qc.clear();
    };
    window.addEventListener('ft:logout', onLogout);
    return () => window.removeEventListener('ft:logout', onLogout);
  }, [qc]);

  if (!signedIn) return <Login onSignedIn={() => setSignedIn(true)} />;

  return (
    <>
      <main className="app">
        <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/meals" element={<Meals />} />
          <Route path="/meals/new" element={<MealEdit />} />
          <Route path="/meals/:id" element={<MealEdit />} />
          <Route path="/workout" element={<Workout />} />
          <Route path="/weight" element={<WeightPage />} />
          <Route path="/charts" element={<Charts />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>
      <TabBar />
    </>
  );
}
