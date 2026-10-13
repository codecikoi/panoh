import type { TriggerConfig } from "./db/schema.js";

/** Built-in trigger words per locale. English words are always added on top for non-English chats. */
export const BUILTIN_KEYWORDS: Record<string, string[]> = {
  en: [
    "spent", "spend", "paid", "pay", "bought", "buy", "expense", "expenses", "income", "salary", "earned", "received",
    "remind", "reminder", "loan", "credit", "mortgage", "payment", "rent", "bill", "bills", "subscription",
    "summary", "report", "stats", "undo", "cancel", "delete", "fix", "budget",
  ],
  ru: [
    "потратил", "потратила", "потратили", "трата", "траты", "купил", "купила", "купили", "заплатил", "заплатила",
    "заплатили", "оплатил", "оплатила", "оплатили", "оплата", "расход", "расходы", "доход", "доходы", "зарплата",
    "зп", "получил", "получила", "получили", "напомни", "напомнить", "напоминание", "кредит", "ипотека", "платёж",
    "платеж", "платежи", "аренда", "квартплата", "коммуналка", "подписка", "сводка", "итоги", "отчёт", "отчет",
    "статистика", "отмени", "отменить", "удали", "удалить", "исправь", "исправить", "бюджет", "записал", "запиши",
  ],
  uz: [
    "sarfladim", "sarfladik", "sarflandi", "xarajat", "xarajatlar", "sotib oldim", "sotib oldik", "oldim", "to'ladim",
    "to'ladik", "to'lov", "tuladim", "daromad", "maosh", "oylik", "oldik", "eslat", "eslatma", "eslatib", "kredit",
    "ipoteka", "ijara", "kommunal", "obuna", "hisobot", "xulosa", "statistika", "bekor", "o'chir", "tuzat", "byudjet",
    "yozib", "yoz",
  ],
  es: [
    "gasté", "gastamos", "gasto", "gastos", "pagué", "pagamos", "pagado", "compré", "compramos", "ingreso", "ingresos",
    "sueldo", "salario", "cobré", "recuérdame", "recuerda", "recordatorio", "préstamo", "crédito", "hipoteca", "alquiler",
    "factura", "facturas", "suscripción", "resumen", "informe", "deshacer", "cancela", "borra", "presupuesto",
  ],
  pt: [
    "gastei", "gastamos", "gasto", "gastos", "paguei", "pagamos", "pago", "comprei", "compramos", "receita", "renda",
    "salário", "recebi", "lembra", "lembre", "lembrete", "empréstimo", "crédito", "financiamento", "aluguel", "conta",
    "contas", "assinatura", "resumo", "relatório", "desfazer", "cancela", "apaga", "orçamento",
  ],
  fr: [
    "dépensé", "dépense", "dépenses", "payé", "payer", "acheté", "revenu", "revenus", "salaire", "reçu", "rappelle",
    "rappel", "rappelle-moi", "crédit", "prêt", "loyer", "facture", "factures", "abonnement", "bilan", "résumé",
    "annule", "supprime", "budget",
  ],
  de: [
    "ausgegeben", "ausgabe", "ausgaben", "bezahlt", "gezahlt", "gekauft", "einnahme", "einnahmen", "gehalt", "lohn",
    "erhalten", "erinnere", "erinnerung", "kredit", "darlehen", "miete", "rechnung", "rechnungen", "abo", "übersicht",
    "zusammenfassung", "rückgängig", "lösche", "budget",
  ],
  it: [
    "speso", "spesa", "spese", "pagato", "comprato", "entrata", "entrate", "stipendio", "ricevuto", "ricordami",
    "ricorda", "promemoria", "prestito", "mutuo", "affitto", "bolletta", "bollette", "abbonamento", "riepilogo",
    "resoconto", "annulla", "cancella", "budget",
  ],
  tr: [
    "harcadım", "harcadık", "harcama", "ödedim", "ödedik", "ödeme", "aldım", "gelir", "maaş", "hatırlat", "hatırlatma",
    "kredi", "kira", "fatura", "abonelik", "özet", "rapor", "geri al", "iptal", "sil", "bütçe",
  ],
  ar: [
    "صرفت", "صرفنا", "مصروف", "مصاريف", "دفعت", "دفعنا", "اشتريت", "دخل", "راتب", "استلمت", "ذكرني", "ذكّرني",
    "تذكير", "قرض", "إيجار", "فاتورة", "فواتير", "اشتراك", "ملخص", "تقرير", "تراجع", "إلغاء", "احذف", "ميزانية",
  ],
  fa: [
    "خرج", "خرج کردم", "پرداختم", "پرداخت", "خریدم", "درآمد", "حقوق", "گرفتم", "یادم بنداز", "یادآوری", "وام",
    "اجاره", "قبض", "اشتراک", "خلاصه", "گزارش", "لغو", "حذف", "بودجه",
  ],
  he: [
    "הוצאתי", "הוצאה", "הוצאות", "שילמתי", "קניתי", "הכנסה", "משכורת", "קיבלתי", "תזכיר", "תזכורת", "הלוואה",
    "משכנתא", "שכירות", "חשבון", "חשבונות", "מנוי", "סיכום", "דוח", "בטל", "מחק", "תקציב",
  ],
  hi: [
    "खर्च", "खर्चा", "भरा", "भरे", "दिया", "दिए", "खरीदा", "आमदनी", "आय", "सैलरी", "तनख्वाह", "मिली", "मिला",
    "याद दिलाना", "याद दिला", "रिमाइंडर", "लोन", "कर्ज", "किराया", "बिल", "सब्सक्रिप्शन", "सारांश", "रिपोर्ट", "हटाओ",
    "रद्द", "बजट",
  ],
  bn: [
    "খরচ", "দিয়েছি", "দিলাম", "কিনেছি", "আয়", "বেতন", "পেয়েছি", "মনে করিয়ে", "রিমাইন্ডার", "লোন", "ঋণ", "ভাড়া",
    "বিল", "সাবস্ক্রিপশন", "সারসংক্ষেপ", "রিপোর্ট", "বাতিল", "মুছে", "বাজেট",
  ],
  ur: [
    "خرچ", "خرچہ", "ادا", "دیا", "دیے", "خریدا", "آمدنی", "تنخواہ", "ملی", "یاد دلانا", "یاد دہانی", "قرض", "کرایہ",
    "بل", "سبسکرپشن", "خلاصہ", "رپورٹ", "واپس", "منسوخ", "حذف", "بجٹ",
  ],
  id: [
    "habis", "pengeluaran", "bayar", "beli", "pemasukan", "gaji", "dapat", "ingatkan", "pengingat", "cicilan",
    "pinjaman", "sewa", "tagihan", "langganan", "ringkasan", "laporan", "batal", "hapus", "anggaran",
  ],
  ms: [
    "belanja", "perbelanjaan", "bayar", "beli", "pendapatan", "gaji", "terima", "ingatkan", "peringatan", "pinjaman",
    "sewa", "bil", "langganan", "ringkasan", "laporan", "batal", "padam", "bajet",
  ],
  vi: [
    "tiêu", "chi tiêu", "trả", "mua", "thu nhập", "lương", "nhận", "nhắc", "nhắc nhở", "trả góp", "vay", "tiền nhà",
    "hóa đơn", "đăng ký", "tổng kết", "báo cáo", "hủy", "xóa", "ngân sách",
  ],
  th: [
    "จ่าย", "ใช้ไป", "ซื้อ", "รายจ่าย", "รายรับ", "เงินเดือน", "ได้เงิน", "เตือน", "ผ่อน", "กู้", "ค่าเช่า", "บิล", "สมัคร",
    "สรุป", "รายงาน", "ยกเลิก", "ลบ", "งบ",
  ],
  ko: [
    "썼", "지출", "냈", "결제", "샀", "수입", "월급", "받았", "알려줘", "알림", "리마인드", "대출", "월세", "공과금",
    "구독", "요약", "정리", "취소", "삭제", "예산",
  ],
  ja: [
    "使った", "支出", "払った", "支払", "買った", "収入", "給料", "もらった", "リマインド", "思い出させて", "ローン", "家賃",
    "請求", "サブスク", "まとめ", "集計", "取り消し", "削除", "予算",
  ],
  zh: [
    "花了", "花费", "支出", "付了", "付款", "买了", "收入", "工资", "发了", "提醒", "贷款", "房贷", "房租", "账单", "订阅",
    "总结", "汇总", "撤销", "删除", "预算",
  ],
  uk: [
    "витратив", "витратила", "витратили", "витрата", "витрати", "купив", "купила", "купили", "заплатив", "заплатила",
    "оплатив", "оплатила", "оплатили", "дохід", "доходи", "зарплата", "отримав", "отримала", "нагадай", "нагадати",
    "нагадування", "кредит", "іпотека", "платіж", "оренда", "комуналка", "підписка", "підсумок", "підсумки", "звіт",
    "скасуй", "видали", "виправ", "бюджет",
  ],
  pl: [
    "wydałem", "wydałam", "wydaliśmy", "wydatek", "wydatki", "zapłaciłem", "zapłaciłam", "zapłacone", "kupiłem",
    "kupiłam", "przychód", "dochód", "wypłata", "pensja", "dostałem", "przypomnij", "przypomnienie", "kredyt",
    "pożyczka", "czynsz", "rachunek", "rachunki", "subskrypcja", "podsumowanie", "raport", "cofnij", "anuluj", "usuń",
    "budżet",
  ],
  kk: [
    "жұмсадым", "жұмсадық", "шығын", "шығыс", "төледім", "төледік", "алдым", "кіріс", "жалақы", "айлық", "еске сал",
    "еске салу", "несие", "ипотека", "жалдау", "пәтерақы", "төлем", "жазылым", "қорытынды", "есеп", "болдырма", "өшір",
    "бюджет",
  ],
  az: [
    "xərclədim", "xərclədik", "xərc", "ödədim", "ödədik", "ödəniş", "aldım", "gəlir", "maaş", "xatırlat", "xatırlatma",
    "kredit", "ipoteka", "kirayə", "hesab", "abunə", "xülasə", "hesabat", "ləğv", "sil", "büdcə",
  ],
  ky: [
    "коротту", "короттук", "чыгым", "төлөдүм", "төлөдүк", "төлөм", "алдым", "киреше", "айлык", "эскерт", "эскертүү",
    "насыя", "ипотека", "ижара", "батир", "жазылуу", "жыйынтык", "отчет", "жокко чыгар", "өчүр", "бюджет",
  ],
  tg: [
    "харҷ", "харҷ кардам", "харҷ кардем", "хароҷот", "пардохтам", "пардохтем", "пардохт", "харидам", "даромад", "маош",
    "гирифтам", "ёдрас кун", "ёдраскунӣ", "қарз", "ипотека", "иҷора", "ҳисоб", "обуна", "ҷамъбаст", "ҳисобот", "бекор",
    "нест кун", "буҷет",
  ],
  nl: [
    "uitgegeven", "uitgave", "uitgaven", "betaald", "gekocht", "inkomsten", "inkomen", "salaris", "loon", "ontvangen",
    "herinner", "herinnering", "lening", "hypotheek", "huur", "rekening", "rekeningen", "abonnement", "overzicht",
    "samenvatting", "ongedaan", "annuleer", "verwijder", "budget",
  ],
  ro: [
    "cheltuit", "cheltuială", "cheltuieli", "plătit", "cumpărat", "venit", "venituri", "salariu", "primit", "amintește",
    "amintește-mi", "memento", "credit", "împrumut", "chirie", "factură", "facturi", "abonament", "rezumat", "raport",
    "anulează", "șterge", "buget",
  ],
};

/** Scripts without word separators (or with attached particles) use substring matching instead of word boundaries. */
const SUBSTRING_LOCALES = new Set(["th", "ja", "zh", "ko"]);

/** Names the bot answers to when a message starts with one of them (any case, Latin or Cyrillic spelling). */
export const BOT_NAMES = ["madat", "мадат"];
const NAME_PATTERN = new RegExp(`^(?:${BOT_NAMES.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])[\\s,:;!.?\\-—–]*`, "iu");

const MULTIPLIER = "(?:k|к|тыс\\.?|тысяч|млн\\.?|миллион[а-я]*|mln|ming|million|mil|rb|ribu|jt|juta|万|千|천|만|ล้าน|พัน)?";
const CURRENCY_WORDS =
  "сум[а-я]*|sum|so'm|so‘m|soʻm|сўм|uzs|руб[а-я]*|р\\.|₽|rub|\\$|usd|доллар[а-я]*|dollars?|bucks|€|eur|euros?|евро|£|gbp|pounds?|₸|тенге|теңге|тг|kzt|сом[а-я]*|somoni|tjs|kgs|грн|₴|uah|₺|try|lira|lirası|лир[а-я]*|¥|jpy|yen|円|cny|yuan|元|块|₹|inr|rupees?|rupias?|रुपये|रुपए|₨|rs|टका|টাকা|taka|bdt|روپے|pkr|₩|krw|won|원|aed|дирхам[а-я]*|درهم|دينار|دولار|يورو|ريال|تومان|₪|ש\"ח|שקל|שקלים|ils|zł|złotych|zloty|pln|lei|leu|ron|₫|dong|đồng|vnd|฿|baht|บาท|thb|ringgit|rm|myr|rupiah|rp|idr|pesos?|mxn|ars|cop|reais|real|r\\$|brl|chf|franken|francs?|kr|sek|nok|dkk|azn|manat|cad|aud|nzd";
const MONEY_AFTER = `\\d[\\d\\s.,'’]*\\s?${MULTIPLIER}\\s?(?:${CURRENCY_WORDS})(?![\\p{L}])`;
const MONEY_BEFORE = "(?:\\$|€|£|₽|₹|₺|₴|₸|₩|¥|₫|฿|₪|r\\$|rp|rs)\\s?\\d[\\d\\s.,]*";
const MONEY_PATTERN = new RegExp(`${MONEY_AFTER}|(?:^|[^\\p{L}])${MONEY_BEFORE}`, "iu");

export interface TriggerInput {
  text: string;
  locale: string;
  botUsername?: string;
  isReplyToBot?: boolean;
  isPrivateChat?: boolean;
  config?: TriggerConfig | null;
}

export interface TriggerResult {
  process: boolean;
  reason: "private" | "mention" | "reply" | "prefix" | "name" | "keyword" | "money" | "none";
  /** True when the user clearly addressed the bot (mention, reply, prefix or name). */
  explicit: boolean;
  /** Message text with the trigger prefix / mention / bot name stripped. */
  cleaned: string;
}

export function effectiveKeywords(locale: string, config?: TriggerConfig | null): string[] {
  const base = BUILTIN_KEYWORDS[locale] ?? [];
  const english = locale === "en" ? [] : BUILTIN_KEYWORDS.en ?? [];
  const extra = config?.keywords ?? [];
  return [...new Set([...base, ...english, ...extra].map((k) => k.toLowerCase()))];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Text after a leading bot name ("мадат, продукты 150к" → "продукты 150к"), or undefined when the message does not start with the name. */
function stripName(text: string): string | undefined {
  const match = NAME_PATTERN.exec(text);
  if (!match) return undefined;
  const rest = text.slice(match[0].length).trim();
  return rest.length > 0 ? rest : undefined;
}

function containsKeyword(text: string, keywords: string[], locale: string): boolean {
  const lower = text.toLowerCase();
  const substring = SUBSTRING_LOCALES.has(locale);
  return keywords.some((kw) => {
    if (!kw) return false;
    if (substring || !/^[\p{L}\p{N}' ’-]+$/u.test(kw)) return lower.includes(kw);
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(kw)}(?![\\p{L}])`, "iu").test(lower);
  });
}

export function evaluateTrigger(input: TriggerInput): TriggerResult {
  const text = input.text.trim();
  const config = input.config ?? {};
  const prefix = config.prefix ?? "+";
  const mentionEnabled = config.mention ?? true;
  const moneyEnabled = config.moneyPattern ?? true;

  const named = stripName(text);
  if (input.isPrivateChat) return { process: true, reason: "private", explicit: true, cleaned: named ?? text };

  if (mentionEnabled && input.botUsername) {
    const mention = new RegExp(`@${escapeRegExp(input.botUsername)}\\b`, "i");
    if (mention.test(text)) {
      return { process: true, reason: "mention", explicit: true, cleaned: text.replace(mention, "").trim() };
    }
  }
  if (mentionEnabled && input.isReplyToBot) return { process: true, reason: "reply", explicit: true, cleaned: text };
  if (prefix && text.startsWith(prefix) && text.length > prefix.length) {
    return { process: true, reason: "prefix", explicit: true, cleaned: text.slice(prefix.length).trim() };
  }
  if (named !== undefined) return { process: true, reason: "name", explicit: true, cleaned: named };
  if (containsKeyword(text, effectiveKeywords(input.locale, config), input.locale)) {
    return { process: true, reason: "keyword", explicit: false, cleaned: text };
  }
  if (moneyEnabled && MONEY_PATTERN.test(text)) return { process: true, reason: "money", explicit: false, cleaned: text };
  return { process: false, reason: "none", explicit: false, cleaned: text };
}
