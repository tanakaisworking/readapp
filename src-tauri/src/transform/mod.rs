use serde::Serialize;

pub mod apple_foundation_model;
pub mod raw;
pub mod windows_local_ai;

use crate::AppSettings;

/// アプリ別の変換方式。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// 変換なし (素文のまま読む)
    Raw,
    /// ローカルAIでキャラ口調に変換
    Persona,
}

impl Mode {
    pub fn from_str(s: &str) -> Self {
        match s {
            "raw" => Mode::Raw,
            _ => Mode::Persona,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Mode::Raw => "raw",
            Mode::Persona => "persona",
        }
    }
}

/// キャラ定義。persona=口調、voice=音声は分けて選ぶ (UXVISION)。
#[derive(Debug, Clone, Serialize)]
pub struct Persona {
    pub id: String,
    pub name: String,
    pub tagline: String,
    pub instruction: String,
}

pub fn personas() -> Vec<Persona> {
    vec![
        Persona {
            id: "mio".into(),
            name: "Mio".into(),
            tagline: "明るく距離の近い秘書".into(),
            instruction: "明るく距離の近い秘書として、渡された通知内容を一文の話し言葉で言い換える。語尾は柔らかく。絵文字は使わない。出力は言い換え文のみ。".into(),
        },
        Persona {
            id: "aoi".into(),
            name: "Aoi".into(),
            tagline: "落ち着いた丁寧な秘書".into(),
            instruction: "落ち着いた丁寧な口調の秘書として、渡された通知内容を一文の敬語で言い換える。絵文字は使わない。出力は言い換え文のみ。".into(),
        },
        Persona {
            id: "ren".into(),
            name: "Ren".into(),
            tagline: "温かく少し砕けた相棒".into(),
            instruction: "温かく少し砕けた相棒として、渡された通知内容を一文の話し言葉で言い換える。堅苦しくしない。絵文字は使わない。出力は言い換え文のみ。".into(),
        },
        Persona {
            id: "shiro".into(),
            name: "Shiro".into(),
            tagline: "淡々と簡潔な助手".into(),
            instruction: "淡々と簡潔な助手として、渡された通知内容を短い一文で言い換える。装飾しない。絵文字は使わない。出力は言い換え文のみ。".into(),
        },
    ]
}

/// 全キャラ共通の決まり。アプリ名は入力の「通知元:」行で渡す (persona_input) ので、
/// 無い時に穴埋め語を作らせないよう条件付きで頼む。時刻は崩されやすい (15:00→15時〇分) ので写させる。
const COMMON_RULES: &str = "通知元が書かれていれば、そのアプリ名を言い換え文に含める。数字・時刻・日付・固有名詞は元の表記のまま書き写す。";

/// モデルへの入力。アプリ名が分かる時だけ「通知元:」行を付ける。
pub fn persona_input(raw_text: &str, app_name: Option<&str>) -> String {
    match app_name {
        Some(name) => format!("通知元: {name}\n{raw_text}"),
        None => raw_text.to_string(),
    }
}

pub fn persona_instruction(id: &str) -> String {
    let base = personas()
        .into_iter()
        .find(|p| p.id == id)
        .map(|p| p.instruction)
        .unwrap_or_else(|| "渡された通知内容を一文の話し言葉で言い換える。出力は言い換え文のみ。".into());
    format!("{base}{COMMON_RULES}")
}

/// 変換の振り分け。ローカルAIが使えない場合は素文にフォールバックする
/// (読み上げ自体は止めない)。
/// app_nameはキャラ変換の入力にだけ使う。素文・フォールバックでは読まない。
pub fn transform_text(settings: &AppSettings, raw_text: &str, app_name: Option<&str>) -> String {
    if settings.mode() == Mode::Raw {
        return raw::transform(raw_text);
    }
    let persona_id = settings.persona();
    #[cfg(target_os = "macos")]
    {
        if let Some(helper) = settings.helper_path() {
            let instruction = persona_instruction(&persona_id);
            let input = persona_input(raw_text, app_name);
            match apple_foundation_model::transform(&input, &instruction, &helper) {
                Ok(t) if !t.trim().is_empty() => return t,
                _ => {}
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app_name;
    #[cfg(target_os = "windows")]
    {
        match windows_local_ai::transform(raw_text, &persona_id) {
            Ok(t) if !t.trim().is_empty() => return t,
            _ => {}
        }
    }
    raw::transform(raw_text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persona_input_adds_source_only_when_known() {
        assert_eq!(persona_input("田中。資料できました", Some("Slack")), "通知元: Slack\n田中。資料できました");
        assert_eq!(persona_input("作業が完了しました。", None), "作業が完了しました。");
    }

    #[test]
    fn instruction_has_no_placeholder() {
        for p in personas() {
            assert!(!persona_instruction(&p.id).contains('〇'));
        }
    }
}
