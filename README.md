# Tiny Stopwatch

> A tiny stopwatch that lives in your Chrome toolbar.

ポップアップすらない、Chromeツールバー常駐のミニマムなストップウォッチです。  
拡張機能のアイコンそのものが、分・秒のデジタル表示になります。

## 使い方

- **左クリック**：スタート
- **もう一度左クリック**：ストップ
- **停止中に左クリック**：続きから再開
- **右クリック → `Reset to 00:00`**：停止して `00:00` にリセット

アイコンは、上段が「分」、下段が「秒」です。

```text
MM
SS
```

`59:59` の次は `00:00` に戻り、そのまま計測を続けます。

> Chromeは拡張機能アイコンの右クリックを標準メニューに使用するため、リセットは右クリック後に `Reset to 00:00` を選択します。

## インストール

Chromeウェブストアを使わず、ローカルの「パッケージ化されていない拡張機能」として読み込みます。

1. このリポジトリの **Code → Download ZIP** を選ぶか、Gitでクローンします。
2. ZIPの場合は任意の場所に展開します。
3. Chromeで `chrome://extensions` を開きます。
4. 右上の **デベロッパー モード** をオンにします。
5. **パッケージ化されていない拡張機能を読み込む** をクリックします。
6. `manifest.json` が入っている `tiny-stopwatch` フォルダを選択します。
7. Chromeの拡張機能メニューから **Tiny Stopwatch** をツールバーに固定します。

## 更新

リポジトリを再度ダウンロードするか `git pull` したあと、`chrome://extensions` の **Tiny Stopwatch** にある再読み込みボタンを押してください。

## 仕様

- 表示：`00:00`〜`59:59`
- 1時間ごとにゼロへ循環
- ポップアップなし
- Webページへのアクセス権限なし
- 外部通信なし
- 状態は `chrome.storage.local` にのみ保存
- Manifest V3
- Chrome 110以降

計測中に拡張機能のService Workerが再起動しても、保存した開始時刻から経過時間を復元します。

## ファイル構成

```text
tiny-stopwatch/
├── manifest.json
├── background.js
└── README.md
```
