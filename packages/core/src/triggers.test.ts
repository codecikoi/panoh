import { describe, expect, it } from "vitest";
import { BUILTIN_KEYWORDS, evaluateTrigger } from "./triggers.js";
import { SUPPORTED_LOCALES } from "./i18n/index.js";

describe("evaluateTrigger", () => {
  const base = { locale: "ru", botUsername: "BudgieBot" };

  it("processes everything in private chats", () => {
    const r = evaluateTrigger({ ...base, text: "привет", isPrivateChat: true });
    expect(r.process).toBe(true);
    expect(r.reason).toBe("private");
  });

  it("ignores plain chatter in groups", () => {
    expect(evaluateTrigger({ ...base, text: "ты где? скоро буду" }).process).toBe(false);
    expect(evaluateTrigger({ ...base, text: "встретимся в 15:30" }).process).toBe(false);
  });

  it("triggers on prefix and strips it", () => {
    const r = evaluateTrigger({ ...base, text: "+ продукты 150к" });
    expect(r.process).toBe(true);
    expect(r.reason).toBe("prefix");
    expect(r.explicit).toBe(true);
    expect(r.cleaned).toBe("продукты 150к");
  });

  it("triggers on mention and strips it", () => {
    const r = evaluateTrigger({ ...base, text: "@BudgieBot напомни завтра позвонить маме" });
    expect(r.reason).toBe("mention");
    expect(r.cleaned).toBe("напомни завтра позвонить маме");
  });

  it("triggers on reply to the bot", () => {
    expect(evaluateTrigger({ ...base, text: "не 150, а 115", isReplyToBot: true }).reason).toBe("reply");
  });

  it("triggers on localized keywords as whole words", () => {
    expect(evaluateTrigger({ ...base, text: "потратил 20 тысяч на такси" }).reason).toBe("keyword");
    expect(evaluateTrigger({ ...base, text: "Напомни в пятницу про садик" }).reason).toBe("keyword");
    expect(evaluateTrigger({ ...base, locale: "en", text: "I spent 20 bucks" }).reason).toBe("keyword");
    expect(evaluateTrigger({ ...base, locale: "uz", text: "taksiga 20 ming sarfladim" }).reason).toBe("keyword");
    expect(evaluateTrigger({ ...base, locale: "en", text: "spending is not a word here" }).process).toBe(false);
  });

  it("has keywords for every supported locale and matches scripts without spaces", () => {
    expect(Object.keys(BUILTIN_KEYWORDS).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    expect(evaluateTrigger({ ...base, locale: "es", text: "gasté 20 en el super" }).reason).toBe("keyword");
    expect(evaluateTrigger({ ...base, locale: "de", text: "Hab 30 für Benzin ausgegeben" }).reason).toBe("keyword");
    expect(evaluateTrigger({ ...base, locale: "ja", text: "食料品に3000円使った" }).reason).toBe("keyword");
    expect(evaluateTrigger({ ...base, locale: "zh", text: "今天买菜花了50" }).reason).toBe("keyword");
    expect(evaluateTrigger({ ...base, locale: "ko", text: "장보기에 3만원 썼어요" }).reason).toBe("keyword");
    expect(evaluateTrigger({ ...base, locale: "th", text: "วันนี้จ่ายค่าแท็กซี่ไป" }).reason).toBe("keyword");
    expect(evaluateTrigger({ ...base, locale: "ar", text: "دفعت الإيجار اليوم" }).reason).toBe("keyword");
    expect(evaluateTrigger({ ...base, locale: "hi", text: "आज राशन पर 500 खर्च हुए" }).reason).toBe("keyword");
    expect(evaluateTrigger({ ...base, locale: "fr", text: "on se voit demain ?" }).process).toBe(false);
  });

  it("triggers on money patterns", () => {
    expect(evaluateTrigger({ ...base, text: "такси 25 000 сум" }).reason).toBe("money");
    expect(evaluateTrigger({ ...base, text: "кофе 3$" }).reason).toBe("money");
    expect(evaluateTrigger({ ...base, text: "ужин 150к сум" }).reason).toBe("money");
    expect(evaluateTrigger({ ...base, text: "в 2026 году" }).process).toBe(false);
    expect(evaluateTrigger({ ...base, locale: "en", text: "dinner $45 tonight" }).reason).toBe("money");
    expect(evaluateTrigger({ ...base, locale: "de", text: "Benzin 60 Euro" }).reason).toBe("money");
    expect(evaluateTrigger({ ...base, locale: "id", text: "makan siang 50rb" }).process).toBe(false);
    expect(evaluateTrigger({ ...base, locale: "ja", text: "ランチ 1200円" }).reason).toBe("money");
  });

  it("respects household config", () => {
    const config = { prefix: "#", keywords: ["кофе"], moneyPattern: false };
    expect(evaluateTrigger({ ...base, text: "+ продукты 150к", config }).reason).toBe("money" === "money" ? "none" : "none");
    expect(evaluateTrigger({ ...base, text: "# продукты 150к", config }).reason).toBe("prefix");
    expect(evaluateTrigger({ ...base, text: "кофе был вкусный", config }).reason).toBe("keyword");
    expect(evaluateTrigger({ ...base, text: "такси 25 000 сум", config }).process).toBe(false);
  });
});
