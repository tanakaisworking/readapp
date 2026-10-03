import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useSettings } from "@/hooks/useSettings";
import { Home } from "@/views/home";
import { AppDetail } from "@/views/app-detail";
import { Onboarding } from "@/views/onboarding";
import "./index.css";

type View = { name: "home" } | { name: "app"; appId: string };

function App() {
  const api = useSettings();
  const { state, personas, platform } = api;
  const [view, setView] = useState<View>({ name: "home" });
  const [speaking, setSpeaking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // システムの外観に追従 (DESIGN.md ダークモード)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const preview = useCallback(
    async (appId: string, title: string, body: string) => {
      setSpeaking(true);
      try {
        await api.speak(appId, title, body);
      } catch {
        /* 読み上げ失敗は黙って終える */
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSpeaking(false), 4000);
    },
    [api],
  );

  const previewDefault = useCallback(
    () => preview("preview", "テスト", "通知読み上げの実験です。作業が完了しました。"),
    [preview],
  );

  if (!state) {
    return (
      <MotionConfig reducedMotion="user">
      <main className="flex min-h-screen items-center justify-center">
        <motion.span
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          className="h-3 w-3 rounded-full bg-primary"
        />
      </main>
      </MotionConfig>
    );
  }

  if (!state.onboarded) {
    return (
      <MotionConfig reducedMotion="user">
      <main className="min-h-screen">
        <Onboarding
          personas={personas}
          platform={platform}
          speaking={speaking}
          onPreview={previewDefault}
          onPickDefaultPersona={(id) => void api.setPersona(id)}
          onDone={() => void api.setOnboarded(true)}
        />
      </main>
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
    <main className="min-h-screen">
      <AnimatePresence mode="wait">
        <motion.div
          key={view.name === "app" ? view.appId : "home"}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {view.name === "app" ? (
            <AppDetail
              api={api}
              state={state}
              appId={view.appId}
              platform={platform}
              speaking={speaking}
              onBack={() => setView({ name: "home" })}
              onPreviewApp={(id) =>
                void preview(id, "テスト", "通知読み上げの実験です。作業が完了しました。")
              }
            />
          ) : (
            <Home
              api={api}
              state={state}
              personas={personas}
              platform={platform}
              speaking={speaking}
              onPreview={previewDefault}
              onOpenApp={(id) => setView({ name: "app", appId: id })}
              onPickPersona={(id) => void api.setPersona(id)}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </main>
    </MotionConfig>
  );
}

export default App;
