import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Header } from '@/components/ui/Header';
import { Sidebar } from '@/components/ui/Sidebar';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { SettingsProvider } from '@/hooks/useSettings';
import { ShellProvider } from '@/hooks/useShell';
import { HomePage } from '@/pages/HomePage';
import { PlayerPage } from '@/pages/PlayerPage';
import { GameAnalysisPage } from '@/pages/GameAnalysisPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export default function App() {
  return (
    <SettingsProvider>
      <BrowserRouter>
        {/* Inside the router: the rail and the navbar both navigate. */}
        <ShellProvider>
          {/* `app-shell` / `app-main` are the hooks a `page-fit` page locks to the viewport. */}
          <div className="app-shell flex min-h-dvh">
            <Sidebar />
            <div className="app-main flex min-h-dvh min-w-0 flex-1 flex-col">
              <Header />
              {/* The console's content wrapper: the slate field the pages sit on. */}
              <main className="content-wrapper flex-1">
                <ErrorBoundary>
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/player/:username" element={<PlayerPage />} />
                    <Route path="/analyze/:username/:gameId" element={<GameAnalysisPage />} />
                    {/* Legacy/short form: no username means we cannot resolve the archive. */}
                    <Route path="/analyze/:username" element={<Navigate to="/" replace />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </ErrorBoundary>
              </main>
            </div>
          </div>
        </ShellProvider>
      </BrowserRouter>
    </SettingsProvider>
  );
}
