## 結論

`FenceItem` に `public Guid Id { get; set; } = Guid.NewGuid();` を追加し、`FenceManagerService.LoadAll()` の `LoadFences()` 直後に「全 FenceData.Items を走査して `Id == Guid.Empty` なら `Guid.NewGuid()` を代入する」移行を入れるのが適切です。`LoadFences()` の呼び出し元は提示範囲では `FenceManagerService.LoadAll()` の1か所のみで、単一呼び出し元であることを確認できました。
ただし、**Guid 欠損時の既定値は `Guid.Empty` になる**ため、プロパティ初期化子 `= Guid.NewGuid()` だけでは旧データの移行になりません。必ず読み込み後の明示的な `Guid.Empty` チェックが必要です。learn.microsoft+1

## 実装前確認

| 確認項目 | 結果 |
| --- | --- |
| `FenceItem` の現状 | `Id` プロパティは未定義。追加対象は `src/Fence.App/Models/FenceItem.cs`。 |
| `LoadFences` の呼び出し元 | `FenceManagerService.LoadAll()` 内の `var stored = _settingsService.LoadFences();` の1か所のみ。 |
| 移行の挿入箇所 | `LoadFences()` 呼び出し直後、`CreateBackup()` より前が望ましい。移行済みの ID を含む状態を以降の処理に渡せる。 |
| JSON の Guid 欠損挙動 | JSON に `Id` が無い場合、`System.Text.Json` はプロパティを設定しないため、`Guid` の既定値 `Guid.Empty` になる。プロパティ初期化子はオブジェクト生成時に一度だけ評価されるため、逆シリアル化時の「欠損フィールドの補完」には使えない。learn.microsoft+1 |
| カスタム `JsonConverter<Guid>` | `SettingsService.JsonOptions` には `WriteIndented = true` のみで、`Converters` 登録や `[JsonConverter]` 属性は見当たらない。`Guid` には組み込みコンバーターが使われる。learn.microsoft+1 |

## 推奨する変更内容

## 1. `FenceItem.cs`

`FullPath` の直後に追加します。

```
/// <summary>
/// Stable identifier for this item, persisted in fences.json.
/// Used by later inter-gage move work to identify an item independently of FullPath.
/// Older stores without this field load as Guid.Empty and are migrated at load time.
/// </summary>
public Guid Id { get; set; } = Guid.NewGuid();
```

`using System;` は `FenceItem.cs` に現在ありませんが、`FenceItem` 内の既存 `System.DateTime?` と同様に完全修飾でも書けます。可読性を優先するなら、ファイル先頭に `using System;` を追加して `Guid` と書くのがよいです。

## 2. `FenceManagerService.LoadAll()`

現在の先頭部分:

```
public void LoadAll()
{
    var stored = _settingsService.LoadFences();

    // Fences 6-style auto-backup: ...
    _settingsService.CreateBackup();
```

これを次のようにします。

```
public void LoadAll()
{
    var stored = _settingsService.LoadFences();
    MigrateItemIds(stored);

    // Fences 6-style auto-backup: ...
    _settingsService.CreateBackup();
```

そして、`LoadAll()` の直後か、`BuildViewModel()` などの private メソッド近くに次を追加します。

```
/// <summary>
/// Assigns stable IDs to items saved before FenceItem.Id existed.
/// System.Text.Json leaves a missing Guid property at its default value (Guid.Empty),
/// so this is the required migration step; it does not change file paths or ordering.
/// </summary>
private static void MigrateItemIds(List<FenceData> fences)
{
    foreach (var fence in fences)
    {
        foreach (var item in fence.Items)
        {
            if (item.Id == Guid.Empty)
                item.Id = Guid.NewGuid();
        }
    }
}
```

`List<FenceData>` を引数にするのは、`LoadFences()` が `List<FenceData>` を返すためです。`IEnumerable<FenceData>` でも動作しますが、現状の戻り値型に合わせるほうが明確です。

## 挿入位置の理由

- `LoadFences()` の直後に置くことで、`BuildViewModel()`、`SyncPortalFence()`、以降の保存処理がすべて ID 付きの `FenceItem` を扱えます。
- `CreateBackup()` の前に置くと、今回のセッションで新規 ID を付与した状態を保持したまま、以降の `SaveFences()` で永続化できます。なお、既存 `fences.json` 自体のバックアップは移行前の状態で作られます。これは「読み込み時に自動で ID を付ける」という要件であり、バックアップの意味を損ないません。
- `SaveNow()` は `OpenFences` の `Model` をそのまま `SaveFences()` に渡すため、`FenceItem.Id` を追加し、移行済みオブジェクトを ViewModel に渡していれば、追加の保存処理変更は不要です。

## 注意点

- **`Guid.NewGuid()` をプロパティ初期化子にするだけでは不十分**です。旧 JSON に `id` が無い場合、`System.Text.Json` はそのプロパティに触れず、`Guid.Empty` のまま残ります。learn.microsoft+1
- **`JsonOptions` に `PropertyNameCaseInsensitive = true` はない**ため、将来 JSON 側のキー名を `"id"` にする場合は、C# 側の `Id` と大文字小文字が一致する必要があります。既定の `System.Text.Json` はプロパティ名を大文字小文字を区別して一致させます。[learn.microsoft](https://www.learn.microsoft.com/en-nz/dotnet/standard/serialization/system-text-json/migrate-from-newtonsoft)
- **既存の `FullPath` 依存処理は変更しない**こと。`ContainsPath()`、`AddItem()`、`AddPortalItem()`、`RemoveItem()`、`DesktopIconPositionService` 呼び出しなどは今回触れません。
- **`FenceData.Id` は既に存在する**ため、今回追加するのは `FenceItem.Id` です。名前衝突はありません。

## docs/ai-notes/ 用の1枚

以下を `docs/ai-notes/design/fence-item-id-migration.md` として保存することを想定した全文です。

```
# FenceItem.Id 追加と旧データ移行

## 目的

Gage の案B（管理情報だけを変え、実ファイルは動かさない）の最初の作業として、
`FenceItem` に安定した識別子 `Id` を追加する。

今後のゲージ間移動実装では、ファイル名や `FullPath` ではなくこの ID を使って
アイテムを特定できるようにする。ただし今回は ID の追加と旧データ移行のみを行い、
ファイル移動・Z-order・サムネイル・自動整理・ファイル削除には触れない。

## 変更ファイル

### 1. `src/Fence.App/Models/FenceItem.cs`

`FenceItem` に次のプロパティを追加する。

```csharp
/// <summary>
/// Stable identifier for this item, persisted in fences.json.
/// Used by later inter-gage move work to identify an item independently of FullPath.
/// Older stores without this field load as Guid.Empty and are migrated at load time.
/// </summary>
public Guid Id { get; set; } = Guid.NewGuid();
```

必要に応じてファイル先頭に `using System;` を追加する。

### 2. `src/Fence.App/Services/FenceManagerService.cs`

`LoadAll()` 内、`LoadFences()` の直後に移行処理を呼び出す。

```csharp
var stored = _settingsService.LoadFences();
MigrateItemIds(stored);
```

`FenceManagerService` に次の private static メソッドを追加する。

```csharp
private static void MigrateItemIds(List<FenceData> fences)
{
    foreach (var fence in fences)
    {
        foreach (var item in fence.Items)
        {
            if (item.Id == Guid.Empty)
                item.Id = Guid.NewGuid();
        }
    }
}
```

## なぜ LoadAll 内か

`SettingsService.LoadFences()` は `fences.json` を読み込み、
`List<FenceData>` を返す唯一の読み込み経路である。
`FenceManagerService.LoadAll()` がその唯一の呼び出し元であるため、
ここで旧データに ID を付与すれば、以降の ViewModel 生成や保存処理でも
ID 付きの状態を扱える。

## System.Text.Json の挙動

`FenceItem.Id` は `Guid` 型である。

旧バージョンの `fences.json` には `"Id"` に対応する JSON プロパティが存在しない。
`System.Text.Json` は、逆シリアル化対象に存在しない JSON プロパティを無視するため、
`Id` は `Guid` の既定値である `Guid.Empty` になる。

そのため、`public Guid Id { get; set; } = Guid.NewGuid();` だけでは移行にならない。
`LoadAll()` 内で `Guid.Empty` を明示的にチェックし、`Guid.NewGuid()` を代入する必要がある。

## 変更しないこと

- `FullPath` を使う既存処理は変更しない。
- ファイルの実移動は行わない。
- Z-order、サムネイル、自動整理、ファイル削除は変更しない。
- `SettingsService` の JSON 変換オプションやカスタム `JsonConverter` は追加しない。

## 手動確認手順

1. アプリを終了する。
2. `%APPDATA%\Gage\fences.json` を開き、バックアップを取る。
3. 既存データに `FenceItem` 相当の `"Id"` がないことを確認する。
4. アプリを起動する。
5. 任意のゲージにアイテムを追加するか、既存ゲージで何らかの保存を発生させる。
6. アプリを終了し、`%APPDATA%\Gage\fences.json` を再度開く。
7. 各 `Items` 要素に `"Id"` が追加され、値が重複しない GUID であることを確認する。
8. アプリを再起動しても、同じアイテムの `Id` が変わらないことを確認する。
9. アイテムの開閉、ラベル付け、ホットキー設定などを行い、
   従来どおり動作することを確認する。
10. 実ファイルが移動・削除されていないこと、デスクトップ上のアイコン配置に
    想定外の変化がないことを確認する。

## 期待される JSON 例

```json
{
  "FullPath": "C:\\Users\\user\\Desktop\\example.txt",
  "SortOrder": 0,
  "Id": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "TabIndex": 0
}
```

旧データでは `"Id"` が無いが、起動後の保存時には上記のように付与される。
```

## 補足

`FenceItem.Id` の JSON プロパティ名は、既定の `System.Text.Json` 命名規約に従い `Id` として保存されます。`JsonOptions` に camelCase ポリシーは設定されていないため、`"id"` ではなく `"Id"` になります。カスタム `JsonConverter` が存在しないため、`Guid` は標準の文字列表現で扱われます。learn.microsoft+1

確認状況: 確定
