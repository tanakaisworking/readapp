import { useEffect, useState } from "react";
import { BellRing, ChevronRight, FolderOpen, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { AppAvatar } from "@/components/app-avatar";
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
      <li key={app.id} className="list-row items-center gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => onOpenApp(app.id)}
          aria-label={`${name}の設定を開く`}
          className="list-col-grow group -my-1 flex min-w-0 items-center gap-3 rounded-field py-1 pe-1 text-left"
        >
          <AppAvatar name={name} color={app.color} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{name}</span>
            {voice && <span className="block truncate text-xs text-muted">{voice}の声</span>}
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
        </button>
        {!state.speak_all && (
          <input
            type="checkbox"
            role="switch"
            className="toggle toggle-primary toggle-sm"
            checked={isOn(state, app.id)}
            onChange={(e) => void api.setEnabled(app.id, e.target.checked)}
            aria-label={`${name}の読み上げ`}
          />
        )}
      </li>
    );
  };

  return (
    <div className="surface">
      <ul className="list">
        <li className="list-row items-center gap-3 px-3 py-2.5">
          <span className="grid size-8 place-items-center rounded-full bg-primary/12 text-primary" aria-hidden="true">
            <BellRing className="size-4" />
          </span>
          <div className="list-col-grow min-w-0">
            <p className="text-sm font-medium">すべての通知</p>
            <p className="truncate text-xs text-muted">{state.speak_all ? "どのアプリの通知も読み上げます" : "選んだアプリだけ読み上げます"}</p>
          </div>
          <input
            type="checkbox"
            role="switch"
            className="toggle toggle-primary toggle-sm"
            checked={state.speak_all}
            onChange={(e) => void api.setSpeakAll(e.target.checked)}
            aria-label="すべての通知を読み上げる"
          />
        </li>
        {!state.speak_all && primaryIds.map((id) => apps.find((app) => app.id === id)).filter((app) => app !== undefined).map(appRow)}
      </ul>
      <details className="collapse collapse-arrow collapse-compact rounded-none rounded-b-box border-t border-base-200">
        <summary className="collapse-title">
          {state.speak_all ? "アプリごとの声" : "ほかのアプリ"}
          <span className="ml-auto text-xs font-normal text-muted">{state.speak_all ? apps.length : remaining.length}件</span>
        </summary>
        <div className="collapse-content">
          {state.speak_all && <p className="pb-1 text-xs leading-relaxed text-muted">アプリを選ぶと、そのアプリだけ声を変えられます。</p>}
          <ul className="list -mx-4">{(state.speak_all ? apps : remaining).map(appRow)}</ul>
          {newcomers.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-muted">通知が届いたアプリ</p>
              <ul className="mt-1.5 space-y-1">
                {newcomers.map((o) => (
                  <li key={o.id} className="flex items-center gap-2 rounded-field bg-base-200 py-1.5 ps-3 pe-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{o.name}</span>
                    <button type="button" className="btn btn-xs btn-primary btn-soft" onClick={() => void api.setEnabled(o.id, true, o.name)}>
                      <Plus aria-hidden="true" />
                      追加
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" className="btn btn-sm btn-block mt-3" onClick={() => void pickFromFile()}>
            <FolderOpen aria-hidden="true" />
            ファイルから選ぶ
          </button>
        </div>
      </details>
    </div>
  );
}
