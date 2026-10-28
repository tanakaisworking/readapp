//! キャラ (読み上げのプロファイル)。名前・画像・声・話し方をひとまとまりで持ち、
//! 作ったキャラの中から「いま話すキャラ」を1人選ぶ。設定ファイルに保存する。

use serde::{Deserialize, Serialize};

/// 話し方: 通知の文をそのまま読む
pub const STYLE_RAW: &str = "raw";
/// 話し方: 自分で書いた口調 (style_note)
pub const STYLE_CUSTOM: &str = "custom";
/// 同梱の背景画像 (public/companion/<id>.webp)。fuki は画像ではなく、画面側でコードで描いて動かすキャラ
pub const PRESET_IMAGES: [&str; 7] = ["cat", "shiba", "bunny", "buncho", "girl", "boy", "fuki"];
/// 取り込んだ画像 (アプリのデータフォルダ companion/characters/<id>.<ext>)
pub const IMAGE_CUSTOM: &str = "custom";
pub const NAME_MAX: usize = 20;
pub const NOTE_MAX: usize = 200;
pub const VOICE_PROMPT_MAX: usize = 200;
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
    /// Geminiの声で読む時の声の出し方 (声の高さ・速さ・気持ちなど)。システム音声では使わない
    #[serde(default)]
    pub voice_prompt: String,
}

fn preset(id: &str) -> String {
    format!("preset:{id}")
}

/// 同梱の画像ごとの声の出し方 (ひな形と、声の出し方を持っていなかった以前のキャラに入れる)
const VOICE_PROMPTS: [(&str, &str); 5] = [
    ("fuki", "明るく弾むような、少し高めの元気な声。親しい友だちに「来たよ」と教えてあげるように、テンポよく、語尾を軽く上げて話す。"),
    ("girl", "明るく親しみのある若い女性の声。にこやかに、自然なテンポで話しかける。"),
    ("cat", "やわらかく上品な声。ゆったりと丁寧に、少し甘えるように話す。"),
    ("boy", "おっとりした若い男性の声。少しゆっくり、穏やかにやさしく話す。"),
    ("buncho", "落ち着いたクールな声。抑揚は控えめに、淡々と短く話す。"),
];

/// 画像 ("preset:<id>") に合う声の出し方。合うものがなければ空 (既定の落ち着いた読み方になる)
pub fn preset_voice_prompt(image: &str) -> String {
    image
        .strip_prefix("preset:")
        .and_then(|id| VOICE_PROMPTS.iter().find(|(img, _)| *img == id))
        .map(|(_, prompt)| prompt.to_string())
        .unwrap_or_default()
}

/// 声の出し方を持っていなかった以前のキャラに、画像に合う声の出し方を入れる (読み込み時に1度だけ)。変えたら true
pub fn seed_voice_prompts(list: &mut [Character]) -> bool {
    let mut changed = false;
    for c in list.iter_mut().filter(|c| c.voice_prompt.is_empty()) {
        c.voice_prompt = preset_voice_prompt(&c.image);
        changed |= !c.voice_prompt.is_empty();
    }
    changed
}

/// キャラのひな形 (id, 名前, 画像, 話し方)。話し方は personas() のid。
/// キャラを作る時にここから選ぶ。最初の1人 (オンボーディングで選ぶまで) は先頭のひな形。
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
            voice_prompt: preset_voice_prompt(&preset(image)),
        })
        .collect()
}

/// あとから足したひな形 (最初から入っていたキャラではないので、移行や既定の更新には使わない)。
/// 動くふきだし (アプリアイコンの子) は、明るい口調で話す。
const EXTRA_PRESETS: [(&str, &str, &str, &str); 1] = [("fuki", "元気なふきだし", "fuki", "mio")];

/// あとから足したひな形のキャラ
fn extra_presets(voice: &str) -> Vec<Character> {
    EXTRA_PRESETS
        .into_iter()
        .map(|(id, name, image, style)| Character {
            id: id.to_string(),
            name: name.to_string(),
            image: preset(image),
            voice: voice.to_string(),
            style: style.to_string(),
            style_note: String::new(),
            voice_prompt: preset_voice_prompt(&preset(image)),
        })
        .collect()
}

/// 初めて使う時の最初のキャラ (オンボーディングで選ぶまで)。アプリアイコンの子の、動くふきだし。
/// 以前の版から移ってきた時は migrate() の4人から引き継ぐので、これは使わない。
pub fn first(voice: &str) -> Character {
    extra_presets(voice).remove(0)
}

/// キャラのひな形 (声はシステム音声)。いちばん上は最初のキャラと同じ、動くふきだし。
pub fn presets() -> Vec<Character> {
    let mut list = extra_presets("system");
    list.extend(defaults("system"));
    list
}

/// ひな形から新しいキャラを作る (IDは新しく振る)。知らないひな形なら None。
pub fn from_preset(existing: &[Character], preset_id: &str) -> Option<Character> {
    let preset = presets().into_iter().find(|p| p.id == preset_id)?;
    Some(Character { id: new_id(existing), ..preset })
}

/// 以前の版では4人のひな形をそのままキャラとして持っていた。使っていない (全体のキャラでも
/// アプリの担当でもない) うえに、ひな形から何も変えていないものは一覧から外す (ひな形から作り直せる)。
/// 変えたら true。キャラは必ず1人以上残す。
pub fn prune_unused_presets(list: &mut Vec<Character>, active: &str, used: &[String]) -> bool {
    let presets = presets();
    let before = list.len();
    let keep = |c: &Character| c.id == active || used.contains(&c.id) || !presets.contains(c);
    let kept: Vec<Character> = list.iter().filter(|c| keep(c)).cloned().collect();
    if kept.is_empty() {
        return false;
    }
    *list = kept;
    list.len() != before
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

pub fn clean_voice_prompt(prompt: &str) -> String {
    prompt.trim().chars().take(VOICE_PROMPT_MAX).collect()
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
        voice_prompt: String::new(),
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
    fn presets_are_valid_and_include_the_moving_bubble() {
        let list = presets();
        for c in &list {
            assert!(valid_style(&c.style), "{}", c.style);
            assert!(valid_image(&c.image), "{}", c.image);
            assert_eq!(list.iter().filter(|o| o.id == c.id).count(), 1, "{}", c.id);
        }
        let fuki = from_preset(&defaults("system"), "fuki").unwrap();
        assert_eq!(fuki.image, "preset:fuki");
        assert_ne!(fuki.id, "fuki");
    }

    #[test]
    fn presets_have_voice_prompts_and_old_characters_get_one_by_image() {
        assert!(presets().iter().all(|c| !c.voice_prompt.is_empty() && c.voice_prompt.chars().count() <= VOICE_PROMPT_MAX));
        let mut list = defaults("system");
        list.iter_mut().for_each(|c| c.voice_prompt.clear());
        list[1].voice_prompt = "自分で書いた声".to_string();
        list[2].image = IMAGE_CUSTOM.to_string();
        assert!(seed_voice_prompts(&mut list));
        assert_eq!(list[0].voice_prompt, preset_voice_prompt("preset:girl"));
        assert_eq!(list[1].voice_prompt, "自分で書いた声");
        assert_eq!(list[2].voice_prompt, "");
        assert_eq!(clean_voice_prompt(&"あ".repeat(300)).chars().count(), VOICE_PROMPT_MAX);
    }

    #[test]
    fn unused_untouched_presets_leave_the_list_but_used_or_edited_ones_stay() {
        let mut list = defaults("system");
        list[3].name = "ピー助".to_string(); // 名前を変えた文鳥は残す
        // 全体のキャラ (明るい女子) とアプリ担当 (おっとり男子) も残す
        assert!(prune_unused_presets(&mut list, "mio", &["ren".to_string()]));
        let ids: Vec<&str> = list.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["mio", "ren", "shiro"]);
        assert!(!prune_unused_presets(&mut list, "mio", &["ren".to_string()]));
    }

    #[test]
    fn characters_made_from_a_preset_get_a_new_id() {
        let list = defaults("system");
        let cat = from_preset(&list, "aoi").unwrap();
        assert_ne!(cat.id, "aoi");
        assert_eq!(cat.style, "neko");
        assert_eq!(cat.image, "preset:cat");
        assert!(from_preset(&list, "pirate").is_none());
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
