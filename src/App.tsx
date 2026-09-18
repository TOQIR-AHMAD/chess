import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { Header } from '@/components/ui/Header';
import { Sidebar } from '@/components/ui/Sidebar';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { SettingsProvider } from '@/hooks/useSettings';
import { ShellProvider } from '@/hooks/useShell';
import { HomePage } from '@/pages/HomePage';
import { PlayerPage } from '@/pages/PlayerPage';
import { GameAnalysisPage } from '@/pages/GameAnalysisPage';
import { InsightsPage } from '@/pages/InsightsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { INSIGHTS_PATH, SETTINGS_PATH } from '@/utils/routes';

/**
 * A page opened by a link starts at its top, the way a pushed view does — so its
 * large title is where the bar expects it. Back and forward are left to the
 * browser, which returns to where the reader was.
 */
function ScrollToTopOnPush() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo(0, 0);
  }, [navigationType, pathname]);

  return null;
}

export default function App() {
  return (
    <SettingsProvider>
      <BrowserRouter>
        {/* Inside the router: the sidebar and the bar both navigate. */}
        <ShellProvider>
          <ScrollToTopOnPush />
          {/* `app-shell` / `app-main` are the hooks a `page-fit` page locks to the viewport. */}
          <div className="app-shell flex min-h-dvh">
            <Sidebar />
            <div className="app-main flex min-h-dvh min-w-0 flex-1 flex-col">
              <Header />
              {/*
                A query container: page layouts follow the width they are actually
                given — which the sidebar changes — rather than the window's.
              */}
              <main className="content-wrapper @container flex-1">
                <ErrorBoundary>
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/player/:username" element={<PlayerPage />} />
                    <Route path={INSIGHTS_PATH} element={<InsightsPage />} />
                    <Route path={SETTINGS_PATH} element={<SettingsPage />} />
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
