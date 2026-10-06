//! 再生プロセスの停止と、停止前に受けた読み上げ要求の無効化。
use std::io::Write;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

#[derive(Clone, Copy)]
pub(super) struct Request(u64);

struct State {
    enabled: bool,
    volume: u8,
    generation: u64,
    child: Option<Child>,
}

pub(super) struct Playback(Mutex<State>);

impl Playback {
    pub(super) fn new() -> Self {
        Self(Mutex::new(State {
            enabled: true,
            volume: 100,
            generation: 0,
            child: None,
        }))
    }

    pub(super) fn volume(&self) -> u8 {
        self.0.lock().map(|s| s.volume).unwrap_or(0)
    }

    pub(super) fn request(&self) -> Option<Request> {
        let s = self.0.lock().ok()?;
        (s.enabled && s.volume > 0).then_some(Request(s.generation))
    }

    fn current(s: &State, request: Request) -> bool {
        s.enabled && s.volume > 0 && s.generation == request.0
    }

    fn cancel(s: &mut State) {
        // 再開後も、待機中・変換中だった古い要求は再生しない。
        s.generation = s.generation.wrapping_add(1);
        if let Some(child) = s.child.as_mut() {
            child.kill().ok();
        }
        // waitはワーカー側で行う。停止ボタンの応答を待たせない。
    }

    pub(super) fn set_enabled(&self, enabled: bool) {
        if let Ok(mut s) = self.0.lock() {
            s.enabled = enabled;
            if !enabled {
                Self::cancel(&mut s);
            }
        }
    }

    /// 接続キーの変更で古い要求を破棄。ON/OFF・音量は維持する。
    pub(super) fn cancel_pending(&self) {
        if let Ok(mut s) = self.0.lock() {
            Self::cancel(&mut s);
        }
    }

    pub(super) fn set_volume(&self, volume: u8) {
        if let Ok(mut s) = self.0.lock() {
            s.volume = volume.min(100);
            if s.volume == 0 {
                Self::cancel(&mut s);
            }
        }
    }

    pub(super) fn accepts(&self, request: Request) -> bool {
        self.0
            .lock()
            .map(|s| Self::current(&s, request))
            .unwrap_or(false)
    }

    /// 単一の音声ワーカーから呼ぶ。生成プロセスも再生プロセスも停止対象。
    pub(super) fn run(&self, command: &mut Command, request: Request) -> bool {
        self.run_with_input(command, request, None)
    }

    /// 小さな認証設定をstdinから渡す。秘密をargvやファイルに残さない。
    pub(super) fn run_with_input(
        &self,
        command: &mut Command,
        request: Request,
        input: Option<&[u8]>,
    ) -> bool {
        if input.is_some_and(|bytes| bytes.len() > 8192) {
            return false;
        }
        {
            let Ok(mut s) = self.0.lock() else {
                return false;
            };
            if !Self::current(&s, request) {
                return false;
            }
            let Ok(mut child) = command.spawn() else {
                return false;
            };
            if let Some(input) = input {
                if child
                    .stdin
                    .take()
                    .is_none_or(|mut stdin| stdin.write_all(input).is_err())
                {
                    child.kill().ok();
                    child.wait().ok();
                    return false;
                }
            }
            // 検査から登録まで同じロック。停止直後に子が起動する競合を防ぐ。
            s.child = Some(child);
        }
        loop {
            let Ok(mut s) = self.0.lock() else {
                return false;
            };
            if !Self::current(&s, request) {
                let child = s.child.take();
                drop(s);
                if let Some(mut child) = child {
                    child.wait().ok();
                }
                return false;
            }
            match s.child.as_mut().map(|c| c.try_wait()) {
                Some(Ok(Some(status))) => {
                    s.child.take();
                    return status.success();
                }
                Some(Ok(None)) => {}
                _ => {
                    let child = s.child.take();
                    drop(s);
                    if let Some(mut child) = child {
                        child.kill().ok();
                        child.wait().ok();
                    }
                    return false;
                }
            }
            drop(s);
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::Instant;

    #[test]
    fn credential_rotation_invalidates_old_requests_without_turning_speech_off() {
        let playback = Playback::new();
        playback.set_volume(60);
        let old = playback.request().unwrap();
        playback.cancel_pending();
        assert!(!playback.accepts(old));
        let new = playback.request().unwrap();
        assert!(playback.accepts(new));
        assert_eq!(playback.volume(), 60);
    }

    #[cfg(unix)]
    #[test]
    fn stdin_command_is_cancelled_and_reaped_without_waiting_for_completion() {
        let playback = Arc::new(Playback::new());
        let request = playback.request().unwrap();
        let worker = playback.clone();
        let thread = std::thread::spawn(move || {
            worker.run_with_input(
                Command::new("sh")
                    .args(["-c", "cat >/dev/null; exec sleep 30"])
                    .stdin(std::process::Stdio::piped()),
                request,
                Some(b"test configuration"),
            )
        });
        let start = Instant::now();
        while playback.0.lock().unwrap().child.is_none() {
            assert!(start.elapsed() < Duration::from_secs(2));
            std::thread::sleep(Duration::from_millis(1));
        }
        playback.set_enabled(false);
        assert!(!thread.join().unwrap());
        assert!(start.elapsed() < Duration::from_secs(2));
        assert!(playback.0.lock().unwrap().child.is_none());
    }

    #[test]
    fn stopped_requests_stay_cancelled_after_resume() {
        let playback = Playback::new();
        let queued = playback.request().unwrap();
        let transforming = playback.request().unwrap();
        playback.set_enabled(false);
        assert!(playback.request().is_none());
        playback.set_enabled(true);
        assert!(!playback.accepts(queued));
        assert!(!playback.accepts(transforming));
        assert!(playback.accepts(playback.request().unwrap()));
    }

    #[test]
    fn unmuting_does_not_restore_cancelled_audio() {
        let playback = Playback::new();
        let request = playback.request().unwrap();
        playback.set_volume(0);
        assert!(playback.request().is_none());
        playback.set_volume(35);
        assert!(!playback.accepts(request));
        assert_eq!(playback.volume(), 35);
        playback.set_enabled(false);
        playback.set_volume(100);
        assert!(playback.request().is_none());
    }

    #[cfg(unix)]
    #[test]
    fn cancelled_request_never_spawns_a_process() {
        let playback = Playback::new();
        let request = playback.request().unwrap();
        playback.set_enabled(false);
        playback.set_enabled(true);
        assert!(!playback.run(Command::new("sleep").arg("30"), request));
        assert!(playback.0.lock().unwrap().child.is_none());
    }

    #[cfg(any(unix, target_os = "windows"))]
    #[test]
    fn off_mute_and_key_changes_kill_active_process_and_worker_reaps_it() {
        for action in 0..3 {
            let playback = Arc::new(Playback::new());
            let request = playback.request().unwrap();
            let worker = playback.clone();
            let task = std::thread::spawn(move || {
                #[cfg(unix)]
                let mut command = {
                    let mut c = Command::new("sleep");
                    c.arg("30");
                    c
                };
                #[cfg(target_os = "windows")]
                let mut command = {
                    let mut c = Command::new("powershell");
                    c.args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"]);
                    c
                };
                worker.run(&mut command, request)
            });
            let deadline = Instant::now() + Duration::from_secs(2);
            while playback.0.lock().unwrap().child.is_none() {
                assert!(Instant::now() < deadline, "child did not start");
                std::thread::sleep(Duration::from_millis(5));
            }
            let stopped_at = Instant::now();
            match action {
                0 => playback.set_enabled(false),
                1 => playback.set_volume(0),
                _ => playback.cancel_pending(),
            }
            // すぐ再開しても、古い再生とキューは戻らない。
            match action {
                0 => playback.set_enabled(true),
                1 => playback.set_volume(100),
                _ => (),
            }
            while !task.is_finished() {
                assert!(
                    stopped_at.elapsed() < Duration::from_secs(2),
                    "audio did not stop"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
            assert!(!task.join().unwrap());
            assert!(playback.0.lock().unwrap().child.is_none());
            assert!(playback.request().is_some());
        }
    }
}
