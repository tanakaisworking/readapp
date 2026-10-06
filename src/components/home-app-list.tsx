import { useEffect, useState } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { isOn, type SettingsApi } from "@/hooks/useSettings";
import { KNOWN_APPS, knownApp, type FullState } from "@/lib/apps";

interface Props {
  api: SettingsApi;
  state: FullState;
  onOpenApp: (id: string) => void;
  voiceNameOf: (id: string) => string | null;
}

export function HomeAppList({ api, state, onOpenApp, voiceNameOf }: Props) {
  const [observed, setObserved] = useState<{ id: string; name: string }[]>([]);
  // readapp自身のテスト通知は常に読むので、切り替えの対象にしない。
  const extraIds = Object.keys(state.enabled).filter((id) => id !== "readapp" && !KNOWN_APPS.some((a) => a.id === id));
  const apps = [...KNOWN_APPS, ...extraIds.map((id) => knownApp(id))];
  // 普段の操作を4件に絞る。切り替え中に行が動かないよう、ホームを開いた時の順番を保つ。
  const [primaryIds] = useState(() => [
    ...apps.filter((app) => isOn(state, app.id)),
    ...apps.filter((app) => !isOn(state, app.id)),
  ].slice(0, 4).map((app) => app.id));
  const remaining = apps.filter((app) => !primaryIds.includes(app.id));
  const newcomers = observed.filter((o) => o.id !== "readapp" && !KNOWN_APPS.some((a) => a.id === o.id) && !(o.id in state.enabled));

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refresh = () => invoke<{ id: string; name: string }[]>("get_observed_apps")
      .then((apps) => { if (!disposed) setObserved(apps); }).catch(() => {});
    void refresh();
    listen("observed-changed", () => void refresh())
      .then((off) => { if (disposed) off(); else unlisten = off; }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, []);

  const pickFromFile = async () => {
    const picked = await open({ directory: false, multiple: false, defaultPath: "/Applications", filters: [{ name: "Application", extensions: ["app"] }] }).catch(() => null);
    if (typeof picked !== "string") return;
    const app = await invoke<{ id: string; name: string } | null>("resolve_app", { path: picked }).catch(() => null);
    if (app) await api.setEnabled(app.id, true, app.name);
  };

  const appRow = (app: (typeof apps)[number]) => {
    const name = state.names[app.id] ?? app.name;
    const voice = voiceNameOf(app.id);
    return (
      <li key={app.id} className="flex items-center gap-3">
        <button type="button" onClick={() => onOpenApp(app.id)} aria-label={`${name}の設定を開く`} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-sm py-1.5 text-left outline-none transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-primary/50">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold" style={{ backgroundColor: `${app.color}2e` }} aria-hidden="true">{name.slice(0, 1)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{name}</span>
            {voice && <span className="block truncate text-xs text-muted-foreground">{voice}の声</span>}
          </span>
        </button>
        {!state.speak_all && <Switch checked={isOn(state, app.id)} onChange={(v) => void api.setEnabled(app.id, v)} label={`${name}の読み上げ`} />}
      </li>
    );
  };

  return (
    <>
      <div className="rounded-lg bg-card px-3.5 shadow-[0_1px_2px_rgba(41,39,45,0.06)]">
        <div className="flex items-center justify-between gap-3 py-2">
          <span className="text-sm font-medium">すべての通知</span>
          <Switch checked={state.speak_all} onChange={(v) => void api.setSpeakAll(v)} label="すべての通知を読み上げる" />
        </div>
        {state.speak_all ? (
          <p className="pb-2 text-xs leading-relaxed text-muted-foreground">すべてのアプリを読み上げます。オフにすると、アプリごとに選べます。</p>
        ) : (
          <ul className="border-t border-border/60 py-1">{primaryIds.map((id) => apps.find((app) => app.id === id)).filter((app) => app !== undefined).map(appRow)}</ul>
        )}
        <details className="pb-2">
          <summary className="disclosure-summary">アプリを管理<span className="ml-auto text-xs font-normal text-muted-foreground">{apps.length}件</span></summary>
          {state.speak_all && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">アプリごとに声を変えられます。</p>}
          <ul className="mt-1">{(state.speak_all ? apps : remaining).map(appRow)}</ul>
          {newcomers.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">通知が届いたアプリ</p>
              <ul className="mt-2 space-y-1.5">
                {newcomers.map((o) => (
                  <li key={o.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{o.name}</span>
                    <Button size="sm" variant="outline" onClick={() => void api.setEnabled(o.id, true, o.name)}><Plus aria-hidden="true" />追加</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button className="mt-3 w-full" variant="outline" onClick={() => void pickFromFile()}><FolderOpen aria-hidden="true" />ファイルから選ぶ</Button>
        </details>
      </div>
    </>
  );
}
