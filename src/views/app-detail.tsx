import { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronLeft, Download, Play } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppAvatar } from "@/components/app-avatar";
import { CharacterImage } from "@/components/character-image";
import { knownApp, type Persona } from "@/lib/apps";
import { styleLabel, type Character } from "@/lib/characters";
import { voiceName, type SystemVoice } from "@/lib/voices";
import { cn } from "@/lib/utils";
import { isOn, type SettingsApi } from "@/hooks/useSettings";
import type { FullState } from "@/lib/apps";

interface Props {
  api: SettingsApi;
  state: FullState;
  appId: string;
  platform: string;
  edition: string;
  speaking: boolean;
  personas: Persona[];
  customs: Record<string, string | null | undefined>;
  systemVoices: SystemVoice[];
  onBack: () => void;
  onPreviewApp: (appId: string) => void;
}

export function AppDetail({ api, state, appId, platform, edition, speaking, personas, customs, systemVoices, onBack, onPreviewApp }: Props) {
  const app = knownApp(appId);
  const appName = state.names[appId] ?? app.name;
  const on = isOn(state, appId);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [linked, setLinked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [axOn, setAxOn] = useState(false);
  const busy = useRef(false);
  // 担当キャラ (いなければ、いま話すキャラが読む)
  const assigned = state.characters.some((c) => c.id === state.app_characters[appId]) ? state.app_characters[appId] : null;
  const activeCharacter = state.characters.find((c) => c.id === state.active_character);

  // キャラを選んだらすぐ、そのキャラで試しに喋る
  const pickCharacter = async (characterId: string | null) => {
    await api.setAppCharacter(appId, characterId);
    onPreviewApp(appId);
  };

  useEffect(() => {
    invoke<boolean>("shortcut_installed", { appId }).then(setInstalled).catch(() => setInstalled(false));
    if (platform === "macos") {
      invoke<boolean>("ax_trusted").then(setAxOn).catch(() => setAxOn(false));
    }
  }, [appId, platform]);

  // 登録作業から戻ってきたら自動で検出し直す (ポーリングなし)。
  // 空文の実行は無音で、受信記録だけが残る。
  useEffect(() => {
    if (platform !== "macos") return;
    let unlisten: (() => void) | null = null;
    getCurrentWindow()
      .onFocusChanged((e) => {
        if (e.payload) {
          invoke<boolean>("ax_trusted").then(setAxOn).catch(() => {});
          void refreshStatus(true);
        }
      })
      .then((f) => {
        unlisten = f;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [appId, platform]);

  const download = async () => {
    try {
      const path = await invoke<string>("download_shortcut", { appId });
      setSavedPath(path);
    } catch {
      setSavedPath(null);
    }
  };

  const refreshStatus = async (autoLink: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    try {
      const ok = await invoke<boolean>("shortcut_installed", { appId });
      setInstalled(ok);
      if (!ok) {
        setLinked(false);
        return;
      }
      // 初めて繋がったアプリは読み上げ対象に加える (明示OFFは尊重する)
      if (state.enabled[appId] === undefined) {
        await api.setEnabled(appId, true);
      }
      if (autoLink) {
        const t0 = Date.now();
        await invoke("run_shortcut", { appId }).catch(() => {});
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const last = await invoke<{ app_id: string; at: number } | null>("get_last_received").catch(() => null);
          if (last && last.app_id === appId && last.at * 1000 >= t0 - 3000) {
            setLinked(true);
            break;
          }
        }
      }
    } finally {
      busy.current = false;
      setChecking(false);
    }
  };

  const shortcutBadge = linked
    ? { label: "つながっています", tone: "badge-success" }
    : installed
      ? { label: "登録済み", tone: "badge-primary" }
      : { label: "未登録", tone: "badge-ghost" };
  const characterChoices: { id: string | null; name: string; note: string; character: Character | undefined }[] = [
    { id: null, name: "全体のキャラに任せる", note: activeCharacter ? "今は" + activeCharacter.name + "が読みます" : "", character: activeCharacter },
    ...state.characters.map((c) => ({ id: c.id as string | null, name: c.name, note: voiceName(c.voice, systemVoices) + " · " + styleLabel(c.style, personas), character: c })),
  ];

  return (
    <div className="space-y-5 px-4 pb-6 pt-3">
      <header className="flex items-center gap-1.5">
        <button type="button" onClick={onBack} aria-label="もどる" className="btn btn-ghost btn-sm btn-circle -ms-1">
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <h1 className="truncate text-base font-semibold">{appName}</h1>
      </header>

      <section aria-label="読み上げ" className="surface p-4">
        <div className="flex items-center gap-3">
          <AppAvatar id={appId} name={appName} color={app.color} large />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">読み上げる</p>
            <p className="mt-0.5 text-xs text-muted">{on ? "通知が来たら声でお知らせ" : "今は読み上げません"}</p>
          </div>
          <input
            type="checkbox"
            role="switch"
            className="toggle toggle-primary"
            checked={on}
            onChange={(e) => void api.setEnabled(appId, e.target.checked)}
            aria-label={`${appName}の読み上げ`}
          />
        </div>
        {on && (
          <button type="button" className="btn btn-primary btn-block mt-4" onClick={() => onPreviewApp(appId)} disabled={speaking}>
            {speaking ? <span className="loading loading-dots loading-xs" aria-hidden="true" /> : <Play aria-hidden="true" />}
            {speaking ? "話しています" : "試しに喋る"}
          </button>
        )}
      </section>

      {on && (
        <>
          <section aria-labelledby="app-character-heading">
            <h2 id="app-character-heading" className="section-label">このアプリのキャラ</h2>
            <p className="mt-1 px-1 text-xs leading-relaxed text-muted">{appName}の通知を読むキャラを決められます。そのキャラの声と話し方で読みます。</p>
            <ul className="surface mt-2 space-y-0.5 p-1.5">
              {characterChoices.map((c) => {
                const selected = assigned === c.id;
                return (
                  <li key={c.id ?? "active"}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      disabled={speaking}
                      onClick={() => void pickCharacter(c.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-field px-2.5 py-2 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60",
                        selected ? "bg-primary/10" : "hover:bg-base-200",
                      )}
                    >
                      <CharacterImage character={c.character} customs={customs} className={cn("size-9 rounded-[10px]", c.id === null && "opacity-70")} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.name}</span>
                        {c.note && <span className="block truncate text-xs text-muted">{c.note}</span>}
                      </span>
                      <Check className={cn("size-4 shrink-0 text-primary transition-opacity", selected ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {platform === "macos" && edition !== "mas" && !axOn && (
            <section aria-labelledby="app-shortcut-heading">
              <h2 id="app-shortcut-heading" className="section-label">ショートカット</h2>
              <div className="surface mt-2 p-4">
                <div className="flex items-center gap-2">
                  <span className={`badge badge-soft badge-sm ${shortcutBadge.tone}`}>
                    {linked && <CheckCircle2 className="size-3" aria-hidden="true" />}
                    {shortcutBadge.label}
                  </span>
                  {checking && (
                    <span className="flex items-center gap-1.5 text-xs text-muted" role="status">
                      <span className="loading loading-spinner loading-xs" aria-hidden="true" />
                      確認中…
                    </span>
                  )}
                </div>
                {installed === null ? null : installed ? (
                  <p className="mt-2 text-[13px] leading-relaxed text-muted">
                    通知オートメーションで「ショートカットを実行」を選べば、このアプリの通知が届きます。
                  </p>
                ) : (
                  <>
                    <p className="mt-2 text-[13px] leading-relaxed text-muted">
                      ダウンロード→ダブルクリックで登録し、通知オートメーションで「ショートカットを実行」を選ぶだけです。
                    </p>
                    <button type="button" className="btn btn-sm btn-block mt-3" onClick={() => void download()}>
                      <Download aria-hidden="true" />
                      ダウンロード
                    </button>
                    {savedPath && (
                      <p className="mt-2 text-xs leading-relaxed text-muted">保存しました: {savedPath.split("/").pop()}（ダウンロード内）</p>
                    )}
                  </>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
