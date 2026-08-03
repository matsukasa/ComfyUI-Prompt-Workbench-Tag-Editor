import { parseCatalogText } from "./domain/catalog";
import type { JsonObject } from "./domain/types";

const tag = (id: number, name: string, ja: string, postCount: number): JsonObject => ({
  id,
  name,
  translation_ja: ja,
  post_count: postCount,
  aliases: [],
  rank: id,
});

const catalog: JsonObject = {
  schema_version: 1,
  generated_at: "2026-08-03T00:00:00Z",
  sources: { sample: "Structure-only demo data" },
  stats: { tags: 44, major_categories: 8, medium_categories: 10, small_categories: 8 },
  major_categories: [
    {
      id: "person",
      label_ja: "人物",
      label_en: "Person",
      medium_categories: [
        {
          id: "hair",
          label_ja: "髪",
          label_en: "Hair",
          small_categories: [
            {
              id: "hair-style",
              label_ja: "髪型",
              tags: [
                tag(1, "long_hair", "ロングヘア", 54321),
                tag(2, "short_hair", "ショートヘア", 37654),
                tag(3, "medium_hair", "ミディアムヘア", 23670),
                tag(4, "twin_tails", "ツインテール", 41210),
                tag(5, "ponytail", "ポニーテール", 18432),
                tag(6, "braided_hair", "編み込みヘア", 9876),
                tag(7, "messy_hair", "無造作ヘア", 8765),
                tag(8, "wavy_hair", "ウェーブヘア", 7940),
                tag(9, "curly_hair", "カーリーヘア", 7210),
                tag(10, "straight_hair", "ストレートヘア", 6890),
                tag(11, "ahoge", "アホ毛", 12345),
                tag(12, "side_ponytail", "サイドポニー", 2876),
                tag(13, "updo", "アップヘア", 6030),
                tag(14, "bun", "お団子ヘア", 6543),
              ],
            },
            {
              id: "hair-color",
              label_ja: "髪の色",
              tags: [
                tag(20, "black_hair", "黒髪", 41228),
                tag(21, "blonde_hair", "金髪", 38750),
                tag(22, "brown_hair", "茶髪", 32700),
                tag(23, "white_hair", "白髪", 29100),
                tag(24, "silver_hair", "銀髪", 24100),
                tag(25, "gray_hair", "灰色の髪", 19700),
                tag(26, "red_hair", "赤髪", 18220),
                tag(27, "pink_hair", "ピンク髪", 17950),
                tag(28, "blue_hair", "青髪", 16500),
                tag(29, "green_hair", "緑髪", 11050),
                tag(30, "purple_hair", "紫髪", 10880),
                tag(31, "orange_hair", "オレンジ髪", 9040),
              ],
            },
            {
              id: "bangs",
              label_ja: "前髪",
              tags: [
                tag(40, "blunt_bangs", "ぱっつん前髪", 22900),
                tag(41, "center_bangs", "センター分け前髪", 17300),
                tag(42, "see-through_bangs", "シースルー前髪", 12900),
                tag(43, "curtain_bangs", "カーテン前髪", 11200),
                tag(44, "uneven_bangs", "アシメ前髪", 8900),
                tag(45, "no_bangs", "前髪なし", 7600),
                tag(46, "long_bangs", "長めの前髪", 7100),
                tag(47, "short_bangs", "短め前髪", 6800),
              ],
            },
            {
              id: "hair-impression",
              label_ja: "髪の印象",
              tags: [tag(50, "shiny_hair", "つやのある髪", 6400)],
            },
          ],
        },
        {
          id: "identity",
          label_ja: "身分",
          label_en: "Identity",
          small_categories: [{ id: "roles", label_ja: "役割", tags: [] }],
        },
      ],
    },
    {
      id: "clothing",
      label_ja: "服装",
      label_en: "Clothing",
      medium_categories: [
        {
          id: "upper-body",
          label_ja: "上半身",
          small_categories: [{ id: "tops", label_ja: "トップス", tags: [] }],
        },
        {
          id: "lower-body",
          label_ja: "下半身",
          small_categories: [{ id: "bottoms", label_ja: "ボトムス", tags: [] }],
        },
        {
          id: "accessories",
          label_ja: "アクセサリー",
          label_en: "Accessories",
          small_categories: [
            {
              id: "hair-accessories",
              label_ja: "髪飾り",
              tags: [
                tag(60, "hair_ribbon", "ヘアリボン", 12455),
                tag(61, "hair_bow", "ヘアボウ", 10880),
                tag(62, "hair_clip", "ヘアクリップ", 9812),
                tag(63, "hairpin", "ヘアピン", 9100),
                tag(64, "hairband", "ヘアバンド", 8200),
                tag(65, "scrunchie", "シュシュ", 7900),
                tag(66, "flower_hair_ornament", "花の髪飾り", 7200),
                tag(67, "kanzashi", "簪", 6400),
              ],
            },
            { id: "headwear", label_ja: "帽子", tags: [] },
            { id: "eyewear", label_ja: "眼鏡", tags: [] },
          ],
        },
      ],
    },
    {
      id: "pose",
      label_ja: "ポーズ",
      label_en: "Pose",
      medium_categories: [
        {
          id: "pose-basic",
          label_ja: "基本ポーズ",
          small_categories: [{ id: "standing", label_ja: "立ち姿", tags: [] }],
        },
      ],
    },
    {
      id: "background",
      label_ja: "背景",
      label_en: "Background",
      medium_categories: [
        {
          id: "scene",
          label_ja: "シーン",
          small_categories: [{ id: "indoors", label_ja: "屋内", tags: [] }],
        },
      ],
    },
    { id: "quality", label_ja: "画質・スタイル", label_en: "Quality / Style", medium_categories: [] },
    { id: "eyes", label_ja: "目", label_en: "Eyes", medium_categories: [] },
    { id: "expression", label_ja: "表情", label_en: "Expression", medium_categories: [] },
    { id: "body", label_ja: "体型", label_en: "Figure", medium_categories: [] },
  ],
};

export const demoDocument = parseCatalogText(`${JSON.stringify(catalog, null, 2)}\n`, "tag_catalog.json");
