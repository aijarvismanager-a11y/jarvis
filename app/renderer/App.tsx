import { useTheme } from './design/useTheme';
import { AppProvider, useAppState } from './state';
import { Shell } from './shell/Shell';
import { FirstRunWizard } from './screens/FirstRunWizard';

function AppInner() {
  useTheme();
  const { settings, loading } = useAppState();

  if (loading || !settings) {
    return <div className="app-loading">読み込み中…</div>;
  }

  if (!settings.firstRunCompleted) {
    return <FirstRunWizard />;
  }

  return <Shell />;
}

export function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}
