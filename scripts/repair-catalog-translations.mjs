import fs from "node:fs";
import path from "node:path";

const directory = String.raw`D:\Stability Matrix\Data\Packages\ComfyUI\custom_nodes\ComfyUI-Prompt-Workbench\data`;
const targetPath = path.join(directory, "tag_catalog_20260806_225820.json");
const backupPath = path.join(directory, "tag_catalog_20260806_225820.backup-before-ja.json");

const translations = {
  "dark-skinned_female": "褐色肌の女性", "colored_skin": "色付きの肌", "skindentation": "肌の食い込み跡",
  "dark-skinned_male": "褐色肌の男性", "scar_on_face": "顔の傷跡", "mole_under_mouth": "口元のほくろ",
  "skin_tight": "肌に密着した服", "mole_on_breast": "胸のほくろ", "blue_skin": "青い肌", "green_skin": "緑色の肌",
  "eyes_visible_through_hair": "髪越しに見える目", "facing_viewer": "こちらを向いている", "looking_at_object": "物を見ている",
  "averting_eyes": "目をそらしている", "looking_at_penis": "陰茎を見ている", "staring": "じっと見つめている",
  "looking_over_eyewear": "眼鏡越しに見ている", "looking_at_breasts": "胸を見ている",
  "looking_through_own_legs": "自分の脚の間から見ている", "looking_at_self": "自分を見ている",
  "looking_at_creature": "生き物を見ている", "looking_at_pectorals": "胸筋を見ている",
  "looking_through_scope": "スコープを覗いている", "looking_inside": "中を覗いている", "looking_at_ass": "お尻を見ている",
  "looking_around": "周囲を見回している", "looking_at_watch": "腕時計を見ている", "closed_eyes": "目を閉じている",
  "one_eye_closed": "片目を閉じている", "embarrassed": "恥ずかしがっている", "half-closed_eyes": "半分閉じた目",
  "light_smile": "かすかな笑顔", "surprised": "驚いている", "wide-eyed": "目を見開いている", "empty_eyes": "虚ろな目",
  "full-face_blush": "顔全体の赤面", "light_frown": "軽く眉をひそめる", "evil_smile": "邪悪な笑み",
  "nervous_sweating": "緊張による汗", "sparkling_eyes": "輝く目", "nervous": "緊張している",
  "anime_coloring": "アニメ塗り", "chibi_only": "ちびキャラのみ", "silent_comic": "セリフなし漫画", "3d": "3D表現",
  "retro_artstyle": "レトロな画風", "surreal": "シュールな表現", "abstract": "抽象表現", "manga_(object)": "漫画本",
  "paper": "紙", "pixel_art": "ピクセルアート", "lineart": "線画", "calligraphy_brush": "書道筆", "no_lineart": "線画なし",
  "sketchbook": "スケッチブック", "holding_brush": "筆を持っている", "marker": "マーカー", "ink": "インク",
  "shadow": "影", "glowing": "発光している", "sunlight": "日光", "glowing_eyes": "発光する両目", "backlighting": "逆光",
  "light_rays": "光線", "glowing_eye": "発光する片目", "dappled_sunlight": "木漏れ日", "drop_shadow": "落ち影",
  "sidelighting": "側面からの光", "spotlight": "スポットライト", "glowing_weapon": "発光する武器", "glowstick": "ペンライト",
  "candlestand": "燭台", "glowing_sword": "発光する剣", "window_shadow": "窓の影", "colored_shadow": "色の付いた影",
  "glowing_butterfly": "発光する蝶", "alternate_color": "別配色", "limited_palette": "限定された色数", "sepia": "セピア調",
  "greyscale_with_colored_background": "色付き背景のグレースケール", "muted_color": "落ち着いた色合い",
  "pastel_colors": "パステルカラー", "gradient_dress": "グラデーションのドレス", "cloud": "雲", "wet": "濡れている",
  "cloudy_sky": "曇り空", "wind": "風", "sunbeam": "差し込む光", "lightning": "稲妻", "fog": "霧",
  "cumulonimbus_cloud": "積乱雲", "blurry_background": "ぼかした背景", "smoke": "煙", "steaming_body": "湯気の立つ身体",
  "film_grain": "フィルム粒子", "dark_background": "暗い背景", "twilight": "薄明",
  "see-through_silhouette": "透けて見えるシルエット", "darkness": "暗闇", "steam_censor": "湯気による隠し", "dust": "ほこり",
  "hand_on_another's_face": "相手の顔に手を添える", "headpat": "頭を撫でる", "arm_around_shoulder": "肩に腕を回す",
  "hand_on_another's_back": "相手の背中に手を置く", "hand_on_another's_arm": "相手の腕に手を置く",
  "hand_on_another's_thigh": "相手の太ももに手を置く", "hand_on_another's_waist": "相手の腰に手を置く",
  "hand_on_another's_hip": "相手の腰骨に手を置く", "hand_grab": "手をつかむ",
  "hand_on_another's_ass": "相手のお尻に手を置く", "hand_on_another's_neck": "相手の首に手を置く",
  "bound": "拘束されている", "kiss": "キス", "bondage": "性的な拘束", "hug_from_behind": "後ろから抱きしめる",
  "hugging_object": "物を抱きしめる", "carrying_person": "人を抱えて運ぶ", "bound_legs": "脚を拘束されている",
  "kissing_cheek": "頬にキス", "piggyback": "おんぶ", "after_kiss": "キスの後", "hugging_doll": "人形を抱きしめる",
  "bound_ankles": "足首を拘束されている", "sparkle": "きらめき", "petals": "花びら", "feathers": "羽根",
  "light_particles": "光の粒子", "bubble": "泡", "falling_petals": "舞い散る花びら", "air_bubble": "気泡",
  "rose_petals": "バラの花びら", "white_feathers": "白い羽根", "soap_bubbles": "シャボン玉", "black_feathers": "黒い羽根",
  "embers": "残り火", "pink_petals": "ピンク色の花びら", "AS-YoungV2-neg": "AS-YoungV2 ネガティブ埋め込み",
  "BadDream": "BadDream ネガティブ埋め込み", "badhandv4": "badhandv4 手の崩れ抑制",
  "BadNegAnatomyV1-neg": "BadNegAnatomyV1 人体崩れ抑制", "EasyNegative": "EasyNegative ネガティブ埋め込み",
  "FastNegativeV2": "FastNegativeV2 ネガティブ埋め込み", "cum_in_pussy": "膣内射精", "testicles": "睾丸",
  "female_pubic_hair": "女性の陰毛", "areola_slip": "乳輪のはみ出し", "male_pubic_hair": "男性の陰毛",
  "convenient_censoring": "構図による自然な隠し", "puffy_nipples": "膨らんだ乳首", "large_penis": "大きな陰茎",
  "spread_pussy": "広げた女性器", "veiny_penis": "血管の浮いた陰茎", "large_areolae": "大きな乳輪",
  "inverted_nipples": "陥没乳首", "spreading_own_pussy": "自分の女性器を広げる",
  "grabbing_another's_breast": "相手の胸をつかむ", "sex_from_behind": "後背位", "paizuri": "パイズリ",
  "handjob": "手淫", "nipple_stimulation": "乳首への刺激", "grabbing_another's_arm": "相手の腕をつかむ",
  "grabbing_own_breast": "自分の胸をつかむ", "clothes_grab": "服をつかむ", "footjob": "足コキ",
  "double_handjob": "両手での手淫", "paizuri_under_clothes": "服の下でのパイズリ", "sex": "性行為", "cum": "精液",
  "vaginal": "膣性交", "fellatio": "フェラチオ", "bdsm": "BDSM", "group_sex": "集団性交", "anal": "アナル性交",
  "masturbation": "自慰", "threesome": "3人での性行為", "female_masturbation": "女性の自慰",
  "after_vaginal": "膣性交の後", "femdom": "女性優位", "precum": "カウパー液",
  "mmf_threesome": "男性2人・女性1人の3人性交", "ffm_threesome": "女性2人・男性1人の3人性交",
  "vaginal_object_insertion": "膣への物の挿入", "double_penetration": "二穴同時挿入", "tentacle_sex": "触手との性行為",
};

const sourceBytes = fs.readFileSync(backupPath);
const sourceText = sourceBytes.toString("utf8").replace(/^\uFEFF/, "");
const newline = sourceText.includes("\r\n") ? "\r\n" : "\n";
const hasBom = sourceBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
const data = JSON.parse(sourceText);
const tags = [];
for (const major of data.major_categories ?? []) {
  for (const medium of major.medium_categories ?? []) {
    for (const small of medium.small_categories ?? []) {
      tags.push(...(small.tags ?? []));
    }
  }
}

const missing = tags.filter((tag) => !String(tag.translation_ja ?? "").trim());
const unmapped = missing.filter((tag) => !(tag.name in translations)).map((tag) => tag.name);
const extra = Object.keys(translations).filter((name) => !missing.some((tag) => tag.name === name));
if (missing.length !== 185 || unmapped.length || extra.length) {
  throw new Error(`翻訳表が一致しません: missing=${missing.length}, unmapped=${unmapped}, extra=${extra}`);
}
for (const tag of missing) tag.translation_ja = translations[tag.name];
data.stats.translated_tags = tags.length;
let output = JSON.stringify(data, null, 2).replace(/\n/g, newline) + newline;
if (hasBom) output = `\uFEFF${output}`;
fs.writeFileSync(targetPath, output, "utf8");
console.log(JSON.stringify({ updated: missing.length, total: tags.length, targetPath }));
