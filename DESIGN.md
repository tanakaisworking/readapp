# UI / Design Guidelines

このプロダクトのUIは、単なる管理画面ではなく「毎日そばに置きたくなる、小さくて愛着のあるデスクトップアプリ」を目指す。

機能性は高く保ちつつ、典型的なB2B SaaSやshadcn/uiそのままの無機質な見た目にはしない。

## Design Constitution

このプロダクトのUIは「モダン・上質・愛着が湧く・少し可愛い」を基準とする。

以下は禁止。

1. shadcn/uiのデフォルト見た目をそのまま使わない
2. 典型的なB2B SaaS管理画面にしない
3. 黒背景＋紫グラデーションの典型的AIサービスにしない
4. 過剰なglassmorphismを使わない
5. neon / glowを常用しない
6. 大きなgradientを主要なデザイン表現にしない
7. 強いdrop shadowを使わない
8. borderで画面を細かく区切りすぎない
9. pure black / pure whiteを多用しない
10. 角を必要以上に鋭くしない
11. すべてを巨大なカードに入れない
12. Webダッシュボードのように画面を広く使いすぎない
13. 巨大なhero sectionをアプリ内に作らない
14. 一画面に設定項目を詰め込みすぎない
15. 技術用語を主要UIのラベルに使わない
16. アイコンを意味なく大量配置しない
17. 常時動くanimationを入れない
18. 派手なparticle / parallax / background animationを使わない
19. アニメーションのために操作を待たせない
20. キャラクターを巨大なイラストとして常駐させない
21. 「かわいい」を子供向け・ゲーム風にしない
22. Premiumを金色・派手なgradient・大量の鍵アイコンで表現しない
23. 無料ユーザーに圧をかけるUpgrade UIを作らない
24. 同じ役割の独自componentを重複して作らない
25. 既存componentを確認せず新しいUIライブラリを追加しない
26. hover / active / selected状態を無反応にしない
27. 状態変化を色だけで表現しない
28. 可愛さのために可読性・コントラスト・操作性を落とさない
29. `prefers-reduced-motion` を無視しない
30. Windows / macOSのどちらか一方で明らかに不自然なUIにしない

## 判断基準

画面が以下のどれかに見えた場合は、完成とみなさず修正する。

- shadcnのサンプル
- SaaSの管理画面
- AIスタートアップのLP
- ゲームUI
- 子供向けアプリ
- 設定項目を並べただけのフォーム

目指すのは、

**Linear / Raycastの整理された情報設計**\
**× Appleの静かな質感**\
**× Nintendo / Tamagotchi程度の愛着**

である。

迷った場合は「派手にする」のではなく、余白・角丸・質感・マイクロインタラクションで良くする。

## Design Direction

目指す雰囲気は以下の中間。

- Linear / Raycast の整理された情報設計
- Appleアプリの静かな質感
- Nintendo / Tamagotchiのような愛着
- モダンなAIアプリらしい軽い遊び心

「かわいい」ことは重要だが、子供向け・アニメゲーム風・過剰なキャラクターUIにはしない。

キーワード:

- lovable
- warm
- soft
- compact
- polished
- playful
- calm
- premium
- slightly futuristic

避けるもの:

- 無機質なB2B SaaS
- shadcn/uiのデフォルトそのまま
- 黒背景 + 紫グラデーションの典型的AI SaaS
- 過剰なglassmorphism
- 過剰なneon / glow
- 巨大なgradient
- LPのような派手なUI
- Bootstrap的なフォーム画面
- Discordのように情報密度が高すぎるUI
- 子供向けゲームのような過剰な可愛さ

---

## Technology / Component Policy

基本UIは以下を使用する。

- React
- Tailwind CSS
- shadcn/ui
- Cult UI
- Animate UI
- Motion

### shadcn/ui

shadcn/uiは基礎コンポーネントとして使用する。

ただし、デフォルトテーマ・デフォルトradius・デフォルトカラーをそのまま使用しない。

shadcn/uiは「完成したデザイン」ではなく、アクセシブルで保守しやすいprimitiveとして扱う。

### Cult UI

プロダクトの個性を出す部分ではCult UIを優先的に検討する。

特に以下。

- Card
- Switch
- Segmented Control
- Button
- Toast
- Onboarding
- Disclosure
- Selector

Halo系の表現は使用してよいが、常時強く光らせない。

hover / active / selectedなど「触った瞬間」に軽く質感が出る程度にする。

### Animate UI / Motion

マイクロインタラクションに使用する。

アニメーションの目的は装飾ではなく、

- 状態変化を理解しやすくする
- 操作感を気持ちよくする
- キャラクターの存在感を出す
- アプリへの愛着を作る

こと。

---

## Visual Principles

### Radius

角は基本的に柔らかくする。

目安:

- small element: 10–12px
- button/input: 12–14px
- card: 16–20px
- large panel/modal: 20–24px

極端なpill shapeは、タグ・ステータス・小さいトグルなど限定的に使う。

### Color

pure white / pure blackは可能な限り避ける。

背景にはほんの少し暖色または色味を入れる。

例:

```css
--background: #faf9f7;
--card: #ffffff;
--surface-muted: #f3f1ee;

--foreground: #29272d;
--muted-foreground: #88838d;

--primary: #745de8;
--primary-soft: #eeeaff;
```

実際の値は画面に合わせて調整してよい。

重要なのは、

- 背景は少し暖かい
- foregroundは真っ黒にしない
- borderのコントラストを強くしすぎない
- accent colorを限定的に使う

こと。

### Borders

線で区切りすぎない。

可能なら、

- background difference
- spacing
- subtle shadow
- grouping

で情報構造を表現する。

borderを使う場合も薄くする。

### Shadow

強いdrop shadowは禁止。

カードが背景からほんの少し浮いて見える程度。

hover時にわずかにshadowが増えるのはよい。

---

## Character / Persona UI

このプロダクトでは「声」と「人格」が重要。

ただし、巨大なキャラクターイラストを常時表示してUIを占有しない。

キャラクターは、

- 小さなavatar
- 顔アイコン
- accent color
- speech bubble
- voice waveform
- subtle animation

によって存在感を出す。

例:

```text
  ◉‿◉

「Claudeの作業、
 終わったみたいだよ」
```

キャラクターごとにaccent colorを持たせてもよい。

例:

- Mio: soft pink
- Aoi: sky blue
- Ren: warm orange
- Shiro: lavender

キャラクターを変更すると、UI全体のaccentがわずかに変化する設計を推奨する。

ただし背景全体まで大きく変えない。

---

## Motion Principles

アニメーションは短く、小さく、spring感を持たせる。

目安:

- hover: 100–150ms
- button press: 100–180ms
- panel transition: 180–280ms
- onboarding transition: 250–400ms

推奨:

- switchが少し弾む
- card hoverで1–2px浮く
- 音声再生中にavatarが軽く呼吸する
- notification受信時に小さいbubbleが現れる
- voice preview時にwaveformが動く
- 成功時にiconが軽くbounceする

禁止:

- 常時動き続ける背景
- 激しいparticle
- 大きなparallax
- 長すぎるtransition
- 操作を待たせるanimation

Motionは「存在を感じる」程度にする。

---

## Desktop App Principles

これはWebサイトではなくデスクトップアプリ。

画面を巨大なWebダッシュボードのようにしない。

優先するもの:

- compact
- dense but breathable
- immediate
- keyboard friendly
- native-feeling

可能な限り、

「1画面に1つの目的」

にする。

設定画面では巨大なhero sectionを置かない。

---

## Main Screen

ホーム画面では最も重要な状態をすぐ確認できるようにする。

例:

```text
Piko                            ●

通知を、好きな声に。

読み上げるアプリ

🟣 Claude              ON
🟢 ChatGPT             ON
🔵 Slack               OFF
🟡 Calendar            ON


Character

┌─────────────────────────┐
│ 🌸 Mio                  │
│ ちょっと生意気な秘書     │
│                         │
│ 「Claudeの作業、          │
│   終わったみたいだよ」    │
│                         │
│        ▶ Voice Preview   │
└─────────────────────────┘
```

重要な操作以外を並べすぎない。

---

## Application List

アプリ別通知設定は、このプロダクトの主要UI。

各アプリを大きな設定フォームにはしない。

基本表示は、

```text
[icon] Claude                    ON
       Mio · Character mode
```

程度でよい。

クリックしたときに詳細設定へ進む。

詳細:

- Speak notifications ON/OFF
- Raw / Persona
- Persona
- Voice
- Preview

progressive disclosureを使う。

---

## Voice Selection

Voice選択は単純なselectだけにしない。

声はプロダクト価値の中心なので、

- 名前
- avatar
- short personality
- Premium badge
- preview button

を持った小さなカードとして扱う。

例:

```text
🌸 Mio
明るく距離の近い秘書

▶ Preview

Premium
```

Premium表示は金色・強いgradientなどで派手にしすぎない。

小さいstarやsoft highlight程度にする。

---

## Premium UI

Premiumを「機能制限画面」のように見せない。

無料版でも完成されたプロダクトとして成立させる。

Premiumは、

「より良い声を選べる」

という自然なアップグレードとして扱う。

避ける:

- 大きなUpgradeバナー
- 頻繁なPaywall
- 無料ユーザーへの赤い警告
- 機能一覧を大量にロック表示

推奨:

```text
Voice

○ System Voice
● Mio ✦
○ Aoi ✦
```

選択したときだけ自然にupgrade flowへ誘導する。

---

## Onboarding

オンボーディングは短くする。

最大3〜4ステップ程度。

例:

1. Welcome
2. Notification access
3. Choose character
4. Test voice

説明を長文にしない。

各ステップで1つだけ行動させる。

最後に必ず実際に喋らせる。

ユーザーが初回セットアップ中に、

「このアプリはこういう体験なのか」

と音で理解できる状態にする。

---

## Microcopy

文章は短く、人間的にする。

避ける:

> Notification speaking configuration

推奨:

> 読み上げるアプリ

避ける:

> Enable persona transformation

推奨:

> キャラっぽく話す

避ける:

> Voice playback test

推奨:

> 試しに喋る

技術用語は設定詳細以外では出さない。

---

## Icons

Lucideを基本にしてよい。

ただし、重要な操作ではAnimate UIなどのanimated iconを使用してよい。

アイコンを大量に使わない。

アプリアイコンやキャラクターavatarなど、意味の強いvisualを優先する。

---

## Layout

余白を十分に取る。

ただしWebサイトのように広大なpaddingにはしない。

デスクトップ小型ウィンドウとして成立する密度にする。

推奨:

- page padding: 20–28px
- card padding: 16–20px
- section gap: 24–32px
- related controls gap: 8–12px

---

## Dark Mode

Dark Modeでも真っ黒を基本背景にしない。

dark gray / slightly warm dark backgroundを使う。

accent glowが強くなりすぎないようにする。

OLED向けのpure black UIではなく、質感のあるdark surfaceを優先する。

---

## Accessibility

かわいさのために可読性や操作性を犠牲にしない。

必須:

- keyboard navigation
- visible focus state
- sufficient contrast
- reduced motion support
- readable text size
- descriptive labels
- screen reader compatible controls

`prefers-reduced-motion` を必ず尊重する。

---

## AI Implementation Rules

AIが新しいUIを実装するときは、まず既存コンポーネントを確認する。

優先順位:

1. 既存のプロジェクト内component
2. shadcn/ui
3. Cult UI
4. Animate UI
5. 新規実装

同じ役割のcomponentを複数作らない。

ライブラリを追加する前に、既存依存関係で実現できないか確認する。

新しい画面を作る際は、

「機能要件を満たしたか」

だけでなく、

「このアプリを毎日起動したくなるか」

を判断基準に含める。

画面が典型的なshadcn dashboardに見える場合は完成とみなさない。

---

## Final Quality Bar

完成した画面は以下を満たすこと。

- 一目で操作方法が分かる
- 小さなデスクトップアプリとして自然
- SaaS管理画面に見えない
- 可愛いが幼くない
- AIサービス特有の派手なgradientに頼らない
- キャラクターを視覚より声で感じられる
- hover / click / speaking状態に気持ちいい反応がある
- shadcn/uiをそのまま置いただけに見えない
- Windows / macOS双方で違和感が少ない
- 数ヶ月使っても疲れない
