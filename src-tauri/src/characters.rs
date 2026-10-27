//! キャラ (読み上げのプロファイル)。名前・画像・声・話し方をひとまとまりで持ち、
//! 作ったキャラの中から「いま話すキャラ」を1人選ぶ。設定ファイルに保存する。

use serde::{Deserialize, Serialize};

/// 話し方: 通知の文をそのまま読む
pub const STYLE_RAW: &str = "raw";
/// 話し方: 自分で書いた口調 (style_note)
pub const STYLE_CUSTOM: &str = "custom";
/// 同梱の背景画像 (public/companion/<id>.webp)
pub const PRESET_IMAGES: [&str; 6] = ["cat", "shiba", "bunny", "buncho", "girl", "boy"];
/// 取り込んだ画像 (アプリのデータフォルダ companion/characters/<id>.<ext>)
pub const IMAGE_CUSTOM: &str = "custom";
pub const NAME_MAX: usize = 20;
pub const NOTE_MAX: usize = 200;
pub const CHARACTERS_MAX: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Character {
    pub id: String,
    pub name: String,
    /// "preset:<id>" か、取り込んだ画像の "custom"
    pub image: String,
    pub voice: String,
    /// 話し方: transform::personas() のid、"raw"、"custom" のどれか
    pub style: String,
    /// style が "custom" の時の口調 (自分で書く)
    #[serde(default)]
    pub style_note: String,
}

fn preset(id: &str) -> String {
    format!("preset:{id}")
}

/// 最初から入っているキャラ (id, 名前, 画像, 話し方)。話し方は personas() のid。
/// 名前は性格と見た目が伝わる仮の名前にして、ユーザーが好きな名前に変えられるようにする。
/// ねこは語尾「にゃん」、文鳥は語尾「ピヨ」で話す。
const DEFAULTS: [(&str, &str, &str, &str); 4] = [
    ("mio", "明るい女子", "girl", "mio"),
    ("aoi", "ていねいなねこ", "cat", "neko"),
    ("ren", "おっとり男子", "boy", "ren"),
    ("shiro", "クールな文鳥", "buncho", "tori"),
];
/// 以前の版で最初から入っていたキャラの名前 (変えていなければ、今の名前に置き換える)
const OLD_NAMES: [(&str, &str); 4] = [("mio", "Mio"), ("aoi", "Aoi"), ("ren", "Ren"), ("shiro", "Shiro")];
/// 以前の版で、ねこと文鳥が使っていた話し方 (画像と話し方を変えていなければ、語尾つきの話し方にする)
const OLD_STYLES: [(&str, &str); 2] = [("aoi", "aoi"), ("shiro", "shiro")];

pub fn defaults(voice: &str) -> Vec<Character> {
    DEFAULTS
        .into_iter()
        .map(|(id, name, image, style)| Character {
            id: id.to_string(),
            name: name.to_string(),
            image: preset(image),
            voice: voice.to_string(),
            style: style.to_string(),
            style_note: String::new(),
        })
        .collect()
}

/// 最初から入っているキャラを、今の既定に合わせる。ユーザーが変えたところはそのまま。変えたら true。
/// - 以前の版の名前 (Mio など) のままなら、今の名前にする
/// - ねこ・文鳥が画像も話し方も以前のままなら、語尾つきの話し方にする
pub fn upgrade_defaults(list: &mut [Character]) -> bool {
    let mut changed = false;
    for c in list.iter_mut() {
        let Some((_, name, image, style)) = DEFAULTS.iter().find(|d| d.0 == c.id) else { continue };
        if OLD_NAMES.iter().any(|(id, old)| *id == c.id && *old == c.name) {
            c.name = name.to_string();
            changed = true;
        }
        if c.image == preset(image) && OLD_STYLES.iter().any(|(id, old)| *id == c.id && *old == c.style) {
            c.style = style.to_string();
            changed = true;
        }
    }
    changed
}

/// 旧設定 (キャラ・声・話し方が全体で1つずつ) から、選んでいたキャラへ引き継ぐ。
pub fn migrate(persona: &str, voice: &str, mode: &str) -> (Vec<Character>, String) {
    let mut list = defaults("system");
    let active = if list.iter().any(|c| c.id == persona) { persona.to_string() } else { list[0].id.clone() };
    if let Some(c) = list.iter_mut().find(|c| c.id == active) {
        c.voice = voice.to_string();
        // 選んでいたキャラは、それまでの話し方のまま (ねこ・文鳥でも語尾をつけない)
        c.style = if mode == STYLE_RAW { STYLE_RAW.to_string() } else { active.clone() };
    }
    (list, active)
}

/// 古い版 (話し方が4つだけ) へ戻した時に読める話し方。語尾つきの話し方は近い口調にする。
pub fn legacy_persona(style: &str) -> &str {
    match style {
        "mio" | "aoi" | "ren" | "shiro" => style,
        "neko" => "aoi",
        "tori" => "shiro",
        _ => "mio",
    }
}

pub fn valid_style(style: &str) -> bool {
    style == STYLE_RAW || style == STYLE_CUSTOM || crate::transform::personas().iter().any(|p| p.id == style)
}

pub fn valid_image(image: &str) -> bool {
    image == IMAGE_CUSTOM || image.strip_prefix("preset:").is_some_and(|id| PRESET_IMAGES.contains(&id))
}

/// 前後の空白を除き、長すぎる分は切る。空なら None。
pub fn clean_name(name: &str) -> Option<String> {
    let name: String = name.trim().chars().take(NAME_MAX).collect();
    (!name.is_empty()).then_some(name)
}

pub fn clean_note(note: &str) -> String {
    note.trim().chars().take(NOTE_MAX).collect()
}

/// 新しいキャラのID。既存と重ならない短い文字列。
pub fn new_id(existing: &[Character]) -> String {
    let base = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    (0..)
        .map(|n| format!("c{base:x}{n}"))
        .find(|id| !existing.iter().any(|c| &c.id == id))
        .unwrap_or_default()
}

/// 新しく作るキャラ。まだ使っていない同梱画像を選び、声は今のキャラと同じにする。
pub fn blank(existing: &[Character], voice: &str) -> Character {
    let image = PRESET_IMAGES
        .iter()
        .map(|id| preset(id))
        .find(|img| !existing.iter().any(|c| &c.image == img))
        .unwrap_or_else(|| preset(PRESET_IMAGES[0]));
    Character {
        id: new_id(existing),
        name: "新しいキャラ".to_string(),
        image,
        voice: voice.to_string(),
        style: "mio".to_string(),
        style_note: String::new(),
    }
}

/// 旧版の「アプリごとの声」を、キャラの割り当てに移す。同じ声のキャラがいればそのキャラ、
/// いなければ今のキャラを写して声だけ変えたキャラを作る (名前は「<アプリ名>用」)。
/// 戻り値は app_id → キャラID。
pub fn assign_legacy_voices(
    list: &mut Vec<Character>,
    active: &str,
    voices: &std::collections::HashMap<String, String>,
    label: impl Fn(&str) -> String,
) -> std::collections::HashMap<String, String> {
    let mut assigned = std::collections::HashMap::new();
    let base = list.iter().find(|c| c.id == active).or_else(|| list.first()).cloned();
    let Some(base) = base else { return assigned };
    let mut apps: Vec<_> = voices.iter().collect();
    apps.sort();
    for (app_id, voice) in apps {
        let id = match list.iter().find(|c| &c.voice == voice) {
            Some(c) => c.id.clone(),
            None if list.len() < CHARACTERS_MAX => {
                let c = Character {
                    id: new_id(list),
                    name: clean_name(&format!("{}用", label(app_id))).unwrap_or_else(|| base.name.clone()),
                    voice: voice.clone(),
                    ..base.clone()
                };
                let id = c.id.clone();
                list.push(c);
                id
            }
            None => continue,
        };
        assigned.insert(app_id.clone(), id);
    }
    assigned
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_use_valid_styles_and_images() {
        let list = defaults("system");
        assert_eq!(list.len(), 4);
        for c in &list {
            assert!(valid_style(&c.style), "{}", c.style);
            assert!(valid_image(&c.image), "{}", c.image);
            assert_eq!(clean_name(&c.name).as_deref(), Some(c.name.as_str()));
        }
    }

    #[test]
    fn old_defaults_are_upgraded_but_user_changes_are_kept() {
        let mut list = defaults("system");
        list[0].name = "Mio".to_string();
        list[2].name = "ハルト".to_string();
        // 以前の版のねこ (丁寧な秘書の話し方) と、画像を変えた文鳥
        list[1].style = "aoi".to_string();
        list[3].style = "shiro".to_string();
        list[3].image = "preset:shiba".to_string();
        assert!(upgrade_defaults(&mut list));
        assert_eq!(list[0].name, "明るい女子");
        assert_eq!(list[2].name, "ハルト");
        assert_eq!(list[1].style, "neko");
        assert_eq!(list[3].style, "shiro");
        assert!(!upgrade_defaults(&mut list));
    }

    #[test]
    fn cat_and_bird_speak_with_their_endings() {
        let list = defaults("system");
        let style = |id: &str| list.iter().find(|c| c.id == id).unwrap().style.clone();
        assert!(crate::transform::persona_instruction(&style("aoi")).contains("にゃん"));
        assert!(crate::transform::persona_instruction(&style("shiro")).contains("ピヨ"));
        assert!(!crate::transform::persona_instruction(&style("mio")).contains("にゃん"));
    }

    #[test]
    fn migration_keeps_the_chosen_character_voice_and_raw_mode() {
        let (list, active) = migrate("aoi", "system:Kyoko", "raw");
        assert_eq!(active, "aoi");
        let aoi = list.iter().find(|c| c.id == "aoi").unwrap();
        assert_eq!(aoi.voice, "system:Kyoko");
        assert_eq!(aoi.style, STYLE_RAW);
        // ほかのキャラは既定の口調
        assert_eq!(list.iter().find(|c| c.id == "mio").unwrap().style, "mio");
        assert_eq!(list.iter().find(|c| c.id == "shiro").unwrap().style, "tori");
        // 選んでいたキャラは、それまでの口調のまま
        let (list, _) = migrate("aoi", "system", "persona");
        assert_eq!(list.iter().find(|c| c.id == "aoi").unwrap().style, "aoi");
        let (_, unknown) = migrate("gone", "system", "persona");
        assert_eq!(unknown, "mio");
    }

    #[test]
    fn rejects_unknown_images_and_styles() {
        assert!(valid_image("preset:cat"));
        assert!(valid_image(IMAGE_CUSTOM));
        assert!(!valid_image("preset:../x"));
        assert!(!valid_image("/tmp/a.png"));
        assert!(!valid_style("pirate"));
    }

    #[test]
    fn names_are_trimmed_and_limited() {
        assert_eq!(clean_name("  Mio  ").as_deref(), Some("Mio"));
        assert_eq!(clean_name("   "), None);
        assert_eq!(clean_name(&"あ".repeat(30)).unwrap().chars().count(), NAME_MAX);
    }

    #[test]
    fn blank_character_picks_an_unused_image_and_new_id() {
        let list = defaults("system");
        let c = blank(&list, "gemini:Kore");
        assert!(!list.iter().any(|o| o.id == c.id || o.image == c.image));
        assert_eq!(c.voice, "gemini:Kore");
    }

    #[test]
    fn legacy_app_voices_become_character_assignments() {
        let mut list = defaults("system");
        list[2].voice = "system:Otoya".to_string();
        let voices = [("slack", "system:Otoya"), ("discord", "gemini:Puck")]
            .into_iter()
            .map(|(a, v)| (a.to_string(), v.to_string()))
            .collect();
        let assigned = assign_legacy_voices(&mut list, "mio", &voices, |id| if id == "discord" { "Discord".into() } else { id.into() });
        // 同じ声のキャラ (Ren) がいればそのキャラ
        assert_eq!(assigned["slack"], "ren");
        // いなければ、今のキャラ (Mio) の話し方と画像で声だけ変えたキャラを作る
        let made = list.iter().find(|c| c.id == assigned["discord"]).unwrap();
        assert_eq!(made.name, "Discord用");
        assert_eq!(made.voice, "gemini:Puck");
        assert_eq!(made.style, "mio");
        assert_eq!(list.len(), 5);
    }
}
