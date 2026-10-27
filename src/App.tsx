import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "@/hooks/useSettings";
import { Home } from "@/views/home";
import { AppDetail } from "@/views/app-detail";
import { CharacterEditor } from "@/views/character-editor";
import { Onboarding } from "@/views/onboarding";
import { SpeechIssueNotice } from "@/components/speech-issue-notice";
import { useCustomImages } from "@/lib/characters";
import { OPEN_CHARACTER_EVENT, OPEN_CHARACTER_KEY } from "@/lib/companion-window";
import { useSystemVoices } from "@/lib/voices";
import "./index.css";

type View = { name: "home" } | { name: "app"; appId: string } | { name: "character"; id: string };

const SAMPLE = { title: "テスト", body: "通知読み上げの実験です。作業が完了しました。" };

function App() {
  const api = useSettings();
  const { state, personas, platform, edition } = api;
  const [view, setView] = useState<View>({ name: "home" });
  const [speaking, setSpeaking] = useState(false);
  const [dismissedIssue, setDismissedIssue] = useState<string | null>(null);
  const issueId = api.speechIssue ? JSON.stringify(api.speechIssue) : null;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customs = useCustomImages(state?.characters);
  const systemVoices = useSystemVoices();

  useEffect(() => {
    if (!issueId) setDismissedIssue(null);
  }, [issueId]);

  useEffect(() => {
    if (state?.speech_enabled === false || state?.volume === 0) {
      if (timer.current) clearTimeout(timer.current);
      setSpeaking(false);
    }
  }, [state?.speech_enabled, state?.volume]);

  // 小窓の「キャラを編集」から開かれた時は、そのキャラの編集を出す
  useEffect(() => {
    const openCharacter = (id: string) => {
      try { localStorage.removeItem(OPEN_CHARACTER_KEY); } catch { /* 消せなくても開く */ }
      setView({ name: "character", id });
    };
    try {
      const pending = localStorage.getItem(OPEN_CHARACTER_KEY);
      if (pending) openCharacter(pending);
    } catch { /* 読めなければホームのまま */ }
    let off: (() => void) | undefined;
    let disposed = false;
    listen<string>(OPEN_CHARACTER_EVENT, ({ payload }) => openCharacter(payload))
      .then((f) => (disposed ? f() : (off = f)))
      .catch(() => {});
    return () => { disposed = true; off?.(); };
  }, []);

  const preview = useCallback(
    async (appId: string, characterId?: string) => {
      if (api.state?.speech_enabled === false || api.state?.volume === 0) return;
      setSpeaking(true);
      try {
        await api.speak(appId, SAMPLE.title, SAMPLE.body, characterId);
      } catch {
        /* 読み上げ失敗は黙って終える */
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSpeaking(false), 4000);
    },
    [api],
  );

  const previewDefault = useCallback(() => preview("preview"), [preview]);
  const goHome = useCallback(() => setView({ name: "home" }), []);

  if (!state) {
    return (
      <MotionConfig reducedMotion="user">
      <main className="flex min-h-screen items-center justify-center">
        <span className="loading loading-dots loading-md text-primary" aria-label="読み込み中" />
      </main>
      </MotionConfig>
    );
  }

  if (!state.onboarded) {
    return (
      <MotionConfig reducedMotion="user">
      <main className="min-h-screen">
        <Onboarding
          api={api}
          state={state}
          personas={personas}
          customs={customs}
          platform={platform}
          edition={edition}
          speaking={speaking}
          onPreview={previewDefault}
          onDone={() => {
            void api.setOnboarded(true);
            // 設定を終えたら、普段見せる小窓を出す
            void invoke("show_companion").catch(() => {});
          }}
        />
      </main>
      </MotionConfig>
    );
  }

  const active = state.characters.find((c) => c.id === state.active_character);
  const useSystemVoice = active && state.voice === api.speechIssue?.voice_id
    ? async () => { await api.updateCharacter({ ...active, voice: "system" }); setDismissedIssue(issueId); }
    : undefined;
  const viewKey = view.name === "app" ? "app:" + view.appId : view.name === "character" ? "character:" + view.id : "home";

  return (
    <MotionConfig reducedMotion="user">
    <main className="min-h-screen">
      {api.speechIssue && issueId !== dismissedIssue && <div className="mx-4 mt-4">
        <SpeechIssueNotice issue={api.speechIssue} onDismiss={() => setDismissedIssue(issueId)} onUseSystem={useSystemVoice} />
      </div>}
      <AnimatePresence mode="wait">
        <motion.div
          key={viewKey}
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
              edition={edition}
              speaking={speaking}
              personas={personas}
              customs={customs}
              systemVoices={systemVoices}
              onBack={goHome}
              onPreviewApp={(id) => void preview(id)}
            />
          ) : view.name === "character" ? (
            <CharacterEditor
              api={api}
              state={state}
              personas={personas}
              characterId={view.id}
              customs={customs}
              systemVoices={systemVoices}
              speaking={speaking}
              onBack={goHome}
              onPreview={(id) => void preview("preview", id)}
            />
          ) : (
            <Home
              api={api}
              state={state}
              personas={personas}
              platform={platform}
              edition={edition}
              speaking={speaking}
              customs={customs}
              systemVoices={systemVoices}
              onPreview={previewDefault}
              onOpenApp={(id) => setView({ name: "app", appId: id })}
              onEditCharacter={(id) => setView({ name: "character", id })}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </main>
    </MotionConfig>
  );
}

export default App;
