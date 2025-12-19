# Comment Reader for Twitch (powered by VOICEVOX)

Twitch の配信マネージャー上のコメントを、ローカルの VOICEVOX で読み上げる Chrome 拡張です。

## 主な機能
- コメント読み上げ（配信マネージャーのチャットに対応）
- 話者、速度、音量、出力デバイスの選択
- 名前読み上げ、`!` コマンド無視、除外ユーザー設定
- 読み替え辞書（置換ルール）
- キュー停止 / テスト再生

## 必要なもの
- Chrome / Edge などの Chromium 系ブラウザ
- VOICEVOX（Engine）が `http://127.0.0.1:50021` で起動していること

## インストール（ローカル）
1. このリポジトリを取得
2. `chrome://extensions` を開く
3. 右上の「デベロッパー モード」を ON
4. 「パッケージ化されていない拡張機能を読み込む」で、このフォルダを選択

## 使い方
1. VOICEVOX を起動する
2. Twitch の配信マネージャーを開く  
   `https://dashboard.twitch.tv/stream-manager`
3. 拡張機能アイコンから「読み上げを有効にする」を ON
4. 出力デバイスを選びたい場合は、権限ページから一度マイク許可を与える  
   （デバイス名表示のため。録音は行いません）
5. 読み替え辞書は「辞書設定」から編集

## 権限について
- `storage`: 設定保存
- `offscreen`: 音声再生
- `http://127.0.0.1:50021/*`: VOICEVOX Engine へのアクセス
- `*://dashboard.twitch.tv/*`: チャット取得

## クレジット表記
配信で利用する際は、使用するキャラクターの利用規約に従い、適切なクレジット表記  
（例: `VOICEVOX: ずんだもん`）を行ってください。

## ライセンス
MIT License

## Links
- Chrome Web Store: https://chromewebstore.google.com/detail/comment-reader-for-twitch/eolabmdepbcdcppfdmkibgjffiifndkd
- Privacy Policy: https://shakashakahead.com/privacy/voicevox-comment-reader/
