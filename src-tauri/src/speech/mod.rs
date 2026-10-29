mod playback;

/// Geminiの声・サーバー経由の声を使うか (Cargo feature cloud-voices)。使わない時は、その声を選んでいたキャラもMacの声で読む
pub const CLOUD_VOICES: bool = cfg!(feature = "cloud-voices");
pub mod gemini;
pub mod gemini_key;
pub mod elevenlabs;
pub mod premium;
pub mod system;
pub mod status;
